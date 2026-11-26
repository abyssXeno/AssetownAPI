import type { AssetownBridge, SessionState } from "../../shared/types";
import type { Announcement, PublicConfig, UserProfile } from "@assetown/shared";

/**
 * En mode navigateur (aperçu de développement), une passerelle HTTP minimale
 * permet de visualiser l'interface. Le téléchargement et le lancement du jeu
 * restent réservés à l'application Electron.
 */
const API_BASE =
  (import.meta.env.VITE_API_BASE as string) || "https://assetown-api-router-3e3dmn-preview.freebuff.site";

const notSupported = (feature: string) =>
  Promise.reject(new Error(`${feature} nécessite l'application Windows Assetown.`));

function readStore(): { access?: string; refresh?: string; user?: UserProfile } {
  try {
    return JSON.parse(localStorage.getItem("assetown.session") ?? "{}");
  } catch {
    return {};
  }
}

function writeStore(data: { access?: string; refresh?: string; user?: UserProfile } | null): void {
  if (!data) localStorage.removeItem("assetown.session");
  else localStorage.setItem("assetown.session", JSON.stringify(data));
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = readStore();
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session.access ? { Authorization: `Bearer ${session.access}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? `Erreur ${response.status}`);
  return payload as T;
}

const browserBridge: AssetownBridge = {
  app: {
    info: async () => ({
      appVersion: "1.0.0 (aperçu web)",
      electron: "—",
      node: "—",
      chrome: navigator.userAgent,
      platform: "browser",
      logFile: "—",
    }),
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    minimize: async () => undefined,
    close: async () => undefined,
  },
  settings: {
    get: async () => {
      try {
        return JSON.parse(localStorage.getItem("assetown.settings") ?? "{}");
      } catch {
        return {};
      }
    },
    save: async (patch) => {
      const current = JSON.parse(localStorage.getItem("assetown.settings") ?? "{}");
      const next = { ...current, ...patch };
      localStorage.setItem("assetown.settings", JSON.stringify(next));
      return next;
    },
    reset: async () => {
      localStorage.removeItem("assetown.settings");
      return {};
    },
    chooseInstallDir: async () => null,
    openInstallDir: async () => undefined,
    chooseJava: async () => null,
    clearCache: async () => ({ removedFiles: 0, freedBytes: 0 }),
  },
  auth: {
    state: async (): Promise<SessionState> => {
      const session = readStore();
      if (!session.refresh) {
        return { authenticated: false, user: null, offline: true, apiBaseUrl: API_BASE };
      }
      try {
        const data = await apiFetch<{ user: UserProfile }>("/api/me");
        writeStore({ ...session, user: data.user });
        return { authenticated: true, user: data.user, offline: false, apiBaseUrl: API_BASE };
      } catch {
        writeStore(null);
        return { authenticated: false, user: null, offline: true, apiBaseUrl: API_BASE };
      }
    },
    login: async (identifier, password) => {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: UserProfile;
      }>("/api/auth/login", { method: "POST", body: JSON.stringify({ identifier, password }) });
      writeStore({ access: data.accessToken, refresh: data.refreshToken, user: data.user });
      return { user: data.user };
    },
    register: async (input) => {
      const data = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: UserProfile;
        verification?: { devLink?: string };
      }>("/api/auth/register", { method: "POST", body: JSON.stringify(input) });
      writeStore({ access: data.accessToken, refresh: data.refreshToken, user: data.user });
      return { user: data.user, devLink: data.verification?.devLink };
    },
    logout: async () => {
      writeStore(null);
    },
    forgotPassword: async (email) => apiFetch("/api/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
    resetPassword: async () => notSupported("La réinitialisation"),
    resendVerification: async () => notSupported("La vérification par e-mail"),
    updateProfile: async (patch) =>
      apiFetch<{ user: UserProfile }>("/api/me", { method: "PATCH", body: JSON.stringify(patch) }),
    deleteAccount: async () => notSupported("La suppression de compte"),
  },
  content: {
    config: () => apiFetch<PublicConfig>("/api/config"),
    news: (limit = 20) => apiFetch<{ announcements: Announcement[] }>(`/api/news?limit=${limit}`),
    notifications: () => apiFetch<{ notifications: Announcement[] }>("/api/notifications"),
    manifest: async () => notSupported("La lecture du manifest"),
  },
  sync: {
    start: async () => notSupported("La synchronisation"),
    repair: async () => notSupported("La réparation"),
    pause: async () => undefined,
    resume: async () => undefined,
    stop: async () => undefined,
    progress: async () => null,
  },
  game: {
    launch: async () => notSupported("Le lancement du jeu"),
    kill: async () => undefined,
    status: async () => ({
      phase: "idle",
      channel: null,
      pid: null,
      startedAt: null,
      exitCode: null,
      message: "",
      crashReport: null,
    }),
    detectedJava: async () => null,
  },
  skin: {
    preview: async () => ({ current: null, previous: null, model: "steve" }),
    upload: async () => notSupported("L'envoi de skin"),
    chooseFile: async () => null,
    restore: async () => notSupported("La restauration de skin"),
    readFile: async () => null,
  },
  support: {
    report: async () => notSupported("L'envoi de rapport"),
    recentLogs: async () =>
      "Aperçu navigateur : les journaux du launcher sont disponibles dans l'application Windows.",
    exportLogs: async () => null,
    gameLogTail: async () => "",
  },
  events: {
    onSyncProgress: () => () => undefined,
    onGameStatus: () => () => undefined,
    onAuthChanged: () => () => undefined,
    onToast: () => () => undefined,
  },
};

export const isDesktop = Boolean(window.assetown);
export const bridge: AssetownBridge = window.assetown ?? browserBridge;
