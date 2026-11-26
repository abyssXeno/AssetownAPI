import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { log } from "./logger.js";

export function assertSecureUrl(url: string): URL {
  const parsed = new URL(url);
  const loopback = ["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`Téléchargement refusé (HTTPS requis) : ${url}`);
  }
  return parsed;
}

export async function fetchJson<T>(url: string, timeoutMs = 20_000, retries = 2): Promise<T> {
  assertSecureUrl(url);
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "AssetownLauncher/1.0", Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`);
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Téléchargement JSON impossible (${url}) : ${(lastError as Error)?.message ?? "inconnu"}`);
}

export async function fetchBuffer(url: string, timeoutMs = 60_000): Promise<Buffer> {
  assertSecureUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "AssetownLauncher/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function sha1File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha1");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function sha1Buffer(buffer: Buffer): string {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

export interface DownloadOptions {
  onProgress?: (bytesDone: number) => void;
  resumeFrom?: number;
  signal?: { aborted: boolean };
  timeoutMs?: number;
}

/**
 * Téléchargement reprenable : écrit dans `<fichier>.part`, reprend via l'en-tête
 * Range si une partie existe déjà, puis renvoie le nombre d'octets écrits.
 */
export async function downloadToFile(url: string, destination: string, options: DownloadOptions = {}): Promise<number> {
  assertSecureUrl(url);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partPath = `${destination}.part`;
  let startAt = options.resumeFrom ?? 0;
  if (startAt > 0 && fs.existsSync(partPath)) {
    const stat = fs.statSync(partPath);
    startAt = stat.size;
  } else {
    startAt = 0;
    fs.writeFileSync(partPath, Buffer.alloc(0));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AssetownLauncher/1.0",
        ...(startAt > 0 ? { Range: `bytes=${startAt}-` } : {}),
      },
    });

    if (response.status === 416) {
      // Partie déjà complète
      fs.renameSync(partPath, destination);
      return fs.statSync(destination).size;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${url}`);

    const resumed = response.status === 206;
    if (!resumed && startAt > 0) {
      fs.writeFileSync(partPath, Buffer.alloc(0));
      startAt = 0;
    }

    const stream = fs.createWriteStream(partPath, { flags: resumed ? "a" : "w" });
    let written = startAt;
    let lastReport = 0;

    const body = response.body as unknown as AsyncIterable<Uint8Array> | null;
    if (!body) throw new Error("Réponse vide du serveur de téléchargement");

    for await (const chunk of body) {
      if (options.signal?.aborted) {
        stream.close();
        throw new AbortedDownloadError(written);
      }
      if (options.signal?.aborted) break;
      await new Promise<void>((resolve, reject) => {
        const ok = stream.write(Buffer.from(chunk), (error) => (error ? reject(error) : resolve()));
        if (!ok) stream.once("drain", () => resolve());
        else resolve();
      });
      written += chunk.length;
      const nowMs = Date.now();
      if (options.onProgress && nowMs - lastReport > 120) {
        lastReport = nowMs;
        options.onProgress(written);
      }
    }

    await new Promise<void>((resolve, reject) => stream.end((error?: Error | null) => (error ? reject(error) : resolve())));
    stream.close();
    fs.renameSync(partPath, destination);
    options.onProgress?.(written);
    return written;
  } catch (error) {
    if (error instanceof AbortedDownloadError) throw error;
    if ((error as Error).name === "AbortError") {
      throw new AbortedDownloadError(startAt);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class AbortedDownloadError extends Error {
  constructor(public bytesWritten: number) {
    super("Téléchargement interrompu");
    this.name = "AbortedDownloadError";
  }
}

export function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

export async function verifyFile(filePath: string, expected: string, algorithm: "sha1" | "sha256" = "sha256"): Promise<boolean> {
  if (!fs.existsSync(filePath)) return false;
  try {
    const digest = algorithm === "sha1" ? await sha1File(filePath) : await sha256File(filePath);
    return digest.toLowerCase() === expected.toLowerCase();
  } catch (error) {
    log("warn", `Vérification impossible de ${filePath}: ${(error as Error).message}`);
    return false;
  }
}
