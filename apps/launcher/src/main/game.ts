import fs from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { BuildManifest, ChannelSlug, UserProfile } from "@assetown/shared";
import { api } from "./api.js";
import { detectJava } from "./java.js";
import { log } from "./logger.js";
import { buildLaunchCommand, latestCrashReport, MinecraftEngine, spawnMinecraft, type MinecraftInstall } from "./minecraft.js";
import { loadSettings } from "./store.js";
import type { GameStatus, SyncProgress } from "../shared/types.js";

export class GameManager {
  private status: GameStatus = {
    phase: "idle",
    channel: null,
    pid: null,
    startedAt: null,
    exitCode: null,
    message: "",
    crashReport: null,
  };
  private child: ChildProcess | null = null;
  private recentLines: string[] = [];

  constructor(
    private readonly emitStatus: (status: GameStatus) => void,
    private readonly emitProgress: (progress: SyncProgress) => void,
  ) {}

  getStatus(): GameStatus {
    return this.status;
  }

  getRecentLines(): string {
    return this.recentLines.join("\n");
  }

  private set(patch: Partial<GameStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emitStatus(this.status);
  }

  kill(): void {
    if (this.child && !this.child.killed) {
      log("info", "Arrêt de Minecraft demandé");
      this.child.kill();
    }
  }

  private reporter(channel: ChannelSlug): (message: string, percent: number) => void {
    return (message, percent) => {
      this.emitProgress({
        phase: percent >= 100 ? "completed" : "preparing",
        channel,
        percent: Math.min(99, percent),
        filesTotal: 0,
        filesDone: 0,
        bytesTotal: 0,
        bytesDone: 0,
        speedBps: 0,
        currentFile: "",
        message,
        etaSeconds: null,
      });
    };
  }

  async launch(channel: ChannelSlug): Promise<{ ok: boolean; message?: string }> {
    if (this.status.phase === "running") {
      return { ok: false, message: "Minecraft est déjà en cours d'exécution." };
    }
    const settings = loadSettings();
    const instanceDir = path.join(settings.installDir, channel);
    fs.mkdirSync(instanceDir, { recursive: true });

    this.set({ phase: "preparing", channel, message: "Préparation du lancement…", exitCode: null, crashReport: null });
    this.recentLines = [];

    try {
      const me = await api.get<{ user: UserProfile }>("/api/me");
      const manifest = await api.get<BuildManifest>(`/api/builds/${channel}/manifest`, false);
      const build = manifest.build;

      if (!build.required && manifest.files.length === 0) {
        log("warn", "Build sans fichiers : lancement d'une instance vanilla");
      }

      const java = await detectJava(settings.javaPath);
      if (!java) {
        const message =
          "Java introuvable. Installez Java 17 ou 21 (Temurin recommandé) puis indiquez son chemin dans les paramètres, section Java.";
        this.set({ phase: "idle", message });
        return { ok: false, message };
      }

      const engine = new MinecraftEngine(settings.installDir, this.reporter(channel));
      this.set({ message: "Vérification de l'installation Minecraft…" });
      const install: MinecraftInstall = await engine.ensure(
        {
          minecraftVersion: build.minecraftVersion,
          loader: build.loader,
          loaderVersion: build.loaderVersion,
          loaderProfileUrl: build.loaderProfileUrl,
          instanceDir,
        },
        this.reporter(channel),
      );

      if (install.javaMajor && java.major < install.javaMajor) {
        const message = `Ce build requiert Java ${install.javaMajor} ou supérieur (détecté : ${java.major}). Mettez à jour Java dans les paramètres.`;
        this.set({ phase: "idle", message });
        return { ok: false, message };
      }

      this.set({ message: "Lancement de Minecraft…" });
      const ramMax = Math.max(build.javaMaxRam, settings.ramMaxMb);
      const extraJvm = [
        ...build.jvmArgs,
        ...settings.jvmArgs
          .split(/\s+/)
          .map((arg) => arg.trim())
          .filter(Boolean),
      ];

      const command = buildLaunchCommand({
        install,
        javaPath: java.path,
        username: me.user.username,
        ramMinMb: Math.min(settings.ramMinMb, ramMax),
        ramMaxMb: ramMax,
        width: settings.resolutionWidth,
        height: settings.resolutionHeight,
        fullscreen: settings.fullscreen,
        extraJvmArgs: extraJvm,
        extraGameArgs: build.gameArgs,
        server: manifest.server.host ? manifest.server : null,
        launcherVersion: "1.0.0",
        onLine: () => undefined,
        onExit: () => undefined,
      });

      this.child = spawnMinecraft(
        {
          install,
          javaPath: command.command,
          username: me.user.username,
          ramMinMb: Math.min(settings.ramMinMb, ramMax),
          ramMaxMb: ramMax,
          width: settings.resolutionWidth,
          height: settings.resolutionHeight,
          fullscreen: settings.fullscreen,
          extraJvmArgs: extraJvm,
          extraGameArgs: build.gameArgs,
          server: manifest.server.host ? manifest.server : null,
          launcherVersion: "1.0.0",
          onLine: (line) => {
            this.recentLines.push(line);
            if (this.recentLines.length > 500) this.recentLines.shift();
          },
          onExit: (code) => this.handleExit(code, instanceDir),
        },
        path.join(instanceDir, "logs"),
      );

      this.set({
        phase: "running",
        pid: this.child.pid ?? null,
        startedAt: Date.now(),
        message: `Minecraft lancé — ${build.label}`,
      });

      void api
        .post("/api/telemetry/launch", { channel, buildId: build.id }, false)
        .catch(() => undefined);

      if (settings.closeOnLaunch) {
        // La fenêtre est masquée par le renderer via l'événement de statut.
      }

      return { ok: true };
    } catch (error) {
      const message = (error as Error).message;
      log("error", `Lancement impossible : ${message}`);
      this.set({ phase: "idle", message });
      return { ok: false, message };
    }
  }

  private handleExit(code: number | null, instanceDir: string): void {
    this.child = null;
    const crashed = code !== null && code !== 0;
    const crashReport = crashed ? latestCrashReport(instanceDir) : null;
    this.set({
      phase: crashed ? "crashed" : "exited",
      pid: null,
      exitCode: code,
      message: crashed
        ? "Minecraft s'est arrêté de manière inattendue. Consultez le rapport de crash."
        : "Minecraft s'est fermé.",
      crashReport,
    });
    log(crashed ? "error" : "info", `Minecraft terminé (code ${code})`);
  }
}
