import { contextBridge, ipcRenderer } from "electron";

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>;

const bridge = {
  state: () => invoke("state"),
  login: (email: string, password: string) => invoke("login", email, password),
  logout: () => invoke("logout"),
  request: (payload: unknown) => invoke("request", payload),
  getApiUrl: () => invoke("getApiUrl"),
  setApiUrl: (url: string) => invoke("setApiUrl", url),
  pickFiles: () => invoke("pickFiles"),
  uploadBuildFile: (buildId: string, filePath: string, relativePath?: string, kind?: string) =>
    invoke("uploadBuildFile", buildId, filePath, relativePath, kind),
  pickImage: () => invoke("pickImage"),
  uploadImage: (filePath: string) => invoke("uploadImage", filePath),
  app: {
    openExternal: (url: string) => invoke("app:openExternal", url),
    minimize: () => invoke("app:minimize"),
    close: () => invoke("app:close"),
    version: () => invoke("app:version"),
  },
};

contextBridge.exposeInMainWorld("assetownAdmin", bridge);
