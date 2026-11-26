import { contextBridge, ipcRenderer } from "electron";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const bridge = {
  app: {
    info: () => invoke("app:info"),
    openExternal: (url: string) => invoke<void>("app:openExternal", url),
    minimize: () => invoke<void>("app:minimize"),
    close: () => invoke<void>("app:close"),
  },
  settings: {
    get: () => invoke("settings:get"),
    save: (patch: Record<string, unknown>) => invoke("settings:save", patch),
    reset: () => invoke("settings:reset"),
    chooseInstallDir: () => invoke("settings:chooseInstallDir"),
    openInstallDir: (channel?: string) => invoke("settings:openInstallDir", channel),
    chooseJava: () => invoke("settings:chooseJava"),
    clearCache: () => invoke("settings:clearCache"),
  },
  auth: {
    state: () => invoke("auth:state"),
    login: (identifier: string, password: string) => invoke("auth:login", identifier, password),
    register: (input: unknown) => invoke("auth:register", input),
    logout: () => invoke("auth:logout"),
    forgotPassword: (email: string) => invoke("auth:forgotPassword", email),
    resetPassword: (token: string, password: string) => invoke("auth:resetPassword", token, password),
    resendVerification: () => invoke("auth:resendVerification"),
    updateProfile: (patch: Record<string, unknown>) => invoke("auth:updateProfile", patch),
    deleteAccount: (password: string, confirmation: string) => invoke("auth:deleteAccount", password, confirmation),
  },
  content: {
    config: () => invoke("content:config"),
    news: (limit?: number) => invoke("content:news", limit),
    notifications: () => invoke("content:notifications"),
    manifest: (channel: string) => invoke("content:manifest", channel),
  },
  sync: {
    start: (channel: string) => invoke("sync:start", channel),
    repair: (channel: string) => invoke("sync:repair", channel),
    pause: () => invoke("sync:pause"),
    resume: () => invoke("sync:resume"),
    stop: () => invoke("sync:stop"),
    progress: () => invoke("sync:progress"),
  },
  game: {
    launch: (channel: string) => invoke("game:launch", channel),
    kill: () => invoke("game:kill"),
    status: () => invoke("game:status"),
    detectedJava: () => invoke("game:detectedJava"),
  },
  skin: {
    preview: () => invoke("skin:preview"),
    upload: (skinPath: string, model: "steve" | "alex") => invoke("skin:upload", skinPath, model),
    chooseFile: () => invoke("skin:chooseFile"),
    restore: () => invoke("skin:restore"),
    readFile: (filePath: string) => invoke("skin:readFile", filePath),
  },
  support: {
    report: (input: unknown) => invoke("support:report", input),
    recentLogs: (lines?: number) => invoke("support:recentLogs", lines),
    exportLogs: () => invoke("support:exportLogs"),
    gameLogTail: (lines?: number) => invoke("support:gameLogTail", lines),
  },
  events: {
    onSyncProgress: (callback: (progress: never) => void) => subscribe("sync:progress", callback),
    onGameStatus: (callback: (status: never) => void) => subscribe("game:status", callback),
    onAuthChanged: (callback: (session: never) => void) => subscribe("auth:changed", callback),
    onToast: (callback: (toast: never) => void) => subscribe("toast", callback),
  },
};

contextBridge.exposeInMainWorld("assetown", bridge);
