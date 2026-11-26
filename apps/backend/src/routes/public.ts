import fs from "node:fs";
import path from "node:path";
import type { Announcement, AnnouncementType, ChannelSummary, PublicConfig } from "@assetown/shared";
import type { Router } from "../http.js";
import { HttpError, jsonBody, sendFile, sendJson } from "../http.js";
import { all, one, run } from "../db.js";
import { getBranding } from "../branding.js";
import {
  activeBuild,
  buildFiles,
  getBuild,
  listChannels,
  manifestFor,
  recordEvent,
  verifyDownloadSignature,
} from "../builds.js";
import { cachedPing } from "../ping.js";
import { optionalUser, requireUser, toProfile } from "../auth.js";
import { REPORT_STORAGE } from "../env.js";
import { audit } from "../audit.js";
import { notifyWebhook } from "../webhook.js";
import { ensureDir, now, uid } from "../util.js";
import { requireString } from "../validation.js";
import { findUserByUsername } from "../auth.js";
import { skinFilePath } from "../skins.js";

function announcementFromRow(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  pinned: number;
  published_at: string;
  event_at: string | null;
  author: string | null;
}): Announcement {
  return {
    id: row.id,
    type: (row.type as AnnouncementType) ?? "news",
    title: row.title,
    body: row.body,
    imageUrl: row.image_url,
    linkUrl: row.link_url,
    linkLabel: row.link_label,
    pinned: row.pinned === 1,
    publishedAt: row.published_at,
    eventAt: row.event_at,
    author: row.author ?? "Assetown",
  };
}

export function registerPublicRoutes(router: Router): void {
  router.get("/api/config", async (ctx) => {
    const branding = getBranding();
    const channels = listChannels();
    const statuses = await Promise.all(channels.map((channel) => cachedPing(channel.server_host, channel.server_port)));

    const summaries: ChannelSummary[] = channels.map((channel, index) => {
      const build = activeBuild(channel.slug);
      return {
        slug: channel.slug,
        name: channel.name,
        description: channel.description,
        accent: channel.accent,
        enabled: channel.enabled === 1,
        serverHost: channel.server_host,
        serverPort: channel.server_port,
        discordUrl: channel.discord_url,
        activeBuild: build
          ? {
              id: build.id,
              label: build.label,
              minecraftVersion: build.minecraft_version,
              loader: build.loader,
              publishedAt: build.published_at,
              changelog: build.changelog,
            }
          : null,
        status: statuses[index],
      };
    });

    const payload: PublicConfig & { serverTime: string } = {
      brandName: branding.brandName,
      logoUrl: branding.logoUrl,
      bannerUrl: branding.bannerUrl,
      discordUrl: branding.discordUrl,
      websiteUrl: branding.websiteUrl,
      storeUrl: branding.storeUrl,
      supportUrl: branding.supportUrl,
      welcomeTitle: branding.welcomeTitle,
      welcomeText: branding.welcomeText,
      maintenance: branding.maintenance,
      channels: summaries,
      latestBuilds: summaries
        .filter((channel) => channel.activeBuild)
        .map((channel) => ({
          channel: channel.slug,
          label: channel.activeBuild!.label,
          publishedAt: channel.activeBuild!.publishedAt,
          changelog: channel.activeBuild!.changelog,
        })),
      serverTime: now(),
    };
    sendJson(ctx.res, 200, payload, { "Cache-Control": "no-store" });
  });

  router.get("/api/news", async (ctx) => {
    const limit = Math.min(50, Math.max(1, Number(ctx.query.get("limit") ?? 20)));
    const rows = all(
      `SELECT * FROM announcements
       WHERE datetime(published_at) <= datetime('now')
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       ORDER BY pinned DESC, datetime(published_at) DESC
       LIMIT ?`,
      limit,
    );
    sendJson(ctx.res, 200, { announcements: rows.map((row) => announcementFromRow(row as never)) });
  });

  router.get("/api/notifications", async (ctx) => {
    const announcements = all(
      `SELECT * FROM announcements
       WHERE datetime(published_at) <= datetime('now')
         AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       ORDER BY datetime(published_at) DESC LIMIT 8`,
    ).map((row) => announcementFromRow(row as never));

    const builds = listChannels()
      .map((channel) => ({ channel, build: activeBuild(channel.slug) }))
      .filter((entry) => entry.build?.published_at)
      .map((entry) => ({
        id: `build-${entry.build!.id}`,
        type: "update" as const,
        title: `${entry.channel.name} — ${entry.build!.label}`,
        body: entry.build!.changelog || entry.build!.description || "Nouveau build publié.",
        imageUrl: null,
        linkUrl: null,
        linkLabel: null,
        pinned: false,
        publishedAt: entry.build!.published_at!,
        eventAt: null,
        author: entry.channel.name,
      }));

    const items = [...announcements, ...builds].sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
    sendJson(ctx.res, 200, { notifications: items });
  });

  router.get("/api/builds/:channel/manifest", async (ctx) => {
    const channel = getBuildChannel(ctx.params.channel);
    const manifest = manifestFor(channel);
    const etag = `"${manifest.etag}"`;
    if (ctx.req.headers["if-none-match"] === etag) {
      ctx.res.writeHead(304, { ETag: etag, "Cache-Control": "no-cache" });
      ctx.res.end();
      return;
    }
    sendJson(ctx.res, 200, manifest, { ETag: etag, "Cache-Control": "no-cache" });
  });

  router.get("/api/builds/:channel/history", async (ctx) => {
    const rows = all<{
      id: string;
      label: string;
      status: string;
      published_at: string | null;
      minecraft_version: string;
      loader: string;
      changelog: string;
    }>(
      `SELECT id, label, status, published_at, minecraft_version, loader, changelog FROM builds
       WHERE channel = ? AND status IN ('published','archived') ORDER BY datetime(published_at) DESC LIMIT 30`,
      getBuildChannel(ctx.params.channel),
    );
    sendJson(ctx.res, 200, {
      builds: rows.map((row) => ({
        id: row.id,
        label: row.label,
        status: row.status,
        publishedAt: row.published_at,
        minecraftVersion: row.minecraft_version,
        loader: row.loader,
        changelog: row.changelog,
      })),
    });
  });

  router.get("/api/downloads/:buildId", async (ctx) => {
    const build = getBuild(ctx.params.buildId);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    const filePath = ctx.query.get("path") ?? "";
    const exp = ctx.query.get("exp") ?? "";
    const sig = ctx.query.get("sig") ?? "";
    if (!filePath || !verifyDownloadSignature(build.id, filePath, exp, sig)) {
      throw new HttpError(403, "invalid_signature", "Lien de téléchargement invalide ou expiré");
    }
    const row = one<{ storage_path: string; size: number }>(
      "SELECT storage_path, size FROM build_files WHERE build_id = ? AND path = ?",
      build.id,
      filePath,
    );
    if (!row) throw new HttpError(404, "file_not_found", "Fichier introuvable dans ce build");
    const absolute = path.isAbsolute(row.storage_path) ? row.storage_path : path.resolve(row.storage_path);
    if (!fs.existsSync(absolute)) throw new HttpError(404, "file_missing", "Fichier absent du stockage");

    recordEvent("download", build.channel, build.id, optionalUser(ctx)?.id ?? null);
    sendFile(ctx.req, ctx.res, absolute, {
      contentType: "application/octet-stream",
      cache: "public, max-age=3600",
      downloadName: path.basename(filePath),
    });
  });

  router.get("/api/skins/:file", async (ctx) => {
    const file = ctx.params.file;
    if (!file.endsWith(".png")) throw new HttpError(404, "not_found", "Introuvable");
    const username = file.slice(0, -4);
    const user = findUserByUsername(username);
    const absolute = user ? skinFilePath(user.skin_current) : null;
    if (!absolute) throw new HttpError(404, "skin_not_found", "Aucun skin pour ce joueur");
    sendFile(ctx.req, ctx.res, absolute, { contentType: "image/png", cache: "public, max-age=60" });
  });

  router.get("/api/skins/:username/previous.png", async (ctx) => {
    const user = findUserByUsername(ctx.params.username);
    const absolute = user ? skinFilePath(user.skin_previous) : null;
    if (!absolute) throw new HttpError(404, "skin_not_found", "Aucun skin précédent");
    sendFile(ctx.req, ctx.res, absolute, { contentType: "image/png", cache: "public, max-age=60" });
  });

  router.get("/api/uploads/:file", async (ctx) => {
    const { UPLOAD_STORAGE } = await import("../env.js");
    const name = path.basename(ctx.params.file);
    if (name !== ctx.params.file) throw new HttpError(404, "not_found", "Introuvable");
    const absolute = path.join(UPLOAD_STORAGE, name);
    if (!fs.existsSync(absolute)) throw new HttpError(404, "not_found", "Image introuvable");
    sendFile(ctx.req, ctx.res, absolute, { cache: "public, max-age=86400" });
  });

  router.post("/api/telemetry/:kind", async (ctx) => {
    const kind = ctx.params.kind;
    if (kind !== "download" && kind !== "launch") throw new HttpError(404, "not_found", "Type inconnu");
    const body = jsonBody<{ channel?: string; buildId?: string }>(ctx);
    recordEvent(kind, body.channel ?? null, body.buildId ?? null, optionalUser(ctx)?.id ?? null);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post("/api/support/reports", async (ctx) => {
    const user = requireUser(ctx);
    const body = jsonBody<{ subject?: string; message?: string; logs?: string; system?: string }>(ctx);
    const subject = requireString(body.subject, "sujet", { min: 3, max: 120 });
    const message = requireString(body.message, "message", { min: 10, max: 5000 });
    const logs = typeof body.logs === "string" ? body.logs.slice(0, 400_000) : "";
    ensureDir(REPORT_STORAGE);
    const id = uid("rep");
    const fileName = `${id}.log`;
    if (logs) fs.writeFileSync(path.join(REPORT_STORAGE, fileName), logs, "utf8");

    run(
      `INSERT INTO support_reports (id, user_id, username, subject, message, logs_path, system, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      id,
      user.id,
      user.username,
      subject,
      message,
      logs ? fileName : null,
      (body.system ?? "").slice(0, 400),
      now(),
    );
    audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "support.report_create", id, { subject });
    notifyWebhook({
      event: "support.report",
      title: "Nouveau ticket de support",
      username: user.username,
      color: 0x35d0a5,
      details: {
        reportId: id,
        userId: user.id,
        username: user.username,
        email: user.email,
        subject,
        message,
        system: (body.system ?? "").slice(0, 400),
        ip: ctx.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
        hasLogs: Boolean(logs),
        logsFile: logs ? fileName : null,
      },
    });
    sendJson(ctx.res, 201, { ok: true, id });
  });

  router.get("/api/me", async (ctx) => {
    const user = requireUser(ctx);
    sendJson(ctx.res, 200, { user: toProfile(user) });
  });
}

function getBuildChannel(value: string): string {
  if (!["v1", "v2", "v3"].includes(value)) {
    throw new HttpError(404, "channel_not_found", "Version inconnue (v1, v2 ou v3)");
  }
  return value;
}

export { getBuildChannel };
