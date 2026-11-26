import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function uid(prefix = ""): string {
  const id = crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}

export function now(): string {
  return new Date().toISOString();
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function sha256(buffer: Buffer | string): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function hashToken(token: string): string {
  return sha256(`assetown:${token}`);
}

export function shortEtag(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 20);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Empêche toute traversée de répertoire dans un chemin fourni par un client. */
export function safeRelativePath(input: string): string | null {
  if (!input) return null;
  const normalized = input.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized || normalized.includes("\0")) return null;
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "." || segment === "")) return null;
  if (/^[a-zA-Z]:/.test(normalized)) return null;
  if (segments.length > 12 || normalized.length > 300) return null;
  return segments.join("/");
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function fileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function resolveInside(root: string, relative: string): string | null {
  const safe = safeRelativePath(relative);
  if (!safe) return null;
  const resolved = path.resolve(root, safe);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) return null;
  return resolved;
}

export function copyTree(source: string, destination: string, skip: (rel: string) => boolean = () => false): number {
  let count = 0;
  if (!fs.existsSync(source)) return count;
  ensureDir(destination);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (skip(entry.name)) continue;
    if (entry.isDirectory()) {
      count += copyTree(from, to, skip);
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to);
      count += 1;
    }
  }
  return count;
}
