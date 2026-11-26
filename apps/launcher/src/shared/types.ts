import type {
  Announcement,
  AuthSession,
  BuildManifest,
  ChannelSlug,
  PublicConfig,
  UserProfile,
} from "@assetown/shared";

export type SyncPhase =
  | "idle"
  | "preparing"
  | "checking"
  | "downloading"
  | "verifying"
  | "applying"
  | "completed"
  | "paused"
  | "error";

export interface SyncProgress {
  phase: SyncPhase;
  channel: ChannelSlug;
  percent: number;
  filesTotal: number;
  filesDone: number;
  bytesTotal: number;
  bytesDone: number;
  speedBps: number;
  currentFile: string;
  message: string;
  etaSeconds: number | null;
}

export interface SyncSummary {
  channel: ChannelSlug;
  buildLabel: string;
  downloaded: number;
  removed: number;
  skipped: number;
  bytes: number;
  durationMs: number;
  backupPath: string | null;
}

export type GamePhase = "idle" | "preparing" | "running" | "exited" | "crashed";

export interface GameStatus {
  phase: GamePhase;
  channel: ChannelSlug | null;
  pid: number | null;
  startedAt: number | null;
  exitCode: number | null;
  message: string;
  crashReport: string | null;
}

export interface JavaInfo {
  path: string;
  version: string;
  major: number;
  vendor: string;
}

export interface LauncherVersionInfo {
  appVersion: string;
  electron: string;
  node: string;
  chrome: string;
  platform: string;
  logFile: string;
}

export interface SessionState {
  authenticated: boolean;
  user: UserProfile | null;
  offline: boolean;
  apiBaseUrl: string;
}

export interface SkinPreviewPayload {
  current: string | null;
  previous: string | null;
  model: "steve" | "alex";
}

export interface SupportReportInput {
  subject: string;
  message: string;
  includeLogs: boolean;
  system: string;
}

export interface AssetownBridge {
  app: {
    info(): Promise<LauncherVersionInfo>;
    openExternal(url: string): Promise<void>;
    minimize(): Promise<void>;
    close(): Promise<void>;
  };
  settings: {
    get(): Promise<Record<string, unknown>>;
    save(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
    reset(): Promise<Record<string, unknown>>;
    chooseInstallDir(): Promise<string | null>;
    openInstallDir(channel?: string): Promise<void>;
    chooseJava(): Promise<string | null>;
    clearCache(): Promise<{ removedFiles: number; freedBytes: number }>;
  };
  auth: {
    state(): Promise<SessionState>;
    login(identifier: string, password: string): Promise<{ user: UserProfile }>;
    register(input: {
      email: string;
      username: string;
      password: string;
      discord: string;
      acceptedTerms: boolean;
    }): Promise<{ user: UserProfile; devLink?: string }>;
    logout(): Promise<void>;
    forgotPassword(email: string): Promise<{ devLink?: string }>;
    resetPassword(token: string, password: string): Promise<void>;
    resendVerification(): Promise<{ devLink?: string }>;
    updateProfile(patch: Record<string, unknown>): Promise<{ user: UserProfile }>;
    deleteAccount(password: string, confirmation: string): Promise<void>;
  };
  content: {
    config(): Promise<PublicConfig>;
    news(limit?: number): Promise<{ announcements: Announcement[] }>;
    notifications(): Promise<{ notifications: Announcement[] }>;
    manifest(channel: ChannelSlug): Promise<BuildManifest>;
  };
  sync: {
    start(channel: ChannelSlug): Promise<SyncSummary>;
    repair(channel: ChannelSlug): Promise<SyncSummary>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<void>;
    progress(): Promise<SyncProgress | null>;
  };
  game: {
    launch(channel: ChannelSlug): Promise<{ ok: boolean; message?: string }>;
    kill(): Promise<void>;
    status(): Promise<GameStatus>;
    detectedJava(): Promise<JavaInfo | null>;
  };
  skin: {
    preview(): Promise<SkinPreviewPayload>;
    upload(skinPath: string, model: "steve" | "alex"): Promise<{ user: UserProfile }>;
    chooseFile(): Promise<string | null>;
    restore(): Promise<{ user: UserProfile }>;
    readFile(path: string): Promise<string | null>;
  };
  support: {
    report(input: SupportReportInput): Promise<{ id: string }>;
    recentLogs(lines?: number): Promise<string>;
    exportLogs(): Promise<string | null>;
    gameLogTail(lines?: number): Promise<string>;
  };
  events: {
    onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
    onGameStatus(callback: (status: GameStatus) => void): () => void;
    onAuthChanged(callback: (session: SessionState) => void): () => void;
    onToast(callback: (toast: { kind: "info" | "success" | "error"; message: string }) => void): () => void;
  };
}

declare global {
  interface Window {
    assetown?: AssetownBridge;
  }
}

export type { AuthSession };
