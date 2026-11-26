import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, session, shell } from "electron";
import { initLogs, log } from "./logger.js";
import { loadSettings } from "./store.js";
import { SyncEngine } from "./sync.js";
import { GameManager } from "./game.js";
import { registerIpc } from "./ipc.js";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;

app.setName("Assetown");
app.setAppUserModelId("fr.assetown.launcher");
try {
  // Dossier de données stable et lisible : %APPDATA%/Assetown
  app.setPath("userData", path.join(app.getPath("appData"), "Assetown"));
} catch {
  /* conserve le chemin par défaut */
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

initLogs();
log("info", `Assetown Launcher ${app.getVersion()} démarrage (Electron ${process.versions.electron})`);
const settings = loadSettings();
try {
  fs.mkdirSync(settings.installDir, { recursive: true });
} catch (error) {
  log("warn", `Dossier d'installation inaccessible : ${(error as Error).message}`);
}

const webContentsOf = () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null);

const syncEngine = new SyncEngine((progress) => {
  webContentsOf()?.send("sync:progress", progress);
});

const gameManager = new GameManager(
  (status) => {
    webContentsOf()?.send("game:status", status);
    if (settings.closeOnLaunch && status.phase === "running" && mainWindow && settings.keepLauncherOpen) {
      mainWindow.minimize();
    }
  },
  (progress) => {
    webContentsOf()?.send("sync:progress", progress);
  },
);

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: "#08080f",
    title: "Assetown",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? "";
    if (url !== current && !url.startsWith(current.split("#")[0])) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          isDev
            ? "default-src 'self' 'unsafe-inline' data: blob: http://127.0.0.1:5183 ws://127.0.0.1:5183; img-src 'self' data: blob: https: http:; connect-src 'self' http://127.0.0.1:5183 ws://127.0.0.1:5183 https: http://127.0.0.1:* http://localhost:*"
            : "default-src 'self'; img-src 'self' data: blob: https: https://* http://127.0.0.1:* http://localhost:*; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: http://127.0.0.1:* http://localhost:*",
        ],
      },
    });
  });

  registerIpc({ getWindow: () => mainWindow, sync: syncEngine, game: gameManager });
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  log("error", `Exception non gérée : ${error.stack ?? error.message}`);
});
process.on("unhandledRejection", (reason) => {
  log("error", `Promesse rejetée : ${String(reason)}`);
});
