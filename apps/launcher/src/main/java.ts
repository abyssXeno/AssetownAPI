import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { JavaInfo } from "../shared/types.js";

function runJava(javaPath: string): Promise<JavaInfo | null> {
  return new Promise((resolve) => {
    execFile(javaPath, ["-version"], { timeout: 8000, windowsHide: true }, (_error, _stdout, stderr) => {
      const output = String(stderr || "");
      const match = /version "([^"]+)"/.exec(output);
      if (!match) {
        resolve(null);
        return;
      }
      const version = match[1];
      const major = Number.parseInt(version.startsWith("1.") ? version.split(".")[1] : version.split(".")[0], 10);
      const vendorMatch = /(?:\(build|Runtime Environment)[^\n]*/.exec(output);
      resolve({
        path: javaPath,
        version,
        major: Number.isFinite(major) ? major : 0,
        vendor: vendorMatch ? vendorMatch[0].trim().slice(0, 60) : "Java",
      });
    });
  });
}

function candidatePaths(): string[] {
  const candidates: string[] = [];
  if (process.env.JAVA_HOME) {
    candidates.push(path.join(process.env.JAVA_HOME, "bin", process.platform === "win32" ? "javaw.exe" : "java"));
    candidates.push(path.join(process.env.JAVA_HOME, "bin", "java"));
  }

  if (process.platform === "win32") {
    const roots = [
      "C:\\Program Files\\Java",
      "C:\\Program Files\\Eclipse Adoptium",
      "C:\\Program Files\\Microsoft",
      "C:\\Program Files\\Zulu",
      "C:\\Program Files\\BellSoft",
      "C:\\Program Files\\Amazon Corretto",
      path.join(os.homedir(), "AppData", "Local", "Programs", "Eclipse Adoptium"),
    ];
    for (const root of roots) {
      try {
        if (!fs.existsSync(root)) continue;
        for (const entry of fs.readdirSync(root)) {
          candidates.push(path.join(root, entry, "bin", "javaw.exe"));
          candidates.push(path.join(root, entry, "bin", "java.exe"));
        }
      } catch {
        /* ignore */
      }
    }
    // Runtime géré par le launcher Minecraft officiel
    candidates.push(path.join(os.homedir(), "AppData", "Local", "Packages"));
  } else if (process.platform === "darwin") {
    candidates.push("/usr/bin/java");
    candidates.push("/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home/bin/java");
    try {
      for (const entry of fs.readdirSync("/Library/Java/JavaVirtualMachines")) {
        candidates.push(`/Library/Java/JavaVirtualMachines/${entry}/Contents/Home/bin/java`);
      }
    } catch {
      /* ignore */
    }
  } else {
    candidates.push("/usr/bin/java", "/usr/local/bin/java");
    try {
      for (const entry of fs.readdirSync("/usr/lib/jvm")) candidates.push(`/usr/lib/jvm/${entry}/bin/java`);
    } catch {
      /* ignore */
    }
  }

  candidates.push(process.platform === "win32" ? "javaw.exe" : "java");
  return candidates;
}

let cached: JavaInfo | null | undefined;

export async function detectJava(preferredPath?: string): Promise<JavaInfo | null> {
  if (preferredPath && fs.existsSync(preferredPath)) {
    const info = await runJava(preferredPath);
    if (info) return info;
  }
  if (cached !== undefined) return cached;
  const seen = new Set<string>();
  const results: JavaInfo[] = [];
  for (const candidate of candidatePaths()) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (candidate.endsWith("Packages")) continue;
    if (candidate.includes(path.sep) && !fs.existsSync(candidate)) continue;
    const info = await runJava(candidate);
    if (info) results.push(info);
  }
  results.sort((a, b) => b.major - a.major);
  cached = results[0] ?? null;
  return cached;
}

export function clearJavaCache(): void {
  cached = undefined;
}

export function validateJavaPath(filePath: string): Promise<JavaInfo | null> {
  return runJava(filePath);
}
