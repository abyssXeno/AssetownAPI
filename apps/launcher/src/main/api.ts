import { loadSettings, saveSession, loadSession, type SecureSession } from "./store.js";
import { log } from "./logger.js";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function isLoopback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export function validateBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ApiError(0, "invalid_url", "Adresse du serveur Assetown invalide");
  }
  if (parsed.protocol !== "https:" && !isLoopback(trimmed)) {
    throw new ApiError(0, "insecure_url", "L'API Assetown doit utiliser HTTPS hors réseau local");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError(0, "invalid_url", "Protocole non supporté");
  }
  return trimmed;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  raw?: Buffer;
  headers?: Record<string, string>;
  auth?: boolean;
  timeoutMs?: number;
  expectNoContent?: boolean;
}

export class ApiClient {
  private accessToken = "";
  private refreshToken = "";
  private expiresAt = 0;
  private baseUrl = "";
  private refreshing: Promise<void> | null = null;

  constructor() {
    this.baseUrl = loadSettings().apiBaseUrl;
    const stored = loadSession();
    if (stored) {
      this.accessToken = stored.accessToken;
      this.refreshToken = stored.refreshToken;
      this.expiresAt = stored.expiresAt;
    }
  }

  getBaseUrl(): string {
    const configured = loadSettings().apiBaseUrl;
    if (configured !== this.baseUrl) this.baseUrl = configured;
    return this.baseUrl;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = validateBaseUrl(url);
    this.clearSession();
  }

  hasSession(): boolean {
    return Boolean(this.refreshToken);
  }

  setTokens(accessToken: string, refreshToken: string, expiresIn: number, username: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.expiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
    const session: SecureSession = {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + expiresIn * 1000,
      username,
    };
    saveSession(session);
  }

  clearSession(): void {
    this.accessToken = "";
    this.refreshToken = "";
    this.expiresAt = 0;
    saveSession(null);
  }

  async refresh(): Promise<void> {
    if (!this.refreshToken) throw new ApiError(401, "unauthenticated", "Session absente");
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await fetch(`${this.getBaseUrl()}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
      });
      if (!response.ok) {
        this.clearSession();
        throw new ApiError(401, "session_expired", "Session expirée, reconnectez-vous");
      }
      const data = (await response.json()) as {
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
        user: { username: string };
      };
      this.setTokens(data.accessToken, data.refreshToken, data.expiresIn, data.user.username);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const doFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "X-Assetown-Client": "launcher/1.0",
        ...options.headers,
      };
      if (options.auth !== false && this.accessToken) {
        headers.Authorization = `Bearer ${this.accessToken}`;
      }
      let body: string | Uint8Array | undefined;
      if (options.raw) {
        body = new Uint8Array(options.raw);
        headers["Content-Type"] = headers["Content-Type"] ?? "application/octet-stream";
      } else if (options.body !== undefined) {
        body = JSON.stringify(options.body);
        headers["Content-Type"] = "application/json";
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
      try {
        return await fetch(`${this.getBaseUrl()}${path}`, {
          method: options.method ?? "GET",
          headers,
          body: body as never,
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          throw new ApiError(0, "timeout", "Le serveur Assetown met trop de temps à répondre");
        }
        throw new ApiError(
          0,
          "network_error",
          "Impossible de joindre le serveur Assetown. Vérifiez votre connexion ou l'adresse de l'API.",
        );
      } finally {
        clearTimeout(timer);
      }
    };

    let response = await doFetch();
    if (response.status === 401 && options.auth !== false && this.refreshToken) {
      try {
        await this.refresh();
        response = await doFetch();
      } catch (error) {
        log("warn", `Rafraîchissement de session impossible: ${(error as Error).message}`);
      }
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorBody = payload as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(
        response.status,
        errorBody?.error?.code ?? "request_failed",
        errorBody?.error?.message ?? `Erreur serveur (${response.status})`,
      );
    }
    return payload as T;
  }

  get<T>(path: string, auth = true): Promise<T> {
    return this.request<T>(path, { auth });
  }

  post<T>(path: string, body?: unknown, auth = true): Promise<T> {
    return this.request<T>(path, { method: "POST", body, auth });
  }

  patch<T>(path: string, body?: unknown, auth = true): Promise<T> {
    return this.request<T>(path, { method: "PATCH", body, auth });
  }

  putRaw<T>(path: string, raw: Buffer, headers: Record<string, string> = {}): Promise<T> {
    return this.request<T>(path, { method: "PUT", raw, headers, timeoutMs: 60_000 });
  }

  delete<T>(path: string, body?: unknown, auth = true): Promise<T> {
    return this.request<T>(path, { method: "DELETE", body, auth });
  }
}

export const api = new ApiClient();
