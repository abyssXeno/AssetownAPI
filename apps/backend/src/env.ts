import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** apps/backend (fonctionne depuis src/ via tsx et depuis dist/ après compilation) */
export const APP_DIR = path.basename(here) === "dist" ? path.resolve(here, "..") : path.resolve(here, "..");
export const REPO_DIR = path.resolve(APP_DIR, "../..");

// Chargement des fichiers .env (racine puis dossier backend)
for (const candidate of [path.join(REPO_DIR, ".env"), path.join(APP_DIR, ".env")]) {
  if (fs.existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore */
    }
  }
}

const env = process.env;

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const DATA_DIR = env.ASSETOWN_DATA_DIR
  ? path.resolve(env.ASSETOWN_DATA_DIR)
  : path.join(APP_DIR, "storage");

export const BUILD_STORAGE = path.join(DATA_DIR, "builds");
export const SKIN_STORAGE = path.join(DATA_DIR, "skins");
export const REPORT_STORAGE = path.join(DATA_DIR, "reports");
export const MAIL_OUTBOX = path.join(DATA_DIR, "mail-outbox");
export const UPLOAD_STORAGE = path.join(DATA_DIR, "uploads");

for (const dir of [DATA_DIR, BUILD_STORAGE, SKIN_STORAGE, REPORT_STORAGE, MAIL_OUTBOX, UPLOAD_STORAGE]) {
  fs.mkdirSync(dir, { recursive: true });
}

const SECRET_FILE = path.join(DATA_DIR, "secret.key");

function loadSecret(): string {
  if (env.ASSETOWN_SECRET && env.ASSETOWN_SECRET.length >= 16) return env.ASSETOWN_SECRET;
  if (fs.existsSync(SECRET_FILE)) {
    const stored = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (stored.length >= 16) return stored;
  }
  const generated = crypto.randomBytes(48).toString("base64url");
  fs.writeFileSync(SECRET_FILE, generated, { mode: 0o600 });
  return generated;
}

export const SECRET = loadSecret();

export const config = {
  port: num(env.PORT, 4200) || 4200,
  host: env.HOST && env.HOST.trim() ? env.HOST.trim() : "127.0.0.1",
  publicBaseUrl: (env.PUBLIC_BASE_URL ?? "http://127.0.0.1:4200").replace(/\/+$/, ""),
  trustProxy: bool(env.TRUST_PROXY, true),
  accessTtl: num(env.ACCESS_TOKEN_TTL, 3600),
  refreshTtl: num(env.REFRESH_TOKEN_TTL, 60 * 60 * 24 * 30),
  defaultServerHost: env.DEFAULT_SERVER_HOST ?? "play.assetown.fr",
  defaultServerPort: num(env.DEFAULT_SERVER_PORT, 25565),
  smtp: {
    host: env.SMTP_HOST ?? "",
    port: num(env.SMTP_PORT, 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER ?? "",
    pass: env.SMTP_PASS ?? "",
    from: env.SMTP_FROM ?? "Assetown <no-reply@assetown.fr>",
  },
  webhook: {
    url: (env.DISCORD_WEBHOOK_URL ?? "").trim(),
    key: (env.WEBHOOK_ENCRYPTION_KEY ?? "").trim(),
    plaintext: bool(env.WEBHOOK_PLAINTEXT, true),
    events: (env.WEBHOOK_EVENTS ?? "account.created,auth.login,support.report")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },
  initialAdmin: {
    email: env.INITIAL_ADMIN_EMAIL ?? "admin@assetown.fr",
    password: env.INITIAL_ADMIN_PASSWORD ?? "",
    username: env.INITIAL_ADMIN_USERNAME ?? "AssetownAdmin",
  },
  https: {
    keyFile: env.HTTPS_KEY_FILE ?? "",
    certFile: env.HTTPS_CERT_FILE ?? "",
  },
};

export const isProduction = env.NODE_ENV === "production";
