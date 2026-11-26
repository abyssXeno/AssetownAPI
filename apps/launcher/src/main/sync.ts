import fs from "node:fs";
import path from "node:path";
import type { BuildManifest, ChannelSlug, ManifestFile } from "@assetown/shared";
import { AbortedDownloadError, downloadToFile, fileSize, sha256File, verifyFile } from "./net.js";
import { api } from "./api.js";
import { log } from "./logger.js";
import { loadSettings } from "./store.js";
import type { SyncProgress, SyncSummary } from "../shared/types.js";

interface ManagedFile {
  sha256: string;
  size: number;
}

interface ManagedState {
  buildId: string;
  etag: string;
  updatedAt: string;
  files: Record<string, ManagedFile>;
}

class StopError extends Error {
  constructor() {
    super("Synchronisation interrompue");
    this.name = "StopError";
  }
}

interface Task {
  file: ManifestFile;
  target: string;
  attempt: number;
}

const CONCURRENCY = 4;
const BACKUP_MAX_BYTES = 400 * 1024 * 1024;

function isProtected(relativePath: string, protectedPaths: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/").toLowerCase();
  return protectedPaths.some((entry) => {
    const protectedPath = entry.replace(/\\/g, "/").toLowerCase();
    return normalized === protectedPath || normalized.startsWith(`${protectedPath}/`);
  });
}

function dirSize(dir: string, limit = BACKUP_MAX_BYTES): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else total += fileSize(full);
      if (total > limit) return total;
    }
  }
  return total;
}

function copyDirectory(source: string, destination: string): number {
  if (!fs.existsSync(source)) return 0;
  let count = 0;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      count += copyDirectory(from, to);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}

export class SyncEngine {
  private pending: Task[] = [];
  private paused = false;
  private stopped = false;
  private signal = { aborted: false };
  private resumeWaiters: Array<() => void> = [];
  private progress: SyncProgress | null = null;
  private bytesAtStart = 0;
  private bytesDone = 0;
  private startedAt = 0;
  private speedSamples: Array<{ at: number; bytes: number }> = [];
  private lastEmit = 0;
  private running = false;

  constructor(private readonly emit: (progress: SyncProgress) => void) {}

  getProgress(): SyncProgress | null {
    return this.progress;
  }

  isRunning(): boolean {
    return this.running;
  }

  pause(): void {
    if (!this.running) return;
    this.paused = true;
    this.signal.aborted = true;
    this.update({ phase: "paused", message: "Téléchargement en pause" });
  }

  resume(): void {
    if (!this.running) return;
    this.paused = false;
    this.signal.aborted = false;
    this.update({ phase: "downloading", message: "Reprise du téléchargement…" });
    const waiters = this.resumeWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  stop(): void {
    this.paused = false;
    this.stopped = true;
    this.signal.aborted = true;
    const waiters = this.resumeWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  private update(patch: Partial<SyncProgress>): void {
    if (!this.progress) return;
    this.progress = { ...this.progress, ...patch };
    const now = Date.now();
    if (now - this.lastEmit > 140 || patch.phase === "completed" || patch.phase === "error" || patch.phase === "paused") {
      this.lastEmit = now;
      this.emit(this.progress);
    }
  }

  private recompute(): void {
    if (!this.progress) return;
    const now = Date.now();
    this.speedSamples.push({ at: now, bytes: this.bytesDone });
    while (this.speedSamples.length > 2 && now - this.speedSamples[0].at > 3000) this.speedSamples.shift();
    const first = this.speedSamples[0];
    const elapsed = Math.max(1, (now - first.at) / 1000);
    const speed = Math.max(0, (this.bytesDone - first.bytes) / elapsed);
    const percent =
      this.progress.bytesTotal > 0
        ? Math.min(99.5, (this.bytesDone / this.progress.bytesTotal) * 100)
        : this.progress.filesTotal > 0
          ? Math.min(99.5, (this.progress.filesDone / this.progress.filesTotal) * 100)
          : 0;
    const remaining = Math.max(0, this.progress.bytesTotal - this.bytesDone);
    this.update({
      percent: Number(percent.toFixed(1)),
      bytesDone: this.bytesDone,
      speedBps: Math.round(speed),
      etaSeconds: speed > 1024 ? Math.round(remaining / speed) : null,
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.pending.length > 0) {
      if (this.stopped) throw new StopError();
      if (this.paused) {
        await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
        continue;
      }
      const batch = this.pending.splice(0, CONCURRENCY);
      await Promise.all(
        batch.map(async (task) => {
          if (this.stopped) throw new StopError();
          if (this.paused) {
            this.pending.push(task);
            return;
          }
          await this.downloadTask(task);
        }),
      );
    }
  }

  private async downloadTask(task: Task): Promise<void> {
    const { file, target } = task;
    this.update({ currentFile: file.path });
    try {
      const resumeOffset = fs.existsSync(`${target}.part`) ? fileSize(`${target}.part`) : 0;
      this.bytesDone -= resumeOffset;
      await downloadToFile(file.url, target, {
        signal: this.signal,
        onProgress: (bytes) => {
          this.bytesDone = Math.max(this.bytesDone, 0) + 0;
          this.recomputeFromFile(bytes, resumeOffset);
        },
      });
      const valid = await verifyFile(target, file.sha256, "sha256");
      if (!valid) {
        fs.rmSync(target, { force: true });
        if (task.attempt < 1) {
          this.pending.push({ ...task, attempt: task.attempt + 1 });
          return;
        }
        throw new Error(`Fichier corrompu après téléchargement : ${file.path}`);
      }
      this.progress!.filesDone += 1;
      this.recomputeFromFile(file.size, 0, true);
      this.update({
        filesDone: this.progress!.filesDone,
        currentFile: file.path,
        message: `Installé : ${file.path}`,
      });
    } catch (error) {
      if (error instanceof AbortedDownloadError) {
        this.pending.push(task);
        this.signal.aborted = false;
        return;
      }
      if (this.stopped) throw new StopError();
      throw new Error(`Échec du téléchargement de ${file.path} : ${(error as Error).message}`);
    }
  }

  /**
   * Le suivi d'octets additionne les tailles réelles des fichiers finis et la
   * progression du fichier en cours pour éviter les doubles comptages.
   */
  private completedBytes = 0;
  private currentFileBytes = 0;

  private recomputeFromFile(currentBytes: number, resumeOffset: number, finished = false): void {
    this.currentFileBytes = currentBytes;
    const effective = finished ? 0 : currentBytes - resumeOffset;
    this.bytesDone = this.completedBytes + Math.max(0, effective);
    if (finished) this.completedBytes += currentBytes;
    this.recompute();
  }

  private instanceDir(channel: ChannelSlug): string {
    return path.join(loadSettings().installDir, channel);
  }

  private stateFile(instanceDir: string): string {
    return path.join(instanceDir, ".assetown", "manifest.json");
  }

  private readState(instanceDir: string): ManagedState | null {
    try {
      return JSON.parse(fs.readFileSync(this.stateFile(instanceDir), "utf8")) as ManagedState;
    } catch {
      return null;
    }
  }

  private writeState(instanceDir: string, state: ManagedState): void {
    const file = this.stateFile(instanceDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }

  private async backupIfNeeded(instanceDir: string, previous: ManagedState | null, nextBuildId: string, changedCount: number): Promise<string | null> {
    if (!previous || previous.buildId === nextBuildId || changedCount === 0) return null;
    const significant = changedCount >= 20;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(instanceDir, "backups", `${stamp}-${previous.buildId.slice(0, 8)}`);
    try {
      fs.mkdirSync(backupDir, { recursive: true });
      copyDirectory(path.join(instanceDir, ".assetown"), path.join(backupDir, ".assetown"));
      copyDirectory(path.join(instanceDir, "config"), path.join(backupDir, "config"));
      for (const fileName of ["options.txt", "servers.dat"]) {
        const from = path.join(instanceDir, fileName);
        if (fs.existsSync(from)) fs.copyFileSync(from, path.join(backupDir, fileName));
      }
      if (significant && dirSize(path.join(instanceDir, "mods")) < BACKUP_MAX_BYTES) {
        copyDirectory(path.join(instanceDir, "mods"), path.join(backupDir, "mods"));
      }
      log("info", `Sauvegarde créée avant mise à jour : ${backupDir}`);
      this.update({ message: "Sauvegarde des configurations effectuée" });
      return backupDir;
    } catch (error) {
      log("warn", `Sauvegarde impossible : ${(error as Error).message}`);
      return null;
    }
  }

  async run(channel: ChannelSlug, options: { repair?: boolean } = {}): Promise<SyncSummary> {
    if (this.running) throw new Error("Une synchronisation est déjà en cours");
    this.running = true;
    this.paused = false;
    this.stopped = false;
    this.signal = { aborted: false };
    this.pending = [];
    this.resumeWaiters = [];
    this.completedBytes = 0;
    this.currentFileBytes = 0;
    this.bytesDone = 0;
    this.speedSamples = [];
    this.startedAt = Date.now();

    const settings = loadSettings();
    const instanceDir = path.join(settings.installDir, channel);
    fs.mkdirSync(instanceDir, { recursive: true });

    this.progress = {
      phase: "preparing",
      channel,
      percent: 0,
      filesTotal: 0,
      filesDone: 0,
      bytesTotal: 0,
      bytesDone: 0,
      speedBps: 0,
      currentFile: "",
      message: "Préparation de la synchronisation…",
      etaSeconds: null,
    };
    this.emit(this.progress);

    try {
      const manifest = await api.get<BuildManifest>(`/api/builds/${channel}/manifest`, false);
      const previous = this.readState(instanceDir);
      this.progress.filesTotal = manifest.files.length;
      this.update({ phase: "checking", message: `Vérification de ${manifest.files.length} fichiers…` });

      const toDownload: Task[] = [];
      const skippedFiles: Record<string, ManagedFile> = {};
      let skipped = 0;

      for (const file of manifest.files) {
        if (isProtected(file.path, manifest.protectedPaths)) {
          log("warn", `Fichier du manifest ignoré (chemin protégé) : ${file.path}`);
          continue;
        }
        const target = path.join(instanceDir, file.path);
        const recorded = previous?.files[file.path];
        const exists = fs.existsSync(target);
        const sizeMatches = exists && fileSize(target) === file.size;

        if (!options.repair && recorded && recorded.sha256 === file.sha256 && sizeMatches) {
          skippedFiles[file.path] = { sha256: file.sha256, size: file.size };
          skipped += 1;
          this.progress.filesDone += 1;
          continue;
        }
        if (!options.repair && exists && sizeMatches) {
          const digest = await sha256File(target);
          if (digest.toLowerCase() === file.sha256.toLowerCase()) {
            skippedFiles[file.path] = { sha256: file.sha256, size: file.size };
            skipped += 1;
            this.progress.filesDone += 1;
            continue;
          }
        }
        toDownload.push({ file, target, attempt: 0 });
      }

      // Restaurer les fichiers déjà à jour dans l'état local
      this.progress.bytesTotal = toDownload.reduce((total, task) => total + task.file.size, 0);
      this.update({
        phase: "downloading",
        message:
          toDownload.length === 0
            ? "Tous les fichiers sont à jour"
            : `${toDownload.length} fichier(s) à télécharger (${Math.round(this.progress.bytesTotal / 1024 / 1024)} Mo)`,
        percent: toDownload.length === 0 ? 40 : 0,
      });

      const backupPath = await this.backupIfNeeded(instanceDir, previous, manifest.build.id, toDownload.length);

      this.pending = toDownload;
      await this.drainQueue();

      // Appliquer : supprimer les fichiers obsolètes gérés par Assetown
      this.update({ phase: "applying", message: "Nettoyage des anciens fichiers…", percent: 96 });
      let removed = 0;
      if (previous) {
        const currentPaths = new Set(manifest.files.map((file) => file.path));
        for (const oldPath of Object.keys(previous.files)) {
          if (currentPaths.has(oldPath)) continue;
          if (isProtected(oldPath, manifest.protectedPaths)) continue;
          const target = path.join(instanceDir, oldPath);
          try {
            if (fs.existsSync(target)) {
              fs.rmSync(target, { force: true });
              removed += 1;
            }
          } catch (error) {
            log("warn", `Suppression impossible (${oldPath}) : ${(error as Error).message}`);
          }
        }
      }
      pruneEmptyDirectories(instanceDir, manifest.directories);

      const state: ManagedState = {
        buildId: manifest.build.id,
        etag: manifest.etag,
        updatedAt: new Date().toISOString(),
        files: {
          ...Object.fromEntries(
            manifest.files
              .filter((file) => !isProtected(file.path, manifest.protectedPaths))
              .map((file) => [file.path, { sha256: file.sha256, size: file.size }]),
          ),
          ...skippedFiles,
        },
      };
      this.writeState(instanceDir, state);

      const durationMs = Date.now() - this.startedAt;
      this.update({
        phase: "completed",
        percent: 100,
        message:
          toDownload.length === 0
            ? `Instance à jour — ${manifest.build.label}`
            : `Installation terminée — ${toDownload.length} fichier(s) mis à jour`,
        etaSeconds: 0,
      });
      log("info", `Synchronisation ${channel} terminée en ${Math.round(durationMs / 1000)}s (${toDownload.length} fichiers, ${removed} supprimés)`);

      return {
        channel,
        buildLabel: manifest.build.label,
        downloaded: toDownload.length,
        removed,
        skipped,
        bytes: this.progress.bytesTotal,
        durationMs,
        backupPath,
      };
    } catch (error) {
      if (error instanceof StopError) {
        this.update({ phase: "idle", message: "Synchronisation annulée" });
        throw error;
      }
      this.update({ phase: "error", message: (error as Error).message });
      log("error", `Synchronisation échouée : ${(error as Error).message}`);
      throw error;
    } finally {
      this.running = false;
      this.paused = false;
    }
  }
}

function pruneEmptyDirectories(instanceDir: string, managedDirectories: string[]) {
  for (const dir of managedDirectories) {
    const full = path.join(instanceDir, dir);
    try {
      if (fs.existsSync(full) && fs.readdirSync(full).length === 0) fs.rmdirSync(full);
    } catch {
      /* ignore */
    }
  }
}

export function instancePath(channel: string): string {
  return path.join(loadSettings().installDir, channel);
}
