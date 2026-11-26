import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import path from "node:path";
import { DATA_DIR } from "./env.js";

export const db = new DatabaseSync(path.join(DATA_DIR, "assetown.db"));

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  discord TEXT,
  role TEXT NOT NULL DEFAULT 'player',
  permissions TEXT NOT NULL DEFAULT '[]',
  email_verified INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  skin_model TEXT NOT NULL DEFAULT 'steve',
  skin_current TEXT,
  skin_previous TEXT,
  skin_updated_at TEXT
);

CREATE TABLE IF NOT EXISTS username_reservations (
  username_lower TEXT PRIMARY KEY,
  reserved_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  ip TEXT,
  user_agent TEXT,
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS channels (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '#7c5cff',
  enabled INTEGER NOT NULL DEFAULT 1,
  server_host TEXT NOT NULL,
  server_port INTEGER NOT NULL,
  discord_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active_build_id TEXT
);

CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  changelog TEXT NOT NULL DEFAULT '',
  minecraft_version TEXT NOT NULL,
  loader TEXT NOT NULL DEFAULT 'vanilla',
  loader_version TEXT NOT NULL DEFAULT '',
  loader_profile_url TEXT,
  loader_profile_sha256 TEXT,
  java_min_ram INTEGER NOT NULL DEFAULT 2048,
  java_max_ram INTEGER NOT NULL DEFAULT 4096,
  jvm_args TEXT NOT NULL DEFAULT '[]',
  game_args TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  published_by TEXT
);

CREATE TABLE IF NOT EXISTS build_files (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'mod',
  required INTEGER NOT NULL DEFAULT 1,
  storage_path TEXT NOT NULL,
  UNIQUE (build_id, path),
  FOREIGN KEY (build_id) REFERENCES builds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'news',
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  image_url TEXT,
  link_url TEXT,
  link_label TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  published_at TEXT NOT NULL,
  expires_at TEXT,
  event_at TEXT,
  author TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS support_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  logs_path TEXT,
  system TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS download_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT,
  build_id TEXT,
  user_id TEXT,
  kind TEXT NOT NULL,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_builds_channel ON builds(channel, status);
CREATE INDEX IF NOT EXISTS idx_files_build ON build_files(build_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_downloads_day ON download_events(day);
`);

type Param = SQLInputValue;

function normalize(params: unknown[]): Param[] {
  return params.map((value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return Number.isInteger(value) ? value : value;
    if (typeof value === "string" || typeof value === "bigint") return value;
    return JSON.stringify(value);
  });
}

export function all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const stmt = db.prepare(sql);
  return stmt.all(...normalize(params)) as T[];
}

export function one<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
  const stmt = db.prepare(sql);
  const row = stmt.get(...normalize(params));
  return row as T | undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
  const stmt = db.prepare(sql);
  const result = stmt.run(...normalize(params));
  return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid as number | bigint };
}

export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getSetting(key: string, fallback = ""): string {
  const row = one<{ value: string }>("SELECT value FROM settings WHERE key = ?", key);
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    key,
    value,
  );
}

export function count(sql: string, ...params: unknown[]): number {
  const row = one<{ n: number }>(sql, ...params);
  return Number(row?.n ?? 0);
}
