import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

let logDir = "";
let logFile = "";

export function initLogs(): { dir: string; file: string } {
  logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  logFile = path.join(logDir, "launcher.log");
  rotate();
  return { dir: logDir, file: logFile };
}

function rotate(): void {
  try {
    const stat = fs.statSync(logFile);
    if (stat.size > 4 * 1024 * 1024) {
      fs.renameSync(logFile, path.join(logDir, `launcher-${Date.now()}.log`));
    }
  } catch {
    /* pas encore de fichier */
  }
}

export function log(level: "info" | "warn" | "error", message: string): void {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  const prefix = level === "error" ? "✖" : level === "warn" ? "▲" : "•";
  console.log(`${prefix} ${message}`);
  if (!logFile) return;
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    /* ignore */
  }
}

export function readRecentLogs(maxLines = 400): string {
  try {
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - maxLines)).join("\n");
  } catch {
    return "";
  }
}

export function logDirectory(): string {
  return logDir;
}
