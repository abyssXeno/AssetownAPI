import type { AdminBridge, AdminSessionState, RequestPayload } from "../../shared/types";
import type { UserProfile } from "@assetown/shared";

const STORAGE_API = "assetown.admin.api";
const STORAGE_TOKENS = "assetown.admin.session";

const apiUrl = (): string =>
  window.assetownAdmin ? "" : localStorage.getItem(STORAGE_API) || "https://assetown-api-router-3e3dmn-preview.freebuff.site";

async function browserRequest<T>(payload: RequestPayload): Promise<T> {
  const stored = JSON.parse(localStorage.getItem(STORAGE_TOKENS) ?? "null") as
    | { accessToken: string; user: UserProfile }
    | null;
  const base = apiUrl();
  const response = await fetch(`${base}${payload.path}`, {
    method: payload.method,
    headers: {
      "Content-Type": "application/json",
      ...(stored?.accessToken ? { Authorization: `Bearer ${stored.accessToken}` } : {}),
      ...(payload.headers ?? {}),
    },
    body: payload.body === undefined ? undefined : JSON.stringify(payload.body),
  });
  const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(data?.error?.message ?? `Erreur ${response.status}`);
  return data as T;
}

const browserBridge: AdminBridge = {
  state: async (): Promise<AdminSessionState> => {
    const stored = JSON.parse(localStorage.getItem(STORAGE_TOKENS) ?? "null") as
      | { user: UserProfile }
      | null;
    return { authenticated: Boolean(stored?.user), user: stored?.user ?? null, apiBaseUrl: apiUrl() };
  },
  login: async (email, password) => {
    const data = await browserRequest<{ accessToken: string; refreshToken: string; user: UserProfile }>({
      method: "POST",
      path: "/api/admin/auth/login",
      body: { email, password },
    });
    localStorage.setItem(STORAGE_TOKENS, JSON.stringify(data));
    return { user: data.user };
  },
  logout: async () => {
    localStorage.removeItem(STORAGE_TOKENS);
  },
  request: (payload) => browserRequest(payload),
  getApiUrl: async () => apiUrl(),
  setApiUrl: async (url) => {
    localStorage.setItem(STORAGE_API, url.replace(/\/+$/, ""));
    localStorage.removeItem(STORAGE_TOKENS);
    return url;
  },
  pickFiles: async () => [],
  uploadBuildFile: async () => {
    throw new Error("L'envoi de fichiers nécessite l'application Windows Assetown Admin Panel.");
  },
  pickImage: async () => null,
  uploadImage: async () => {
    throw new Error("L'envoi d'images nécessite l'application Windows.");
  },
  app: {
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    minimize: async () => undefined,
    close: async () => undefined,
    version: async () => "aperçu web",
  },
};

export const isDesktopAdmin = Boolean(window.assetownAdmin);
export const bridge: AdminBridge = window.assetownAdmin ?? browserBridge;

export const api = {
  get: <T>(path: string) => bridge.request<T>({ method: "GET", path }),
  post: <T>(path: string, body?: unknown) => bridge.request<T>({ method: "POST", path, body }),
  patch: <T>(path: string, body?: unknown) => bridge.request<T>({ method: "PATCH", path, body }),
  put: <T>(path: string, body?: unknown) => bridge.request<T>({ method: "PUT", path, body }),
  delete: <T>(path: string, body?: unknown) => bridge.request<T>({ method: "DELETE", path, body }),
};
