import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import { ChildProcess, spawn } from "node:child_process";
import { downloadToFile, fetchBuffer, fetchJson, fileSize, sha1Buffer, verifyFile } from "./net.js";
import { log } from "./logger.js";

const MOJANG_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader";

export interface ProgressReporter {
  (message: string, percent: number): void;
}

interface VersionDownload {
  path?: string;
  url: string;
  sha1?: string;
  size?: number;
}

interface LibraryRule {
  action: "allow" | "disallow";
  os?: { name?: string; arch?: string; version?: string };
  features?: Record<string, boolean>;
}

interface Library {
  name: string;
  url?: string;
  downloads?: { artifact?: VersionDownload; classifiers?: Record<string, VersionDownload> };
  natives?: Record<string, string>;
  rules?: LibraryRule[];
  extract?: { exclude?: string[] };
}

type ArgumentEntry = string | { rules?: LibraryRule[]; value: string | string[] };

export interface VersionJson {
  id: string;
  type: string;
  mainClass: string;
  inheritsFrom?: string;
  arguments?: { game: ArgumentEntry[]; jvm: ArgumentEntry[] };
  minecraftArguments?: string;
  libraries: Library[];
  assetIndex?: { id: string; url: string; sha1?: string; size?: number; totalSize?: number };
  assets?: string;
  downloads?: { client?: VersionDownload; server?: VersionDownload };
  javaVersion?: { component: string; majorVersion: number };
  logging?: { client?: { argument: string; file: { id: string; url: string; sha1?: string; size?: number } } };
}

interface LoaderProfile {
  id: string;
  mainClass: string;
  libraries: Library[];
  arguments?: { game?: ArgumentEntry[]; jvm?: ArgumentEntry[] };
}

export interface MinecraftInstall {
  versionJson: VersionJson;
  gameDir: string;
  sharedDir: string;
  classpath: string[];
  nativesDir: string;
  assetsDir: string;
  assetIndexName: string;
  loggingArgument: string | null;
  javaMajor: number;
  versionName: string;
}

function osName(): string {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "darwin":
      return "osx";
    default:
      return "linux";
  }
}

function osArch(): string {
  switch (process.arch) {
    case "x64":
      return "x86_64";
    case "ia32":
      return "x86";
    case "arm64":
      return "arm64";
    default:
      return "x86";
  }
}

function ruleMatches(rule: LibraryRule): boolean {
  if (rule.features && Object.values(rule.features).some(Boolean)) return false;
  if (!rule.os) return true;
  if (rule.os.name && rule.os.name !== osName()) return false;
  if (rule.os.arch && rule.os.arch !== osArch()) return false;
  return true;
}

function rulesAllow(rules: LibraryRule[] | undefined): boolean {
  if (!rules || rules.length === 0) return true;
  let allowed = false;
  for (const rule of rules) {
    if (!ruleMatches(rule)) continue;
    allowed = rule.action === "allow";
  }
  return allowed;
}

function mavenCoordinates(name: string): { group: string; artifact: string; version: string; classifier?: string; ext: string } | null {
  const [coords, ext] = name.split("@");
  const parts = coords.split(":");
  if (parts.length < 3) return null;
  return {
    group: parts[0],
    artifact: parts[1],
    version: parts[2],
    classifier: parts[3],
    ext: ext ?? "jar",
  };
}

function mavenUrl(base: string, name: string): { path: string; url: string } | null {
  const parsed = mavenCoordinates(name);
  if (!parsed) return null;
  const fileName = `${parsed.artifact}-${parsed.version}${parsed.classifier ? `-${parsed.classifier}` : ""}.${parsed.ext}`;
  const relative = `${parsed.group.replace(/\./g, "/")}/${parsed.artifact}/${parsed.version}/${fileName}`;
  return { path: relative, url: `${base.replace(/\/?$/, "/")}${relative}` };
}

async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

export class MinecraftEngine {
  readonly sharedDir: string;

  constructor(
    private readonly installRoot: string,
    private readonly report: ProgressReporter,
  ) {
    this.sharedDir = path.join(installRoot, "_shared");
    for (const dir of ["versions", "libraries", "assets/indexes", "assets/objects", "natives", "loader-profiles", "logs"]) {
      fs.mkdirSync(path.join(this.sharedDir, dir), { recursive: true });
    }
  }

  private async versionManifest(): Promise<{ versions: Array<{ id: string; url: string; type: string }> }> {
    const cacheFile = path.join(this.sharedDir, "versions", "version_manifest_v2.json");
    let useCache = false;
    try {
      const stat = fs.statSync(cacheFile);
      useCache = Date.now() - stat.mtimeMs < 60 * 60 * 1000;
    } catch {
      useCache = false;
    }
    if (useCache) {
      return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    }
    try {
      const data = await fetchJson<{ versions: Array<{ id: string; url: string; type: string }> }>(MOJANG_MANIFEST);
      fs.writeFileSync(cacheFile, JSON.stringify(data));
      return data;
    } catch (error) {
      if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
      throw error;
    }
  }

  async vanillaJson(minecraftVersion: string): Promise<VersionJson> {
    const file = path.join(this.sharedDir, "versions", minecraftVersion, `${minecraftVersion}.json`);
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")) as VersionJson;
      } catch {
        fs.rmSync(file, { force: true });
      }
    }
    this.report("Récupération de la version Minecraft…", 2);
    const manifest = await this.versionManifest();
    const entry = manifest.versions.find((version) => version.id === minecraftVersion);
    if (!entry) throw new Error(`Version Minecraft inconnue : ${minecraftVersion}`);
    const json = await fetchJson<VersionJson>(entry.url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(json, null, 2));
    return json;
  }

  private async loaderProfile(minecraftVersion: string, loader: string, loaderVersion: string, profileUrl: string | null): Promise<LoaderProfile | null> {
    if (loader === "vanilla") return null;
    const cacheFile = path.join(this.sharedDir, "loader-profiles", `${loader}-${minecraftVersion}-${loaderVersion || "latest"}.json`);
    if (fs.existsSync(cacheFile)) {
      try {
        return JSON.parse(fs.readFileSync(cacheFile, "utf8")) as LoaderProfile;
      } catch {
        fs.rmSync(cacheFile, { force: true });
      }
    }

    let profile: LoaderProfile | null = null;
    if (loader === "fabric") {
      const url = `${FABRIC_META}/${encodeURIComponent(minecraftVersion)}/${encodeURIComponent(loaderVersion || "latest")}/profile/json`;
      profile = await fetchJson<LoaderProfile>(url);
    } else if (profileUrl) {
      const buffer = await fetchBuffer(profileUrl, 30_000);
      profile = JSON.parse(buffer.toString("utf8")) as LoaderProfile;
    } else {
      throw new Error(
        `Aucun profil ${loader} fourni pour ce build. Un administrateur doit publier le profil de version JSON du loader (Forge/NeoForge) dans le build.`,
      );
    }

    if (profile) {
      fs.writeFileSync(cacheFile, JSON.stringify(profile, null, 2));
    }
    return profile;
  }

  private libraryArtifact(library: Library): { relative: string; url: string; sha1?: string; size?: number } | null {
    if (!rulesAllow(library.rules)) return null;
    const artifact = library.downloads?.artifact;
    if (artifact?.url && artifact.path) {
      return { relative: artifact.path, url: artifact.url, sha1: artifact.sha1, size: artifact.size };
    }
    if (library.name && library.url) {
      const resolved = mavenUrl(library.url, library.name);
      if (resolved) return { relative: resolved.path, url: resolved.url };
    }
    return null;
  }

  private async ensureLibraries(libraries: Library[], reportBase: number, reportSpan: number): Promise<string[]> {
    const resolved = libraries
      .map((library) => this.libraryArtifact(library))
      .filter((item): item is { relative: string; url: string; sha1?: string; size?: number } => Boolean(item));

    const unique = new Map(resolved.map((item) => [item.relative, item]));
    const entries = Array.from(unique.values());
    const classpath: string[] = [];
    let done = 0;

    await runPool(entries, 8, async (entry) => {
      const target = path.join(this.sharedDir, "libraries", entry.relative);
      classpath.push(target);
      const exists = fs.existsSync(target) && (!entry.size || fileSize(target) === entry.size);
      if (exists && entry.sha1) {
        if (await verifyFile(target, entry.sha1, "sha1")) {
          done += 1;
          this.report(`Bibliothèques ${done}/${entries.length}`, reportBase + (reportSpan * done) / Math.max(1, entries.length));
          return;
        }
      } else if (exists) {
        done += 1;
        this.report(`Bibliothèques ${done}/${entries.length}`, reportBase + (reportSpan * done) / Math.max(1, entries.length));
        return;
      }

      await downloadToFile(entry.url, target);
      if (entry.sha1) {
        const valid = await verifyFile(target, entry.sha1, "sha1");
        if (!valid) {
          fs.rmSync(target, { force: true });
          throw new Error(`Bibliothèque corrompue : ${entry.relative}`);
        }
      }
      done += 1;
      this.report(`Bibliothèques ${done}/${entries.length}`, reportBase + (reportSpan * done) / Math.max(1, entries.length));
    }).catch((error: Error) => {
      throw new Error(`Installation des bibliothèques impossible : ${error.message}`);
    });

    return classpath.sort();
  }

  private async ensureNatives(libraries: Library[], versionName: string): Promise<string> {
    const nativesDir = path.join(this.sharedDir, "natives", versionName);
    fs.mkdirSync(nativesDir, { recursive: true });
    const arch = process.arch === "x64" ? "64" : "32";

    for (const library of libraries) {
      if (!library.natives || !rulesAllow(library.rules)) continue;
      const key = library.natives[osName()];
      if (!key) continue;
      const classifierKey = key.replace("${arch}", arch);
      const artifact = library.downloads?.classifiers?.[classifierKey];
      if (!artifact?.url) continue;
      const target = path.join(nativesDir, `${classifierKey}.jar`);
      if (!fs.existsSync(target) || (artifact.size && fileSize(target) !== artifact.size)) {
        await downloadToFile(artifact.url, target);
      }
      try {
        const zip = new AdmZip(target);
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory) continue;
          const name = entry.entryName;
          if (name.startsWith("META-INF/") || name.endsWith(".git") || name.includes("..")) continue;
          const excluded = library.extract?.exclude?.some((pattern) => new RegExp(pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")).test(name));
          if (excluded) continue;
          const output = path.join(nativesDir, path.basename(name));
          fs.mkdirSync(path.dirname(output), { recursive: true });
          fs.writeFileSync(output, entry.getData());
        }
      } catch (error) {
        log("warn", `Extraction natives impossible (${classifierKey}): ${(error as Error).message}`);
      }
    }
    return nativesDir;
  }

  private async ensureAssets(version: VersionJson, reportBase: number, reportSpan: number): Promise<{ assetsDir: string; indexName: string }> {
    const assetsDir = path.join(this.sharedDir, "assets");
    const indexName = version.assetIndex?.id ?? version.assets ?? "legacy";
    if (version.assetIndex?.url) {
      const indexFile = path.join(assetsDir, "indexes", `${indexName}.json`);
      let needDownload = true;
      if (fs.existsSync(indexFile)) {
        if (version.assetIndex.sha1) {
          const digest = sha1Buffer(fs.readFileSync(indexFile));
          needDownload = digest !== version.assetIndex.sha1;
        } else {
          needDownload = false;
        }
      }
      if (needDownload) {
        const buffer = await fetchBuffer(version.assetIndex.url, 120_000);
        fs.mkdirSync(path.dirname(indexFile), { recursive: true });
        fs.writeFileSync(indexFile, buffer);
      }

      try {
        const index = JSON.parse(fs.readFileSync(indexFile, "utf8")) as {
          objects: Record<string, { hash: string; size: number }>;
          map_to_resources?: boolean;
          virtual?: boolean;
        };
        const objects = Object.entries(index.objects ?? {});
        let done = 0;
        const pending = objects.filter(([, object]) => {
          const target = path.join(assetsDir, "objects", object.hash.slice(0, 2), object.hash);
          return !fs.existsSync(target) || fileSize(target) !== object.size;
        });
        this.report(
          pending.length > 0 ? `Ressources Minecraft : ${pending.length} fichiers à télécharger…` : "Ressources Minecraft à jour",
          reportBase,
        );

        await runPool(pending, 16, async ([, object]) => {
          const target = path.join(assetsDir, "objects", object.hash.slice(0, 2), object.hash);
          await downloadToFile(`https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`, target);
          done += 1;
          if (done % 25 === 0 || done === pending.length) {
            this.report(
              `Ressources Minecraft ${done}/${pending.length}`,
              reportBase + (reportSpan * done) / Math.max(1, pending.length),
            );
          }
        });

        // Anciennes versions : ressources virtuelles / mappées
        if (index.virtual || index.map_to_resources) {
          const virtualDir = path.join(assetsDir, index.virtual ? "virtual" : "resources", indexName);
          for (const [name, object] of objects) {
            const source = path.join(assetsDir, "objects", object.hash.slice(0, 2), object.hash);
            const target = path.join(virtualDir, name);
            if (!fs.existsSync(target) && fs.existsSync(source)) {
              fs.mkdirSync(path.dirname(target), { recursive: true });
              fs.copyFileSync(source, target);
            }
          }
        }
      } catch (error) {
        throw new Error(`Installation des ressources impossible : ${(error as Error).message}`);
      }
    }
    return { assetsDir, indexName };
  }

  private async ensureLoggingConfig(version: VersionJson): Promise<string | null> {
    const logging = version.logging?.client;
    if (!logging) return null;
    const target = path.join(this.sharedDir, "logs", `${logging.file.id}.xml`);
    if (!fs.existsSync(target) || (logging.file.sha1 && !(await verifyFile(target, logging.file.sha1, "sha1")))) {
      const buffer = await fetchBuffer(logging.file.url);
      fs.writeFileSync(target, buffer);
    }
    return logging.argument.replace("${path}", target);
  }

  /**
   * Installe (ou répare) la version vanilla + le loader et renvoie tout le
   * nécessaire au lancement du jeu.
   */
  async ensure(
    options: {
      minecraftVersion: string;
      loader: string;
      loaderVersion: string;
      loaderProfileUrl: string | null;
      instanceDir: string;
    },
    report: ProgressReporter = this.report,
  ): Promise<MinecraftInstall> {
    const { minecraftVersion, loader, loaderVersion, loaderProfileUrl, instanceDir } = options;
    const vanilla = await this.vanillaJson(minecraftVersion);

    // Client jar
    const clientJar = path.join(this.sharedDir, "versions", minecraftVersion, `${minecraftVersion}.jar`);
    if (vanilla.downloads?.client?.url) {
      const valid = fs.existsSync(clientJar) && (!vanilla.downloads.client.size || fileSize(clientJar) === vanilla.downloads.client.size);
      if (!valid || (vanilla.downloads.client.sha1 && !(await verifyFile(clientJar, vanilla.downloads.client.sha1, "sha1")))) {
        report("Téléchargement du client Minecraft…", 5);
        await downloadToFile(vanilla.downloads.client.url, clientJar);
      }
    }

    const profile = await this.loaderProfile(minecraftVersion, loader, loaderVersion, loaderProfileUrl);
    const libraries = [...(vanilla.libraries ?? []), ...(profile?.libraries ?? [])];
    const classpathLibs = await this.ensureLibraries(libraries, 10, 45);
    const nativesDir = await this.ensureNatives(vanilla.libraries ?? [], `${minecraftVersion}${loader === "vanilla" ? "" : `-${loader}-${loaderVersion}`}`);
    const assets = await this.ensureAssets(vanilla, 55, 40);
    const loggingArgument = await this.ensureLoggingConfig(vanilla);

    const versionName = profile?.id ?? vanilla.id;
    const merged: VersionJson = {
      ...vanilla,
      mainClass: profile?.mainClass ?? vanilla.mainClass,
      arguments: {
        game: [...(vanilla.arguments?.game ?? []), ...(profile?.arguments?.game ?? [])],
        jvm: [...(vanilla.arguments?.jvm ?? []), ...(profile?.arguments?.jvm ?? [])],
      },
      libraries,
    };

    fs.mkdirSync(instanceDir, { recursive: true });
    return {
      versionJson: merged,
      gameDir: instanceDir,
      sharedDir: this.sharedDir,
      classpath: [...classpathLibs, clientJar],
      nativesDir,
      assetsDir: assets.assetsDir,
      assetIndexName: assets.indexName,
      loggingArgument,
      javaMajor: vanilla.javaVersion?.majorVersion ?? 8,
      versionName,
    };
  }
}

function offlineUuid(username: string): string {
  const hash = crypto.createHash("md5").update(`OfflinePlayer:${username}`, "utf8").digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function flattenArguments(
  entries: ArgumentEntry[] | undefined,
  placeholders: Record<string, string>,
): string[] {
  if (!entries) return [];
  const args: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string") {
      args.push(substitute(entry, placeholders));
      continue;
    }
    if (entry.rules && !rulesAllow(entry.rules)) continue;
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    for (const value of values) args.push(substitute(value, placeholders));
  }
  return args.filter((arg) => arg !== "");
}

function substitute(value: string, placeholders: Record<string, string>): string {
  let output = value;
  for (const [key, replacement] of Object.entries(placeholders)) {
    output = output.split(`\${${key}}`).join(replacement);
  }
  return output.replace(/\$\{[^}]+\}/g, "");
}

export interface LaunchOptions {
  install: MinecraftInstall;
  javaPath: string;
  username: string;
  ramMinMb: number;
  ramMaxMb: number;
  width: number;
  height: number;
  fullscreen: boolean;
  extraJvmArgs: string[];
  extraGameArgs: string[];
  server: { host: string; port: number } | null;
  launcherVersion: string;
  onLine: (line: string) => void;
  onExit: (code: number | null) => void;
}

export function buildLaunchCommand(options: LaunchOptions): { command: string; args: string[] } {
  const { install } = options;
  const uuid = offlineUuid(options.username);
  const separator = process.platform === "win32" ? ";" : ":";
  const classpath = install.classpath.join(separator);

  const placeholders: Record<string, string> = {
    auth_player_name: options.username,
    version_name: install.versionName,
    game_directory: install.gameDir,
    assets_root: install.assetsDir,
    game_assets: path.join(install.assetsDir, "virtual", install.assetIndexName),
    assets_index_name: install.assetIndexName,
    auth_uuid: uuid,
    auth_access_token: "0",
    auth_session: "0",
    user_type: "legacy",
    version_type: "release",
    natives_directory: install.nativesDir,
    launcher_name: "Assetown",
    launcher_version: options.launcherVersion,
    classpath,
    resolution_width: String(options.width),
    resolution_height: String(options.height),
    clientid: "",
    auth_xuid: "",
    user_properties: "{}",
    library_directory: path.join(install.sharedDir, "libraries"),
    classpath_separator: separator,
  };

  const version = install.versionJson;
  const jvmArgs: string[] = [];
  jvmArgs.push(`-Xms${Math.max(512, options.ramMinMb)}M`, `-Xmx${Math.max(options.ramMinMb, options.ramMaxMb)}M`);
  jvmArgs.push(`-Djava.library.path=${install.nativesDir}`);
  jvmArgs.push("-Dminecraft.launcher.brand=Assetown", `-Dminecraft.launcher.version=${options.launcherVersion}`);
  if (install.loggingArgument) jvmArgs.push(install.loggingArgument);
  if (process.platform === "darwin") jvmArgs.push("-XstartOnFirstThread");
  jvmArgs.push(...options.extraJvmArgs);

  if (version.arguments?.jvm?.length) {
    jvmArgs.push(...flattenArguments(version.arguments.jvm, placeholders));
  }
  if (!jvmArgs.some((arg) => arg.startsWith("-cp") || arg === "-classpath")) {
    jvmArgs.push("-cp", classpath);
  }

  const gameArgs: string[] = [];
  if (version.arguments?.game?.length) {
    gameArgs.push(...flattenArguments(version.arguments.game, placeholders));
  } else if (version.minecraftArguments) {
    gameArgs.push(...version.minecraftArguments.split(/\s+/).map((arg) => substitute(arg, placeholders)));
  }
  if (options.width > 0 && options.height > 0) {
    gameArgs.push("--width", String(options.width), "--height", String(options.height));
  }
  if (options.fullscreen) gameArgs.push("--fullscreen", "true");
  gameArgs.push(...options.extraGameArgs);
  if (options.server?.host) {
    gameArgs.push("--server", options.server.host, "--port", String(options.server.port));
  }

  return { command: options.javaPath, args: [...jvmArgs, version.mainClass, ...gameArgs] };
}

export function javaMajorForVersion(install: MinecraftInstall): number {
  return install.javaMajor;
}

export function spawnMinecraft(options: LaunchOptions, instanceLogsDir: string): ChildProcess {
  const { command, args } = buildLaunchCommand(options);
  const logPath = path.join(instanceLogsDir, "assetown-launch.log");
  fs.mkdirSync(instanceLogsDir, { recursive: true });
  fs.writeFileSync(logPath, `# Assetown — ${new Date().toISOString()}\n# ${command} ${args.map((arg) => (arg.length > 200 ? `${arg.slice(0, 200)}…` : arg)).join(" ")}\n`, "utf8");

  const child = spawn(command, args, {
    cwd: options.install.gameDir,
    windowsHide: false,
    detached: false,
  });

  const write = (line: string) => {
    try {
      fs.appendFileSync(logPath, `${line}\n`);
    } catch {
      /* ignore */
    }
    options.onLine(line);
  };

  const attach = (stream: NodeJS.ReadableStream) => {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) write(line);
    });
  };

  if (child.stdout) attach(child.stdout);
  if (child.stderr) attach(child.stderr);
  child.on("error", (error) => {
    write(`[Assetown] Erreur de lancement : ${error.message}`);
    options.onExit(-1);
  });
  child.on("exit", (code) => options.onExit(code));

  log("info", `Minecraft lancé (${options.install.versionName}) — PID ${child.pid ?? "?"}`);
  return child;
}

export function latestCrashReport(instanceDir: string): string | null {
  const crashDir = path.join(instanceDir, "crash-reports");
  try {
    const files = fs
      .readdirSync(crashDir)
      .filter((file) => file.endsWith(".txt"))
      .map((file) => ({ file, at: fs.statSync(path.join(crashDir, file)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    if (files.length === 0) return null;
    return fs.readFileSync(path.join(crashDir, files[0].file), "utf8").slice(0, 200_000);
  } catch {
    return null;
  }
}
