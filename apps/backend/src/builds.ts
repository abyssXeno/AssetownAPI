import crypto from "node:crypto";
import type { BuildInfo, BuildManifest, ChannelSlug, FileKind, LoaderType, ManifestFile } from "@assetown/shared";
import { DEFAULT_PROTECTED_PATHS } from "@assetown/shared";
import { config, SECRET } from "./env.js";
import { all, one, run } from "./db.js";
import { HttpError } from "./http.js";
import { now, shortEtag } from "./util.js";

export interface BuildRow {
  id: string;
  channel: ChannelSlug;
  label: string;
  description: string;
  changelog: string;
  minecraft_version: string;
  loader: LoaderType;
  loader_version: string;
  loader_profile_url: string | null;
  loader_profile_sha256: string | null;
  java_min_ram: number;
  java_max_ram: number;
  jvm_args: string;
  game_args: string;
  required: number;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  published_by: string | null;
}

export interface ChannelRow {
  slug: ChannelSlug;
  name: string;
  description: string;
  accent: string;
  enabled: number;
  server_host: string;
  server_port: number;
  discord_url: string | null;
  sort_order: number;
  active_build_id: string | null;
}

export interface BuildFileRow {
  id: string;
  build_id: string;
  path: string;
  size: number;
  sha256: string;
  kind: FileKind;
  required: number;
  storage_path: string;
}

export function getChannel(slug: string): ChannelRow | undefined {
  return one<ChannelRow>("SELECT * FROM channels WHERE slug = ?", slug);
}

export function listChannels(): ChannelRow[] {
  return all<ChannelRow>("SELECT * FROM channels ORDER BY sort_order ASC, slug ASC");
}

export function getBuild(id: string): BuildRow | undefined {
  return one<BuildRow>("SELECT * FROM builds WHERE id = ?", id);
}

export function activeBuild(channel: string): BuildRow | undefined {
  const row = one<BuildRow>(
    `SELECT b.* FROM builds b
     JOIN channels c ON c.active_build_id = b.id
     WHERE c.slug = ? AND b.status = 'published'`,
    channel,
  );
  if (row) return row;
  return one<BuildRow>(
    "SELECT * FROM builds WHERE channel = ? AND status = 'published' ORDER BY published_at DESC LIMIT 1",
    channel,
  );
}

export function buildFiles(buildId: string): BuildFileRow[] {
  return all<BuildFileRow>("SELECT * FROM build_files WHERE build_id = ? ORDER BY path ASC", buildId);
}

export function fileUrl(buildId: string, filePath: string): string {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const signature = crypto
    .createHmac("sha256", SECRET)
    .update(`${buildId}:${filePath}:${expires}`)
    .digest("base64url")
    .slice(0, 32);
  const query = new URLSearchParams({ path: filePath, exp: String(expires), sig: signature });
  return `${config.publicBaseUrl}/api/downloads/${buildId}?${query.toString()}`;
}

export function verifyDownloadSignature(buildId: string, filePath: string, exp: string, sig: string): boolean {
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${buildId}:${filePath}:${expires}`)
    .digest("base64url")
    .slice(0, 32);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function toBuildInfo(build: BuildRow): BuildInfo {
  return {
    id: build.id,
    channel: build.channel,
    label: build.label,
    description: build.description,
    changelog: build.changelog,
    minecraftVersion: build.minecraft_version,
    loader: build.loader,
    loaderVersion: build.loader_version,
    loaderProfileUrl: build.loader_profile_url,
    loaderProfileSha256: build.loader_profile_sha256,
    javaMinRam: build.java_min_ram,
    javaMaxRam: build.java_max_ram,
    jvmArgs: parseList(build.jvm_args),
    gameArgs: parseList(build.game_args),
    required: build.required === 1,
    publishedAt: build.published_at,
  };
}

export function parseList(value: string): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed)) return parsed.map((item) => String(item)).filter(Boolean);
  } catch {
    return value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

export function manifestFor(channelSlug: string): BuildManifest {
  const channel = getChannel(channelSlug);
  if (!channel) throw new HttpError(404, "channel_not_found", "Version inconnue");
  if (channel.enabled !== 1) {
    throw new HttpError(409, "channel_disabled", "Cette version est temporairement désactivée");
  }
  const build = activeBuild(channelSlug);
  if (!build) throw new HttpError(404, "no_build", "Aucun build publié pour cette version");

  const rows = buildFiles(build.id);
  const files: ManifestFile[] = rows.map((row) => ({
    path: row.path,
    sha256: row.sha256,
    size: row.size,
    url: fileUrl(build.id, row.path),
    kind: row.kind,
    required: row.required === 1,
  }));

  const directories = Array.from(
    new Set(
      files
        .map((file) => file.path.split("/").slice(0, -1).join("/"))
        .filter(Boolean),
    ),
  ).sort();

  const base = `${channelSlug}:${build.id}:${rows
    .map((row) => `${row.path}:${row.sha256}`)
    .join("|")}`;

  return {
    schemaVersion: 1,
    etag: shortEtag(base),
    generatedAt: now(),
    channel: channel.slug,
    channelName: channel.name,
    server: { host: channel.server_host, port: channel.server_port },
    build: toBuildInfo(build),
    files,
    directories,
    protectedPaths: [...DEFAULT_PROTECTED_PATHS],
    key: { minRam: build.java_min_ram, maxRam: build.java_max_ram },
  };
}

export function buildStats(buildId: string): { fileCount: number; totalSize: number } {
  const row = one<{ n: number; total: number | null }>(
    "SELECT COUNT(*) as n, SUM(size) as total FROM build_files WHERE build_id = ?",
    buildId,
  );
  return { fileCount: Number(row?.n ?? 0), totalSize: Number(row?.total ?? 0) };
}

export function recordEvent(kind: "download" | "launch", channel: string | null, buildId: string | null, userId: string | null): void {
  const day = new Date().toISOString().slice(0, 10);
  run(
    "INSERT INTO download_events (channel, build_id, user_id, kind, day, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    channel,
    buildId,
    userId,
    kind,
    day,
    now(),
  );
}
