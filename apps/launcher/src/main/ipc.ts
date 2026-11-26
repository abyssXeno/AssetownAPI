import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { Announcement, BuildManifest, ChannelSlug, PublicConfig, UserProfile } from "@assetown/shared";
import { api, ApiError, validateBaseUrl } from "./api.js";
import { detectJava, validateJavaPath } from "./java.js";
import { log, logDirectory, readRecentLogs } from "./logger.js";
import { loadSettings, resetSettings, saveSettings, setAutoLaunch, type LauncherSettings } from "./store.js";
import { fetchBuffer } from "./net.js";
import type { GameManager } from "./game.js";
import type { SyncEngine } from "./sync.js";
import type {
  JavaInfo,
  LauncherVersionInfo,
  SessionState,
  SkinPreviewPayload,
  SupportReportInput,
  SyncProgress,
} from "../shared/types.js";

let currentUser: UserProfile | null = null;

function sessionState(): SessionState {
  return {
    authenticated: Boolean(currentUser) && api.hasSession(),
    user: currentUser,
    offline: !api.hasSession(),
    apiBaseUrl: api.getBaseUrl(),
  };
}

function sanitizeSettingsPatch(patch: Record<string, unknown>): Partial<LauncherSettings> {
  const output: Partial<LauncherSettings> = {};
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.round(parsed)));
  };

  if (typeof patch.installDir === "string" && patch.installDir.trim()) output.installDir = path.resolve(patch.installDir.trim());
  if (typeof patch.apiBaseUrl === "string") output.apiBaseUrl = validateBaseUrl(patch.apiBaseUrl);
  if (patch.ramMinMb !== undefined) output.ramMinMb = clamp(patch.ramMinMb, 512, 32768, 2048);
  if (patch.ramMaxMb !== undefined) output.ramMaxMb = clamp(patch.ramMaxMb, 1024, 65536, 4096);
  if (patch.resolutionWidth !== undefined) output.resolutionWidth = clamp(patch.resolutionWidth, 854, 7680, 1920);
  if (patch.resolutionHeight !== undefined) output.resolutionHeight = clamp(patch.resolutionHeight, 480, 4320, 1080);
  if (patch.fullscreen !== undefined) output.fullscreen = Boolean(patch.fullscreen);
  if (patch.language === "fr" || patch.language === "en") output.language = patch.language;
  if (patch.autoStartOnBoot !== undefined) output.autoStartOnBoot = Boolean(patch.autoStartOnBoot);
  if (patch.closeOnLaunch !== undefined) output.closeOnLaunch = Boolean(patch.closeOnLaunch);
  if (patch.keepLauncherOpen !== undefined) output.keepLauncherOpen = Boolean(patch.keepLauncherOpen);
  if (typeof patch.javaPath === "string") output.javaPath = patch.javaPath.trim();
  if (typeof patch.jvmArgs === "string") output.jvmArgs = patch.jvmArgs.slice(0, 1200);
  if (patch.selectedChannel === "v1" || patch.selectedChannel === "v2" || patch.selectedChannel === "v3") {
    output.selectedChannel = patch.selectedChannel;
    output.lastChannel = patch.selectedChannel;
  }
  return output;
}

async function loadMe(): Promise<UserProfile | null> {
  if (!api.hasSession()) return null;
  try {
    const data = await api.get<{ user: UserProfile }>("/api/me");
    currentUser = data.user;
    return data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      currentUser = null;
      api.clearSession();
    }
    return currentUser;
  }
}

async function skinDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  try {
    const buffer = await fetchBuffer(url, 20_000);
    return `data:image/png;base64,${buffer.toString("base64")}`;
  } catch (error) {
    log("warn", `Skin indisponible : ${(error as Error).message}`);
    return null;
  }
}

function cacheRoot(): string {
  return loadSettings().installDir;
}

function clearCache(): { removedFiles: number; freedBytes: number } {
  let removedFiles = 0;
  let freedBytes = 0;
  const root = cacheRoot();
  const targets = [
    path.join(root, "_shared", "versions", "version_manifest_v2.json"),
    path.join(root, "_shared", "loader-profiles"),
    path.join(root, "_shared", "natives"),
  ];

  const removeFile = (file: string) => {
    try {
      freedBytes += fs.statSync(file).size;
      fs.rmSync(file, { force: true });
      removedFiles += 1;
    } catch {
      /* ignore */
    }
  };

  for (const target of targets) {
    if (!fs.existsSync(target)) continue;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      const stack = [target];
      while (stack.length) {
        const current = stack.pop()!;
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else removeFile(full);
        }
      }
    } else {
      removeFile(target);
    }
  }

  // Fichiers partiels de téléchargement
  for (const channel of ["v1", "v2", "v3"]) {
    const instanceDir = path.join(loadSettings().installDir, channel);
    if (!fs.existsSync(instanceDir)) continue;
    const stack = [instanceDir];
    while (stack.length) {
      const current = stack.pop()!;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.name.endsWith(".part")) removeFile(full);
      }
    }
  }
  return { removedFiles, freedBytes };
}

export interface IpcDeps {
  getWindow: () => BrowserWindow | null;
  sync: SyncEngine;
  game: GameManager;
}

export function registerIpc(deps: IpcDeps): void {
  const emit = (channel: string, payload: unknown) => {
    const window = deps.getWindow();
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload);
  };

  ipcMain.handle("app:info", (): LauncherVersionInfo => ({
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome,
    platform: `${process.platform} ${process.arch}`,
    logFile: path.join(logDirectory(), "launcher.log"),
  }));

  ipcMain.handle("app:openExternal", async (_event, url: string) => {
    if (typeof url !== "string") return;
    if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(url)) {
      throw new Error("Seuls les liens HTTPS peuvent être ouverts");
    }
    await shell.openExternal(url);
  });

  ipcMain.handle("app:minimize", () => deps.getWindow()?.minimize());
  ipcMain.handle("app:close", () => deps.getWindow()?.close());

  ipcMain.handle("settings:get", () => loadSettings());
  ipcMain.handle("settings:save", (_event, patch: Record<string, unknown>) => {
    const previous = loadSettings();
    const cleaned = sanitizeSettingsPatch(patch ?? {});
    const next = saveSettings(cleaned);
    if (next.ramMinMb > next.ramMaxMb) saveSettings({ ramMaxMb: next.ramMinMb });
    if (previous.autoStartOnBoot !== next.autoStartOnBoot) setAutoLaunch(next.autoStartOnBoot);
    if (previous.apiBaseUrl !== next.apiBaseUrl) {
      api.setBaseUrl(next.apiBaseUrl);
      currentUser = null;
      emit("auth:changed", sessionState());
    }
    fs.mkdirSync(next.installDir, { recursive: true });
    return loadSettings();
  });

  ipcMain.handle("settings:reset", () => {
    const fresh = resetSettings();
    api.setBaseUrl(fresh.apiBaseUrl);
    currentUser = null;
    emit("auth:changed", sessionState());
    return fresh;
  });

  ipcMain.handle("settings:chooseInstallDir", async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Dossier d'installation Assetown",
      properties: ["openDirectory", "createDirectory"],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    saveSettings({ installDir: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle("settings:openInstallDir", async (_event, channel?: string) => {
    const dir = channel ? path.join(loadSettings().installDir, channel) : loadSettings().installDir;
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle("settings:chooseJava", async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Choisir l'exécutable Java",
      properties: ["openFile"],
      filters: [{ name: "Java", extensions: process.platform === "win32" ? ["exe"] : ["*"] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    const info = await validateJavaPath(result.filePaths[0]);
    if (!info) throw new Error("Ce fichier n'est pas un exécutable Java valide");
    saveSettings({ javaPath: result.filePaths[0] });
    return result.filePaths[0];
  });

  ipcMain.handle("settings:clearCache", () => clearCache());

  ipcMain.handle("auth:state", async () => {
    await loadMe();
    return sessionState();
  });

  ipcMain.handle("auth:login", async (_event, identifier: string, password: string) => {
    const data = await api.post<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: UserProfile;
    }>("/api/auth/login", { identifier, password }, false);
    api.setTokens(data.accessToken, data.refreshToken, data.expiresIn, data.user.username);
    currentUser = data.user;
    emit("auth:changed", sessionState());
    log("info", `Connexion de ${data.user.username}`);
    return { user: data.user };
  });

  ipcMain.handle(
    "auth:register",
    async (
      _event,
      input: { email: string; username: string; password: string; discord: string; acceptedTerms: boolean },
    ) => {
      const data = await api.post<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        user: UserProfile;
        verification?: { devLink?: string };
      }>("/api/auth/register", input, false);
      api.setTokens(data.accessToken, data.refreshToken, data.expiresIn, data.user.username);
      currentUser = data.user;
      emit("auth:changed", sessionState());
      return { user: data.user, devLink: data.verification?.devLink };
    },
  );

  ipcMain.handle("auth:logout", async () => {
    try {
      await api.post("/api/auth/logout", {}, false);
    } catch {
      /* la session locale est supprimée de toute façon */
    }
    api.clearSession();
    currentUser = null;
    emit("auth:changed", sessionState());
    return undefined;
  });

  ipcMain.handle("auth:forgotPassword", async (_event, email: string) => {
    return api.post<{ devLink?: string }>("/api/auth/forgot-password", { email }, false);
  });

  ipcMain.handle("auth:resetPassword", async (_event, token: string, password: string) => {
    await api.post("/api/auth/reset-password", { token, password }, false);
    return undefined;
  });

  ipcMain.handle("auth:resendVerification", async () => {
    return api.post<{ devLink?: string }>("/api/auth/resend-verification", {});
  });

  ipcMain.handle("auth:updateProfile", async (_event, patch: Record<string, unknown>) => {
    const data = await api.patch<{ user: UserProfile; verificationSent?: boolean }>("/api/me", patch);
    currentUser = data.user;
    emit("auth:changed", sessionState());
    return data;
  });

  ipcMain.handle("auth:deleteAccount", async (_event, password: string, confirmation: string) => {
    await api.delete("/api/me", { password, confirmation });
    api.clearSession();
    currentUser = null;
    emit("auth:changed", sessionState());
    return undefined;
  });

  ipcMain.handle("content:config", async () => api.get<PublicConfig>("/api/config", false));
  ipcMain.handle("content:news", async (_event, limit = 20) =>
    api.get<{ announcements: Announcement[] }>(`/api/news?limit=${Number(limit) || 20}`, false),
  );
  ipcMain.handle("content:notifications", async () => {
    const data = await api.get<{ notifications: Announcement[] }>("/api/notifications", false);
    return data;
  });
  ipcMain.handle("content:manifest", async (_event, channel: ChannelSlug) =>
    api.get<BuildManifest>(`/api/builds/${channel}/manifest`, false),
  );

  ipcMain.handle("sync:start", async (_event, channel: ChannelSlug) => deps.sync.run(channel));
  ipcMain.handle("sync:repair", async (_event, channel: ChannelSlug) => deps.sync.run(channel, { repair: true }));
  ipcMain.handle("sync:pause", () => deps.sync.pause());
  ipcMain.handle("sync:resume", () => deps.sync.resume());
  ipcMain.handle("sync:stop", () => deps.sync.stop());
  ipcMain.handle("sync:progress", (): SyncProgress | null => deps.sync.getProgress());

  ipcMain.handle("game:launch", async (_event, channel: ChannelSlug) => deps.game.launch(channel));
  ipcMain.handle("game:kill", () => deps.game.kill());
  ipcMain.handle("game:status", () => deps.game.getStatus());
  ipcMain.handle("game:detectedJava", async (): Promise<JavaInfo | null> => detectJava(loadSettings().javaPath));

  ipcMain.handle("skin:preview", async (): Promise<SkinPreviewPayload> => {
    const user = currentUser ?? (await loadMe());
    if (!user?.skin) return { current: null, previous: null, model: "steve" };
    return {
      current: await skinDataUrl(user.skin.url),
      previous: await skinDataUrl(user.skin.previousUrl),
      model: user.skin.model,
    };
  });

  ipcMain.handle("skin:chooseFile", async () => {
    const window = deps.getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Choisir un skin PNG (64×64)",
      properties: ["openFile"],
      filters: [{ name: "Skin Minecraft", extensions: ["png"] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("skin:readFile", async (_event, filePath: string) => {
    try {
      const buffer = fs.readFileSync(filePath);
      if (buffer.length > 2 * 1024 * 1024) throw new Error("Fichier trop volumineux");
      return `data:image/png;base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle("skin:upload", async (_event, filePath: string, model: "steve" | "alex") => {
    const buffer = fs.readFileSync(filePath);
    const data = await api.putRaw<{ user: UserProfile }>(`/api/me/skin?model=${model}`, buffer, {
      "Content-Type": "image/png",
    });
    currentUser = data.user;
    emit("auth:changed", sessionState());
    return data;
  });

  ipcMain.handle("skin:restore", async () => {
    const data = await api.post<{ user: UserProfile }>("/api/me/skin/restore", {});
    currentUser = data.user;
    emit("auth:changed", sessionState());
    return data;
  });

  ipcMain.handle("support:report", async (_event, input: SupportReportInput) => {
    const logs = input.includeLogs ? readRecentLogs(500) : "";
    return api.post<{ id: string }>("/api/support/reports", {
      subject: input.subject,
      message: input.message,
      logs,
      system: input.system,
    });
  });

  ipcMain.handle("support:recentLogs", async (_event, lines = 300) => readRecentLogs(lines));
  ipcMain.handle("support:gameLogTail", async () => deps.game.getRecentLines());

  ipcMain.handle("support:exportLogs", async () => {
    const window = deps.getWindow();
    const options: Electron.SaveDialogOptions = {
      title: "Exporter les journaux Assetown",
      defaultPath: path.join(app.getPath("desktop"), `assetown-logs-${Date.now()}.zip`),
      filters: [{ name: "Archive ZIP", extensions: ["zip"] }],
    };
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;

    const zip = new AdmZip();
    const logsDir = logDirectory();
    if (fs.existsSync(logsDir)) {
      for (const file of fs.readdirSync(logsDir)) {
        const full = path.join(logsDir, file);
        if (fs.statSync(full).isFile()) zip.addLocalFile(full, "launcher-logs");
      }
    }
    for (const channel of ["v1", "v2", "v3"]) {
      const instanceLogs = path.join(loadSettings().installDir, channel, "logs");
      if (fs.existsSync(instanceLogs)) {
        for (const file of fs.readdirSync(instanceLogs)) {
          const full = path.join(instanceLogs, file);
          if (fs.statSync(full).isFile()) zip.addLocalFile(full, `${channel}-logs`);
        }
      }
      const crashDir = path.join(loadSettings().installDir, channel, "crash-reports");
      if (fs.existsSync(crashDir)) {
        for (const file of fs.readdirSync(crashDir).slice(-5)) {
          zip.addLocalFile(path.join(crashDir, file), `${channel}-crash-reports`);
        }
      }
    }
    zip.addFile(
      "system-info.txt",
      Buffer.from(
        [
          `Assetown Launcher ${app.getVersion()}`,
          `Electron ${process.versions.electron} — Node ${process.versions.node} — Chromium ${process.versions.chrome}`,
          `OS ${os.platform()} ${os.release()} ${os.arch()}`,
          `Utilisateur ${currentUser?.username ?? "non connecté"}`,
          `Date ${new Date().toISOString()}`,
        ].join("\n"),
        "utf8",
      ),
    );
    zip.writeZip(result.filePath);
    return result.filePath;
  });

  ipcMain.handle("events:noop", () => undefined);
}
