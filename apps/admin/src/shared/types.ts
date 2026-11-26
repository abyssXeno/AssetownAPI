import type { Role, UserProfile } from "@assetown/shared";

export interface AdminSessionState {
  authenticated: boolean;
  user: UserProfile | null;
  apiBaseUrl: string;
}

export interface RequestPayload {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
  rawPath?: string;
  headers?: Record<string, string>;
}

export interface PickedFile {
  path: string;
  name: string;
  size: number;
}

export interface AdminBridge {
  state(): Promise<AdminSessionState>;
  login(email: string, password: string): Promise<{ user: UserProfile }>;
  logout(): Promise<void>;
  request<T = unknown>(payload: RequestPayload): Promise<T>;
  getApiUrl(): Promise<string>;
  setApiUrl(url: string): Promise<string>;
  pickFiles(): Promise<PickedFile[]>;
  uploadBuildFile(
    buildId: string,
    filePath: string,
    relativePath: string | undefined,
    kind: string | undefined,
  ): Promise<{ path: string; sha256: string; size: number }>;
  pickImage(): Promise<string | null>;
  uploadImage(filePath: string): Promise<{ url: string }>;
  app: {
    openExternal(url: string): Promise<void>;
    minimize(): Promise<void>;
    close(): Promise<void>;
    version(): Promise<string>;
  };
}

declare global {
  interface Window {
    assetownAdmin?: AdminBridge;
  }
}

export type { Role };
