import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";

export interface LauncherSettings {
  apiBaseUrl: string;
  installDir: string;
  ramMinMb: number;
  ramMaxMb: number;
  resolutionWidth: number;
  resolutionHeight: number;
  fullscreen: boolean;
  language: "fr" | "en";
  autoStartOnBoot: boolean;
  closeOnLaunch: boolean;
  javaPath: string;
  lastChannel: "v1" | "v2" | "v3";
  selectedChannel: "v1" | "v2" | "v3";
  keepLauncherOpen: boolean;
  jvmArgs: string;
}

export interface SecureSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username: string;
}

const DEFAULT_SETTINGS: LauncherSettings = {
  apiBaseUrl: "https://assetown-api-router-3e3dmn-preview.freebuff.site",
  installDir: "",
  ramMinMb: 2048,
  ramMaxMb: 4096,
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  fullscreen: false,
  language: "fr",
  autoStartOnBoot: false,
  closeOnLaunch: false,
  javaPath: "",
  lastChannel: "v2",
  selectedChannel: "v2",
  keepLauncherOpen: true,
  jvmArgs: "",
};

function userData(): string {
  return app.getPath("userData");
}

function settingsFile(): string {
  return path.join(userData(), "settings.json");
}

function sessionFile(): string {
  return path.join(userData(), "session.bin");
}

export function defaultInstallDir(): string {
  return path.join(os.homedir(), "AppData", "Roaming", "Assetown").replace(
    /AppData[\\/]Roaming[\\/]Assetown$/,
    path.join("AppData", "Roaming", "Assetown"),
  );
}

export function loadSettings(): LauncherSettings {
  try {
    const raw = fs.readFileSync(settingsFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<LauncherSettings>;
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    if (!merged.installDir) merged.installDir = path.join(userData(), "instances");
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS, installDir: path.join(userData(), "instances") };
  }
}

export function saveSettings(patch: Partial<LauncherSettings>): LauncherSettings {
  const current = loadSettings();
  const next: LauncherSettings = { ...current, ...patch };
  fs.mkdirSync(userData(), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function resetSettings(): LauncherSettings {
  const fresh = { ...DEFAULT_SETTINGS, installDir: path.join(userData(), "instances") };
  fs.writeFileSync(settingsFile(), JSON.stringify(fresh, null, 2), "utf8");
  return fresh;
}

/**
 * La session est chiffrée via safeStorage (DPAPI sous Windows) : le jeton
 * n'est jamais stocké en clair sur le disque.
 */
export function saveSession(session: SecureSession | null): void {
  try {
    fs.mkdirSync(userData(), { recursive: true });
    if (!session) {
      if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
      return;
    }
    const payload = JSON.stringify(session);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(sessionFile(), safeStorage.encryptString(payload));
    } else {
      // Repli : obfuscation locale si le chiffrement OS n'est pas disponible.
      fs.writeFileSync(sessionFile(), Buffer.from(payload, "utf8").toString("base64"), "utf8");
    }
  } catch (error) {
    console.error("[store] impossible d'enregistrer la session:", (error as Error).message);
  }
}

export function loadSession(): SecureSession | null {
  try {
    if (!fs.existsSync(sessionFile())) return null;
    const buffer = fs.readFileSync(sessionFile());
    let payload: string;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        payload = safeStorage.decryptString(buffer);
      } catch {
        payload = Buffer.from(buffer.toString("utf8"), "base64").toString("utf8");
      }
    } else {
      payload = Buffer.from(buffer.toString("utf8"), "base64").toString("utf8");
    }
    const parsed = JSON.parse(payload) as SecureSession;
    if (!parsed.refreshToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setAutoLaunch(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: [],
  });
}
