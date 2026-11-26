import path from "node:path";
import { app, BrowserWindow, Menu, shell } from "electron";
import { registerAdminIpc } from "./ipc.js";

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let mainWindow: BrowserWindow | null = null;

app.setName("Assetown Admin Panel");
app.setAppUserModelId("fr.assetown.admin");
try {
  app.setPath("userData", path.join(app.getPath("appData"), "Assetown Admin Panel"));
} catch {
  /* conserve le chemin par défaut */
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: "#08080f",
    title: "Assetown Admin Panel",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const current = mainWindow?.webContents.getURL() ?? "";
    if (!url.startsWith(current.split("#")[0])) {
      event.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (isDev) void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
  else void mainWindow.loadFile(path.join(__dirname, "..", "dist", "renderer", "index.html"));
}

app.whenReady().then(() => {
  registerAdminIpc(() => mainWindow);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
