import fs from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";

export interface AdminSettings {
  apiBaseUrl: string;
}

export interface AdminTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  username: string;
}

const settingsFile = () => path.join(app.getPath("userData"), "admin-settings.json");
const sessionFile = () => path.join(app.getPath("userData"), "admin-session.bin");

export function loadAdminSettings(): AdminSettings {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFile(), "utf8")) as Partial<AdminSettings>;
    return { apiBaseUrl: parsed.apiBaseUrl || "https://assetown-api-router-3e3dmn-preview.freebuff.site" };
  } catch {
    return { apiBaseUrl: "https://assetown-api-router-3e3dmn-preview.freebuff.site" };
  }
}

export function saveAdminSettings(patch: Partial<AdminSettings>): AdminSettings {
  const next = { ...loadAdminSettings(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function saveTokens(tokens: AdminTokens | null): void {
  try {
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
    if (!tokens) {
      if (fs.existsSync(sessionFile())) fs.unlinkSync(sessionFile());
      return;
    }
    const payload = JSON.stringify(tokens);
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(sessionFile(), safeStorage.encryptString(payload));
    } else {
      fs.writeFileSync(sessionFile(), Buffer.from(payload, "utf8").toString("base64"), "utf8");
    }
  } catch {
    /* ignore */
  }
}

export function loadTokens(): AdminTokens | null {
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
    const parsed = JSON.parse(payload) as AdminTokens;
    return parsed.refreshToken ? parsed : null;
  } catch {
    return null;
  }
}
