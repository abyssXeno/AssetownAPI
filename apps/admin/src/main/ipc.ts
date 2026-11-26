import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import type { UserProfile } from "@assetown/shared";
import type { AdminSessionState, PickedFile, RequestPayload } from "../shared/types.js";
import { loadAdminSettings, loadTokens, saveAdminSettings, saveTokens, type AdminTokens } from "./store.js";

let tokens: AdminTokens | null = loadTokens();
let currentUser: UserProfile | null = null;
let apiBaseUrl = loadAdminSettings().apiBaseUrl;

class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function baseUrl(): string {
  return apiBaseUrl.replace(/\/+$/, "");
}

function assertSecure(url: string): void {
  const parsed = new URL(url);
  const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new RequestError(0, "L'API doit utiliser HTTPS hors réseau local");
  }
}

async function refreshTokens(): Promise<boolean> {
  if (!tokens?.refreshToken) return false;
  const response = await fetch(`${baseUrl()}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: tokens.refreshToken }),
  });
  if (!response.ok) {
    tokens = null;
    currentUser = null;
    saveTokens(null);
    return false;
  }
  const data = (await response.json()) as {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    user: UserProfile;
  };
  tokens = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
    username: data.user.username,
  };
  currentUser = data.user;
  saveTokens(tokens);
  return true;
}

async function request<T>(payload: RequestPayload): Promise<T> {
  assertSecure(baseUrl());
  const url = `${baseUrl()}${payload.path}`;

  const perform = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Assetown-Client": "admin/1.0",
        ...(payload.headers ?? {}),
      };
      if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
      let body: string | Uint8Array | undefined;
      if (payload.rawPath) {
        body = new Uint8Array(fs.readFileSync(payload.rawPath));
        headers["Content-Type"] = "application/octet-stream";
      } else if (payload.body !== undefined) {
        body = JSON.stringify(payload.body);
        headers["Content-Type"] = "application/json";
      }
      return await fetch(url, {
        method: payload.method,
        headers,
        body: body as never,
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") throw new RequestError(0, "Le serveur ne répond pas (timeout)");
      throw new RequestError(0, "Impossible de joindre l'API Assetown");
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await perform();
  if (response.status === 401 && tokens?.refreshToken) {
    if (await refreshTokens()) response = await perform();
  }

  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ?? `Erreur serveur (${response.status})`;
    throw new RequestError(response.status, message);
  }
  return data as T;
}

export function registerAdminIpc(getWindow: () => BrowserWindow | null): void {
  ipcMain.handle("state", async (): Promise<AdminSessionState> => {
    if (tokens && !currentUser) {
      try {
        const data = await request<{ user: UserProfile }>({ method: "GET", path: "/api/admin/me" });
        currentUser = data.user;
      } catch {
        if (!(await refreshTokens())) {
          tokens = null;
          currentUser = null;
        } else {
          try {
            const data = await request<{ user: UserProfile }>({ method: "GET", path: "/api/admin/me" });
            currentUser = data.user;
          } catch {
            currentUser = null;
          }
        }
      }
    }
    return { authenticated: Boolean(tokens && currentUser), user: currentUser, apiBaseUrl };
  });

  ipcMain.handle("login", async (_event, email: string, password: string) => {
    const data = await request<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user: UserProfile;
    }>({ method: "POST", path: "/api/admin/auth/login", body: { email, password } });
    tokens = {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
      username: data.user.username,
    };
    currentUser = data.user;
    saveTokens(tokens);
    return { user: data.user };
  });

  ipcMain.handle("logout", async () => {
    try {
      await request({ method: "POST", path: "/api/auth/logout", body: {} });
    } catch {
      /* déconnexion locale garantie */
    }
    tokens = null;
    currentUser = null;
    saveTokens(null);
  });

  ipcMain.handle("request", async (_event, payload: RequestPayload) => request(payload));

  ipcMain.handle("getApiUrl", () => apiBaseUrl);
  ipcMain.handle("setApiUrl", (_event, url: string) => {
    assertSecure(url);
    apiBaseUrl = url.replace(/\/+$/, "");
    saveAdminSettings({ apiBaseUrl });
    tokens = null;
    currentUser = null;
    saveTokens(null);
    return apiBaseUrl;
  });

  ipcMain.handle("pickFiles", async (): Promise<PickedFile[]> => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Sélectionner des fichiers de build",
      properties: ["openFile", "multiSelections"],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return [];
    return result.filePaths.map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
      size: fs.statSync(filePath).size,
    }));
  });

  ipcMain.handle(
    "uploadBuildFile",
    async (_event, buildId: string, filePath: string, relativePath?: string, kind?: string) => {
      const name = path.basename(filePath);
      const relative = relativePath?.trim() || (name.toLowerCase().endsWith(".jar") ? `mods/${name}` : `config/${name}`);
      const stat = fs.statSync(filePath);
      if (stat.size > 200 * 1024 * 1024) throw new Error("Fichier limité à 200 Mo");
      const query = new URLSearchParams({ path: relative });
      if (kind) query.set("kind", kind);
      return request<{ path: string; sha256: string; size: number }>({
        method: "PUT",
        path: `/api/admin/builds/${encodeURIComponent(buildId)}/files?${query.toString()}`,
        rawPath: filePath,
      });
    },
  );

  ipcMain.handle("pickImage", async () => {
    const window = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: "Choisir une image",
      properties: ["openFile"],
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
    };
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  ipcMain.handle("uploadImage", async (_event, filePath: string) => {
    return request<{ url: string }>({
      method: "PUT",
      path: "/api/admin/uploads/images",
      rawPath: filePath,
    });
  });

  ipcMain.handle("app:openExternal", async (_event, url: string) => {
    if (/^https:\/\//i.test(url)) await shell.openExternal(url);
  });
  ipcMain.handle("app:minimize", () => getWindow()?.minimize());
  ipcMain.handle("app:close", () => getWindow()?.close());
  ipcMain.handle("app:version", () => `${process.platform} · Electron ${process.versions.electron}`);
}
