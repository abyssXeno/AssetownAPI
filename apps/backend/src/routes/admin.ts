import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { AdminBuild, AdminDashboard, AnnouncementType, BuildStatus, FileKind, Role } from "@assetown/shared";
import { PERMISSIONS, ROLES, ROLE_PERMISSIONS } from "@assetown/shared";
import type { Router } from "../http.js";
import { HttpError, jsonBody, sendFile, sendJson, UPLOAD_MAX_BODY } from "../http.js";
import { all, count, getSetting, one, run } from "../db.js";
import { findUserByEmail, requirePermission, requireUser, signAccessToken, verifyPassword, toProfile } from "../auth.js";
import { createSession, rateLimit, resetRateLimit } from "../auth.js";
import { audit, recentAudit } from "../audit.js";
import { notifyWebhook } from "../webhook.js";
import {
  activeBuild,
  buildFiles,
  buildStats,
  getBuild,
  getChannel,
  listChannels,
  parseList,
  type BuildRow,
} from "../builds.js";
import { cachedPing } from "../ping.js";
import { getBranding, saveBranding } from "../branding.js";
import { BUILD_STORAGE, REPORT_STORAGE, UPLOAD_STORAGE, config } from "../env.js";
import { ensureDir, fileSha256, now, safeRelativePath, sha256, uid } from "../util.js";
import { optionalDiscord, optionalString, parseStringArray, requireString, toBool, toInt } from "../validation.js";

const ROLE_RANK: Record<Role, number> = { player: 0, moderator: 1, admin: 2, owner: 3 };

function buildFromRow(row: BuildRow & { created_by_name?: string | null }): AdminBuild {
  const stats = buildStats(row.id);
  const files = buildFiles(row.id).map((file) => ({
    path: file.path,
    size: file.size,
    sha256: file.sha256,
    kind: file.kind,
  }));
  return {
    id: row.id,
    channel: row.channel,
    label: row.label,
    description: row.description,
    changelog: row.changelog,
    minecraftVersion: row.minecraft_version,
    loader: row.loader,
    loaderVersion: row.loader_version,
    loaderProfileUrl: row.loader_profile_url,
    javaMinRam: row.java_min_ram,
    javaMaxRam: row.java_max_ram,
    jvmArgs: row.jvm_args,
    gameArgs: row.game_args,
    required: row.required === 1,
    status: row.status as BuildStatus,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    createdBy: row.created_by,
    fileCount: stats.fileCount,
    totalSize: stats.totalSize,
    files,
  };
}

function assertBuildEditable(build: BuildRow): void {
  if (build.status === "published") {
    throw new HttpError(409, "build_locked", "Ce build est publié : archivez-le ou créez un nouveau build pour le modifier");
  }
}

function sanitizeKind(value: unknown): FileKind {
  const allowed: FileKind[] = ["mod", "config", "resourcepack", "shaderpack", "extra"];
  return allowed.includes(value as FileKind) ? (value as FileKind) : "mod";
}

function guessKind(filePath: string): FileKind {
  const lower = filePath.toLowerCase();
  if (lower.startsWith("mods/")) return "mod";
  if (lower.startsWith("config/") || lower.endsWith(".cfg") || lower.endsWith(".toml") || lower.endsWith(".json")) return "config";
  if (lower.startsWith("resourcepacks/")) return "resourcepack";
  if (lower.startsWith("shaderpacks/")) return "shaderpack";
  return "extra";
}

export function registerAdminRoutes(router: Router): void {
  router.post("/api/admin/auth/login", async (ctx) => {
    const body = jsonBody<{ email?: string; password?: string }>(ctx);
    const email = requireString(body.email, "email", { min: 3, max: 190, label: "L'adresse e-mail" });
    const password = requireString(body.password, "password", { min: 1, max: 128, label: "Le mot de passe" });
    rateLimit(`admin-login:${ctx.ip}:${email.toLowerCase()}`, 6, 10 * 60 * 1000);

    const user = findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      audit({ id: null, label: `anonymous:${email}`, ip: ctx.ip }, "admin.login_failed", null);
      throw new HttpError(401, "invalid_credentials", "Identifiants incorrects");
    }
    if (user.role === "player") {
      audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "admin.login_denied", user.id);
      throw new HttpError(403, "not_staff", "Ce compte n'a pas accès au panneau d'administration");
    }
    if (user.disabled === 1) throw new HttpError(403, "account_disabled", "Compte désactivé");

    resetRateLimit(`admin-login:${ctx.ip}:${email.toLowerCase()}`);
    run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), user.id);
    const session = createSession(user, ctx.ip, "assetown-admin");
    audit({ id: user.id, label: `admin:${user.username}`, ip: ctx.ip }, "admin.login", user.id);
    notifyWebhook({
      event: "auth.login",
      title: "Connexion au panneau admin",
      username: user.username,
      color: 0xffa53e,
      details: {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        ip: ctx.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
        where: "admin",
      },
    });
    sendJson(ctx.res, 200, {
      accessToken: signAccessToken(user.id, user.role),
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: toProfile(user),
      rolePermissions: ROLE_PERMISSIONS[user.role],
    });
  });

  router.get("/api/admin/me", async (ctx) => {
    const user = requireUser(ctx);
    if (user.role === "player") throw new HttpError(403, "not_staff", "Accès réservé à l'équipe");
    sendJson(ctx.res, 200, { user: toProfile(user) });
  });

  router.get("/api/admin/dashboard", async (ctx) => {
    requirePermission(ctx, "dashboard.view");
    const accounts = count("SELECT COUNT(*) as n FROM users");
    const activePlayers = count("SELECT COUNT(*) as n FROM users WHERE last_login_at IS NOT NULL AND datetime(last_login_at) > datetime('now', '-7 days')");
    const downloads = count("SELECT COUNT(*) as n FROM download_events WHERE kind = 'download'");
    const builds = count("SELECT COUNT(*) as n FROM builds");
    const announcements = count("SELECT COUNT(*) as n FROM announcements");
    const openReports = count("SELECT COUNT(*) as n FROM support_reports WHERE status = 'open'");

    const recentUsers = all<{ id: string; username: string; email: string; created_at: string; role: Role }>(
      "SELECT id, username, email, created_at, role FROM users ORDER BY datetime(created_at) DESC LIMIT 8",
    ).map((row) => ({ id: row.id, username: row.username, email: row.email, createdAt: row.created_at, role: row.role }));

    const recentBuilds = all<{ id: string; channel: string; label: string; status: string; published_at: string | null; file_count: number }>(
      `SELECT b.id, b.channel, b.label, b.status, b.published_at,
              (SELECT COUNT(*) FROM build_files f WHERE f.build_id = b.id) as file_count
       FROM builds b ORDER BY datetime(b.created_at) DESC LIMIT 8`,
    ).map((row) => ({
      id: row.id,
      channel: row.channel as AdminBuild["channel"],
      label: row.label,
      status: row.status as BuildStatus,
      publishedAt: row.published_at,
      fileCount: Number(row.file_count),
    }));

    const channels = listChannels();
    const statuses = await Promise.all(channels.map((channel) => cachedPing(channel.server_host, channel.server_port)));
    const channelStates = channels.map((channel, index) => {
      const build = activeBuild(channel.slug);
      return {
        slug: channel.slug,
        name: channel.name,
        enabled: channel.enabled === 1,
        activeBuild: build?.label ?? null,
        online: statuses[index].online,
        players: statuses[index].players?.online ?? null,
      };
    });

    const activity = all<{ day: string; n: number }>(
      `SELECT day, COUNT(*) as n FROM download_events
       WHERE kind = 'download' AND day >= date('now', '-13 days')
       GROUP BY day ORDER BY day ASC`,
    );
    const byDay = new Map(activity.map((row) => [row.day, Number(row.n)]));
    const buildActivity: Array<{ day: string; downloads: number }> = [];
    for (let i = 13; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      buildActivity.push({ day: date, downloads: byDay.get(date) ?? 0 });
    }

    const payload: AdminDashboard = {
      totals: { accounts, activePlayers, downloads, builds, announcements, openReports },
      recentUsers,
      recentBuilds,
      channelStates,
      audit: recentAudit(10),
      buildActivity,
    };
    sendJson(ctx.res, 200, payload);
  });

  router.get("/api/admin/players", async (ctx) => {
    requirePermission(ctx, "players.view");
    const search = (ctx.query.get("q") ?? "").trim();
    const limit = Math.min(100, Math.max(1, Number(ctx.query.get("limit") ?? 25)));
    const offset = Math.max(0, Number(ctx.query.get("offset") ?? 0));
    const like = `%${search}%`;
    const rows = search
      ? all(
          `SELECT * FROM users WHERE username LIKE ? OR email LIKE ? OR discord LIKE ?
           ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?`,
          like,
          like,
          like,
          limit,
          offset,
        )
      : all("SELECT * FROM users ORDER BY datetime(created_at) DESC LIMIT ? OFFSET ?", limit, offset);
    const total = search
      ? count("SELECT COUNT(*) as n FROM users WHERE username LIKE ? OR email LIKE ? OR discord LIKE ?", like, like, like)
      : count("SELECT COUNT(*) as n FROM users");
    sendJson(ctx.res, 200, {
      total,
      players: rows.map((row) => {
        const profile = toProfile(row as never);
        return {
          id: profile.id,
          username: profile.username,
          email: profile.email,
          discord: profile.discord,
          role: profile.role,
          emailVerified: profile.emailVerified,
          disabled: profile.disabled,
          createdAt: profile.createdAt,
          lastLoginAt: profile.lastLoginAt,
          skinUrl: profile.skin?.url ?? null,
          permissions: profile.permissions,
        };
      }),
    });
  });

  router.patch("/api/admin/players/:id", async (ctx) => {
    const actor = requirePermission(ctx, "players.manage");
    const target = one<{ id: string; username: string; role: Role; disabled: number }>(
      "SELECT id, username, role, disabled FROM users WHERE id = ?",
      ctx.params.id,
    );
    if (!target) throw new HttpError(404, "user_not_found", "Joueur introuvable");
    if (target.id === actor.id && ctx.body.length) {
      const body = jsonBody<{ disabled?: unknown; role?: unknown }>(ctx);
      if (body.disabled !== undefined || (body.role && body.role !== actor.role)) {
        throw new HttpError(409, "self_modification", "Vous ne pouvez pas modifier votre propre rôle ou état");
      }
    }
    if (ROLE_RANK[target.role] > ROLE_RANK[actor.role]) {
      throw new HttpError(403, "hierarchy", "Ce compte a un rôle supérieur au vôtre");
    }

    const body = jsonBody<{ disabled?: unknown; role?: unknown; permissions?: unknown; discord?: unknown }>(ctx);
    const changes: string[] = [];
    const values: Array<string | number | null> = [];

    if (body.disabled !== undefined) {
      const disabled = toBool(body.disabled);
      if (disabled && target.id === actor.id) throw new HttpError(409, "self_modification", "Impossible de désactiver votre compte");
      changes.push("disabled = ?");
      values.push(disabled ? 1 : 0);
      if (disabled) run("UPDATE sessions SET revoked = 1 WHERE user_id = ?", target.id);
    }

    if (body.role !== undefined) {
      const role = String(body.role) as Role;
      if (!ROLES.includes(role)) throw new HttpError(422, "invalid_role", "Rôle inconnu");
      if (role === "owner" && actor.role !== "owner") throw new HttpError(403, "hierarchy", "Seul un propriétaire peut nommer un propriétaire");
      if (ROLE_RANK[role] > ROLE_RANK[actor.role]) throw new HttpError(403, "hierarchy", "Rôle supérieur à votre niveau");
      changes.push("role = ?");
      values.push(role);
    }

    if (body.permissions !== undefined) {
      const permissions = parseStringArray(body.permissions).filter((permission) =>
        (PERMISSIONS as readonly string[]).includes(permission),
      );
      changes.push("permissions = ?");
      values.push(JSON.stringify(permissions));
    }

    if (body.discord !== undefined) {
      changes.push("discord = ?");
      values.push(optionalDiscord(body.discord));
    }

    if (changes.length === 0) throw new HttpError(422, "no_changes", "Aucune modification fournie");
    run(`UPDATE users SET ${changes.join(", ")} WHERE id = ?`, ...values, target.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "player.update", target.id, {
      username: target.username,
      changes: changes.map((change) => change.split(" = ")[0]),
    });
    const updated = one<{ id: string }>("SELECT id FROM users WHERE id = ?", target.id);
    sendJson(ctx.res, 200, { ok: true, id: updated?.id });
  });

  router.delete("/api/admin/players/:id", async (ctx) => {
    const actor = requirePermission(ctx, "players.manage");
    if (actor.role !== "owner") throw new HttpError(403, "hierarchy", "Seul un propriétaire peut supprimer un compte");
    const target = one<{ id: string; username: string; username_lower: string }>(
      "SELECT id, username, username_lower FROM users WHERE id = ?",
      ctx.params.id,
    );
    if (!target) throw new HttpError(404, "user_not_found", "Joueur introuvable");
    if (target.id === actor.id) throw new HttpError(409, "self_modification", "Impossible de supprimer votre propre compte");
    run("INSERT OR REPLACE INTO username_reservations (username_lower, reserved_at) VALUES (?, ?)", target.username_lower, now());
    run("DELETE FROM users WHERE id = ?", target.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "player.delete", target.id, { username: target.username });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/admin/builds", async (ctx) => {
    requirePermission(ctx, "builds.view");
    const channel = ctx.query.get("channel");
    const rows = channel
      ? all<BuildRow>("SELECT * FROM builds WHERE channel = ? ORDER BY datetime(created_at) DESC", channel)
      : all<BuildRow>("SELECT * FROM builds ORDER BY datetime(created_at) DESC");
    sendJson(ctx.res, 200, { builds: rows.map((row) => buildFromRow(row)) });
  });

  router.post("/api/admin/builds", async (ctx) => {
    const actor = requirePermission(ctx, "builds.edit");
    const body = jsonBody<Record<string, unknown>>(ctx);
    const channel = requireString(body.channel, "canal", { min: 2, max: 3 });
    if (!getChannel(channel)) throw new HttpError(404, "channel_not_found", "Version inconnue");
    const minecraftVersion = requireString(body.minecraftVersion, "version Minecraft", { min: 2, max: 20 });
    if (!/^\d+\.\d+(\.\d+)?$/.test(minecraftVersion)) {
      throw new HttpError(422, "invalid_version", "Version Minecraft invalide (ex: 1.20.1)");
    }
    const loader = String(body.loader ?? "vanilla");
    if (!["vanilla", "fabric", "forge", "neoforge"].includes(loader)) {
      throw new HttpError(422, "invalid_loader", "Loader inconnu");
    }
    const loaderVersion = optionalString(body.loaderVersion, 40) ?? "";
    if (loader !== "vanilla" && !loaderVersion) {
      throw new HttpError(422, "loader_version_required", "Indiquez la version du loader");
    }
    const id = uid("bld");
    const label = optionalString(body.label, 80) ?? `${channel.toUpperCase()} — ${minecraftVersion}`;
    run(
      `INSERT INTO builds (id, channel, label, description, changelog, minecraft_version, loader, loader_version,
        loader_profile_url, java_min_ram, java_max_ram, jvm_args, game_args, required, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      id,
      channel,
      label,
      optionalString(body.description, 1000) ?? "",
      optionalString(body.changelog, 4000) ?? "",
      minecraftVersion,
      loader,
      loaderVersion,
      optionalString(body.loaderProfileUrl, 500),
      toInt(body.javaMinRam, 2048, 512, 32768),
      toInt(body.javaMaxRam, 4096, 1024, 65536),
      JSON.stringify(parseStringArray(body.jvmArgs)),
      JSON.stringify(parseStringArray(body.gameArgs)),
      toBool(body.required) ? 1 : 0,
      actor.id,
      now(),
      now(),
    );
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.create", id, { channel, minecraftVersion, loader });
    const created = getBuild(id)!;
    sendJson(ctx.res, 201, { build: buildFromRow(created) });
  });

  router.patch("/api/admin/builds/:id", async (ctx) => {
    const actor = requirePermission(ctx, "builds.edit");
    const build = getBuild(ctx.params.id);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    assertBuildEditable(build);
    const body = jsonBody<Record<string, unknown>>(ctx);
    const changes: string[] = [];
    const values: Array<string | number | null> = [];

    const setString = (column: string, value: unknown, max: number) => {
      if (value === undefined) return;
      changes.push(`${column} = ?`);
      values.push(optionalString(value, max));
    };

    if (body.label !== undefined) {
      const label = requireString(body.label, "nom", { min: 2, max: 80 });
      changes.push("label = ?");
      values.push(label);
    }
    setString("description", body.description, 1000);
    setString("changelog", body.changelog, 4000);
    setString("loader_profile_url", body.loaderProfileUrl, 500);

    if (body.minecraftVersion !== undefined) {
      const version = requireString(body.minecraftVersion, "version Minecraft", { min: 2, max: 20 });
      if (!/^\d+\.\d+(\.\d+)?$/.test(version)) throw new HttpError(422, "invalid_version", "Version Minecraft invalide");
      changes.push("minecraft_version = ?");
      values.push(version);
    }
    if (body.loader !== undefined) {
      const loader = String(body.loader);
      if (!["vanilla", "fabric", "forge", "neoforge"].includes(loader)) {
        throw new HttpError(422, "invalid_loader", "Loader inconnu");
      }
      changes.push("loader = ?");
      values.push(loader);
    }
    if (body.loaderVersion !== undefined) {
      changes.push("loader_version = ?");
      values.push(optionalString(body.loaderVersion, 40) ?? "");
    }
    if (body.javaMinRam !== undefined) {
      changes.push("java_min_ram = ?");
      values.push(toInt(body.javaMinRam, 2048, 512, 32768));
    }
    if (body.javaMaxRam !== undefined) {
      changes.push("java_max_ram = ?");
      values.push(toInt(body.javaMaxRam, 4096, 1024, 65536));
    }
    if (body.jvmArgs !== undefined) {
      changes.push("jvm_args = ?");
      values.push(JSON.stringify(parseStringArray(body.jvmArgs)));
    }
    if (body.gameArgs !== undefined) {
      changes.push("game_args = ?");
      values.push(JSON.stringify(parseStringArray(body.gameArgs)));
    }
    if (body.required !== undefined) {
      changes.push("required = ?");
      values.push(toBool(body.required) ? 1 : 0);
    }

    if (changes.length === 0) throw new HttpError(422, "no_changes", "Aucune modification fournie");
    changes.push("status = ?", "updated_at = ?");
    values.push("draft", now());
    run(`UPDATE builds SET ${changes.join(", ")} WHERE id = ?`, ...values, build.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.update", build.id, { fields: changes });
    sendJson(ctx.res, 200, { build: buildFromRow(getBuild(build.id)!) });
  });

  router.delete("/api/admin/builds/:id", async (ctx) => {
    const actor = requirePermission(ctx, "builds.edit");
    const build = getBuild(ctx.params.id);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    const channel = getChannel(build.channel);
    if (channel?.active_build_id === build.id || build.status === "published") {
      throw new HttpError(409, "build_locked", "Impossible de supprimer le build actif. Publiez-en un autre d'abord.");
    }
    const dir = path.join(BUILD_STORAGE, build.id);
    fs.rmSync(dir, { recursive: true, force: true });
    run("DELETE FROM builds WHERE id = ?", build.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.delete", build.id, { label: build.label });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.put(
    "/api/admin/builds/:id/files",
    async (ctx) => {
      const actor = requirePermission(ctx, "builds.edit");
      const build = getBuild(ctx.params.id);
      if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
      assertBuildEditable(build);
      const rawPath = ctx.query.get("path") ?? "";
      const relative = safeRelativePath(rawPath);
      if (!relative) throw new HttpError(422, "invalid_path", "Chemin de fichier invalide");
      if (!ctx.body || ctx.body.length === 0) throw new HttpError(422, "empty_file", "Fichier vide");

      const dir = ensureDir(path.join(BUILD_STORAGE, build.id, path.posix.dirname(relative)));
      const target = path.join(dir, path.posix.basename(relative));
      fs.writeFileSync(target, ctx.body);
      const digest = sha256(ctx.body);
      const kind = ctx.query.get("kind") ? sanitizeKind(ctx.query.get("kind")) : guessKind(relative);
      const required = ctx.query.get("required") !== "0" ? 1 : 0;

      const existing = one<{ id: string }>("SELECT id FROM build_files WHERE build_id = ? AND path = ?", build.id, relative);
      if (existing) {
        run(
          "UPDATE build_files SET size = ?, sha256 = ?, kind = ?, required = ?, storage_path = ? WHERE id = ?",
          ctx.body.length,
          digest,
          kind,
          required,
          target,
          existing.id,
        );
      } else {
        run(
          "INSERT INTO build_files (id, build_id, path, size, sha256, kind, required, storage_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          uid("bf"),
          build.id,
          relative,
          ctx.body.length,
          digest,
          kind,
          required,
          target,
        );
      }
      run("UPDATE builds SET status = 'draft', updated_at = ? WHERE id = ?", now(), build.id);
      audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.file_upload", build.id, {
        path: relative,
        size: ctx.body.length,
      });
      sendJson(ctx.res, 200, { ok: true, path: relative, sha256: digest, size: ctx.body.length, kind });
    },
    { raw: true, maxBody: UPLOAD_MAX_BODY },
  );

  router.delete("/api/admin/builds/:id/files", async (ctx) => {
    const actor = requirePermission(ctx, "builds.edit");
    const build = getBuild(ctx.params.id);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    assertBuildEditable(build);
    const relative = safeRelativePath(ctx.query.get("path") ?? "");
    if (!relative) throw new HttpError(422, "invalid_path", "Chemin invalide");
    const row = one<{ id: string; storage_path: string }>(
      "SELECT id, storage_path FROM build_files WHERE build_id = ? AND path = ?",
      build.id,
      relative,
    );
    if (!row) throw new HttpError(404, "file_not_found", "Fichier introuvable");
    fs.rmSync(row.storage_path, { force: true });
    run("DELETE FROM build_files WHERE id = ?", row.id);
    run("UPDATE builds SET status = 'draft', updated_at = ? WHERE id = ?", now(), build.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.file_delete", build.id, { path: relative });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post("/api/admin/builds/:id/test", async (ctx) => {
    const actor = requirePermission(ctx, "builds.edit");
    const build = getBuild(ctx.params.id);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    assertBuildEditable(build);

    const files = buildFiles(build.id);
    const issues: Array<{ severity: "error" | "warning"; message: string }> = [];

    if (files.length === 0) issues.push({ severity: "warning", message: "Aucun fichier dans ce build (build vanilla sans mods/config)" });
    for (const file of files) {
      if (!fs.existsSync(file.storage_path)) {
        issues.push({ severity: "error", message: `Fichier manquant sur le stockage : ${file.path}` });
        continue;
      }
      const digest = await fileSha256(file.storage_path);
      if (digest !== file.sha256) {
        issues.push({ severity: "error", message: `Hash incohérent pour ${file.path}` });
      }
    }
    if (build.loader !== "vanilla" && !build.loader_version) {
      issues.push({ severity: "error", message: "Version du loader manquante" });
    }
    if ((build.loader === "forge" || build.loader === "neoforge") && !build.loader_profile_url) {
      issues.push({
        severity: "warning",
        message: "Aucun profil de version Forge/NeoForge fourni : le launcher téléchargera le profil officiel du loader.",
      });
    }
    if (build.java_max_ram < build.java_min_ram) {
      issues.push({ severity: "error", message: "La RAM maximale est inférieure à la RAM minimale" });
    }
    if (!/^\d+\.\d+(\.\d+)?$/.test(build.minecraft_version)) {
      issues.push({ severity: "error", message: "Version Minecraft invalide" });
    }
    if (build.loader_profile_url && !/^https:\/\//i.test(build.loader_profile_url) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(build.loader_profile_url)) {
      issues.push({ severity: "error", message: "Le profil de loader doit être servi en HTTPS" });
    }

    const errors = issues.filter((issue) => issue.severity === "error");
    const status = errors.length === 0 ? "tested" : "draft";
    run("UPDATE builds SET status = ?, updated_at = ? WHERE id = ?", status, now(), build.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.test", build.id, {
      errors: errors.length,
      warnings: issues.length - errors.length,
    });
    sendJson(ctx.res, 200, { ok: errors.length === 0, status, issues, fileCount: files.length });
  });

  router.post("/api/admin/builds/:id/publish", async (ctx) => {
    const actor = requirePermission(ctx, "builds.publish");
    const build = getBuild(ctx.params.id);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    const body = jsonBody<{ confirm?: unknown; changelog?: unknown }>(ctx);
    if (toBool(body.confirm) !== true) {
      throw new HttpError(428, "confirmation_required", "Confirmez explicitement la publication de ce build");
    }
    if (build.status !== "tested") {
      throw new HttpError(409, "build_not_tested", "Le build doit être testé avec succès avant publication");
    }
    if (build.channel !== getChannel(build.channel)?.slug) throw new HttpError(404, "channel_not_found", "Canal introuvable");

    if (body.changelog !== undefined) {
      run("UPDATE builds SET changelog = ? WHERE id = ?", optionalString(body.changelog, 4000) ?? "", build.id);
    }

    const channel = getChannel(build.channel)!;
    if (channel.active_build_id && channel.active_build_id !== build.id) {
      run(
        "UPDATE builds SET status = 'archived', updated_at = ? WHERE id = ? AND status = 'published'",
        now(),
        channel.active_build_id,
      );
    }
    run("UPDATE builds SET status = 'published', published_at = ?, published_by = ?, updated_at = ? WHERE id = ?", now(), actor.id, now(), build.id);
    run("UPDATE channels SET active_build_id = ? WHERE slug = ?", build.id, build.channel);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.publish", build.id, {
      channel: build.channel,
      label: build.label,
    });
    sendJson(ctx.res, 200, { ok: true, build: buildFromRow(getBuild(build.id)!) });
  });

  router.post("/api/admin/builds/:id/rollback", async (ctx) => {
    const actor = requirePermission(ctx, "builds.publish");
    const build = getBuild(ctx.params.id);
    if (!build) throw new HttpError(404, "build_not_found", "Build introuvable");
    const body = jsonBody<{ confirm?: unknown }>(ctx);
    if (toBool(body.confirm) !== true) {
      throw new HttpError(428, "confirmation_required", "Confirmez le retour à ce build");
    }
    if (!["archived", "published"].includes(build.status)) {
      throw new HttpError(409, "invalid_status", "Seuls les builds archivés peuvent être réactivés");
    }
    const channel = getChannel(build.channel)!;
    if (channel.active_build_id && channel.active_build_id !== build.id) {
      run("UPDATE builds SET status = 'archived' WHERE id = ? AND status = 'published'", channel.active_build_id);
    }
    run("UPDATE builds SET status = 'published', published_at = ?, published_by = ?, updated_at = ? WHERE id = ?", now(), actor.id, now(), build.id);
    run("UPDATE channels SET active_build_id = ? WHERE slug = ?", build.id, build.channel);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "build.rollback", build.id, { label: build.label });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/admin/channels", async (ctx) => {
    requirePermission(ctx, "builds.view");
    const channels = listChannels();
    const statuses = await Promise.all(channels.map((channel) => cachedPing(channel.server_host, channel.server_port)));
    sendJson(ctx.res, 200, {
      channels: channels.map((channel, index) => {
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
          activeBuildId: channel.active_build_id,
          activeBuildLabel: build?.label ?? null,
          activeBuildMinecraft: build?.minecraft_version ?? null,
          activeBuildLoader: build?.loader ?? null,
          status: statuses[index],
        };
      }),
    });
  });

  router.patch("/api/admin/channels/:slug", async (ctx) => {
    const actor = requirePermission(ctx, "settings.manage");
    const channel = getChannel(ctx.params.slug);
    if (!channel) throw new HttpError(404, "channel_not_found", "Version inconnue");
    const body = jsonBody<Record<string, unknown>>(ctx);
    const changes: string[] = [];
    const values: Array<string | number | null> = [];

    if (body.name !== undefined) {
      changes.push("name = ?");
      values.push(requireString(body.name, "nom", { min: 2, max: 60 }));
    }
    if (body.description !== undefined) {
      changes.push("description = ?");
      values.push(optionalString(body.description, 400) ?? "");
    }
    if (body.accent !== undefined) {
      const accent = String(body.accent);
      if (!/^#[0-9a-fA-F]{6}$/.test(accent)) throw new HttpError(422, "invalid_color", "Couleur invalide (#rrggbb)");
      changes.push("accent = ?");
      values.push(accent);
    }
    if (body.enabled !== undefined) {
      changes.push("enabled = ?");
      values.push(toBool(body.enabled) ? 1 : 0);
    }
    if (body.serverHost !== undefined) {
      const host = requireString(body.serverHost, "hôte", { min: 3, max: 120 });
      if (!/^[A-Za-z0-9.-]+$/.test(host)) throw new HttpError(422, "invalid_host", "Hôte Minecraft invalide");
      changes.push("server_host = ?");
      values.push(host);
    }
    if (body.serverPort !== undefined) {
      changes.push("server_port = ?");
      values.push(toInt(body.serverPort, 25565, 1, 65535));
    }
    if (body.discordUrl !== undefined) {
      changes.push("discord_url = ?");
      values.push(optionalString(body.discordUrl, 300));
    }

    if (changes.length === 0) throw new HttpError(422, "no_changes", "Aucune modification fournie");
    run(`UPDATE channels SET ${changes.join(", ")} WHERE slug = ?`, ...values, channel.slug);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "channel.update", channel.slug, { fields: changes });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/admin/announcements", async (ctx) => {
    requirePermission(ctx, "announcements.manage");
    const rows = all("SELECT * FROM announcements ORDER BY pinned DESC, datetime(published_at) DESC LIMIT 200");
    sendJson(ctx.res, 200, {
      announcements: rows.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: record.id,
          type: record.type,
          title: record.title,
          body: record.body,
          imageUrl: record.image_url,
          linkUrl: record.link_url,
          linkLabel: record.link_label,
          pinned: record.pinned === 1,
          publishedAt: record.published_at,
          expiresAt: record.expires_at,
          eventAt: record.event_at,
          author: record.author,
          createdAt: record.created_at,
          updatedAt: record.updated_at,
        };
      }),
    });
  });

  router.post("/api/admin/announcements", async (ctx) => {
    const actor = requirePermission(ctx, "announcements.manage");
    const body = jsonBody<Record<string, unknown>>(ctx);
    const type = ["news", "event", "maintenance", "update"].includes(String(body.type)) ? (String(body.type) as AnnouncementType) : "news";
    const title = requireString(body.title, "titre", { min: 3, max: 120 });
    const content = requireString(body.body, "contenu", { min: 3, max: 8000 });
    const id = uid("ann");
    const publishedAt = body.publishedAt ? new Date(String(body.publishedAt)) : new Date();
    if (Number.isNaN(publishedAt.getTime())) throw new HttpError(422, "invalid_date", "Date de publication invalide");
    run(
      `INSERT INTO announcements (id, type, title, body, image_url, link_url, link_label, pinned, published_at, expires_at, event_at, author, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      type,
      title,
      content,
      optionalString(body.imageUrl, 500),
      optionalString(body.linkUrl, 500),
      optionalString(body.linkLabel, 60),
      toBool(body.pinned) ? 1 : 0,
      publishedAt.toISOString(),
      body.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null,
      body.eventAt ? new Date(String(body.eventAt)).toISOString() : null,
      actor.username,
      now(),
      now(),
    );
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "announcement.create", id, { title });
    sendJson(ctx.res, 201, { ok: true, id });
  });

  router.patch("/api/admin/announcements/:id", async (ctx) => {
    const actor = requirePermission(ctx, "announcements.manage");
    const existing = one<{ id: string }>("SELECT id FROM announcements WHERE id = ?", ctx.params.id);
    if (!existing) throw new HttpError(404, "announcement_not_found", "Annonce introuvable");
    const body = jsonBody<Record<string, unknown>>(ctx);
    const changes: string[] = [];
    const values: Array<string | number | null> = [];

    if (body.title !== undefined) {
      changes.push("title = ?");
      values.push(requireString(body.title, "titre", { min: 3, max: 120 }));
    }
    if (body.body !== undefined) {
      changes.push("body = ?");
      values.push(requireString(body.body, "contenu", { min: 3, max: 8000 }));
    }
    if (body.type !== undefined) {
      const type = String(body.type);
      if (!["news", "event", "maintenance", "update"].includes(type)) throw new HttpError(422, "invalid_type", "Type invalide");
      changes.push("type = ?");
      values.push(type);
    }
    if (body.imageUrl !== undefined) {
      changes.push("image_url = ?");
      values.push(optionalString(body.imageUrl, 500));
    }
    if (body.linkUrl !== undefined) {
      changes.push("link_url = ?");
      values.push(optionalString(body.linkUrl, 500));
    }
    if (body.linkLabel !== undefined) {
      changes.push("link_label = ?");
      values.push(optionalString(body.linkLabel, 60));
    }
    if (body.pinned !== undefined) {
      changes.push("pinned = ?");
      values.push(toBool(body.pinned) ? 1 : 0);
    }
    if (body.publishedAt !== undefined) {
      changes.push("published_at = ?");
      values.push(new Date(String(body.publishedAt)).toISOString());
    }
    if (body.expiresAt !== undefined) {
      changes.push("expires_at = ?");
      values.push(body.expiresAt ? new Date(String(body.expiresAt)).toISOString() : null);
    }
    if (body.eventAt !== undefined) {
      changes.push("event_at = ?");
      values.push(body.eventAt ? new Date(String(body.eventAt)).toISOString() : null);
    }

    if (changes.length === 0) throw new HttpError(422, "no_changes", "Aucune modification fournie");
    changes.push("updated_at = ?");
    values.push(now());
    run(`UPDATE announcements SET ${changes.join(", ")} WHERE id = ?`, ...values, existing.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "announcement.update", existing.id, { fields: changes });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.delete("/api/admin/announcements/:id", async (ctx) => {
    const actor = requirePermission(ctx, "announcements.manage");
    const existing = one<{ id: string; title: string }>("SELECT id, title FROM announcements WHERE id = ?", ctx.params.id);
    if (!existing) throw new HttpError(404, "announcement_not_found", "Annonce introuvable");
    run("DELETE FROM announcements WHERE id = ?", existing.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "announcement.delete", existing.id, { title: existing.title });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.put(
    "/api/admin/uploads/images",
    async (ctx) => {
      const actor = requirePermission(ctx, "announcements.manage");
      if (!ctx.body || ctx.body.length === 0) throw new HttpError(422, "empty_file", "Aucune image reçue");
      if (ctx.body.length > 8 * 1024 * 1024) throw new HttpError(413, "too_large", "Image limitée à 8 Mo");
      const isPng = ctx.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = ctx.body[0] === 0xff && ctx.body[1] === 0xd8;
      const isWebp = ctx.body.subarray(0, 4).toString("ascii") === "RIFF" && ctx.body.subarray(8, 12).toString("ascii") === "WEBP";
      if (!isPng && !isJpeg && !isWebp) throw new HttpError(422, "invalid_image", "Formats acceptés : PNG, JPEG, WebP");
      const ext = isPng ? "png" : isJpeg ? "jpg" : "webp";
      const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
      ensureDir(UPLOAD_STORAGE);
      fs.writeFileSync(path.join(UPLOAD_STORAGE, name), ctx.body);
      audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "upload.image", name, { size: ctx.body.length });
      sendJson(ctx.res, 201, { url: `${config.publicBaseUrl}/api/uploads/${name}` });
    },
    { raw: true, maxBody: UPLOAD_MAX_BODY },
  );

  router.get("/api/admin/audit", async (ctx) => {
    requirePermission(ctx, "audit.view");
    const limit = Math.min(500, Math.max(1, Number(ctx.query.get("limit") ?? 100)));
    sendJson(ctx.res, 200, { entries: recentAudit(limit) });
  });

  router.get("/api/admin/settings", async (ctx) => {
    requirePermission(ctx, "settings.manage");
    sendJson(ctx.res, 200, {
      branding: getBranding(),
      metadata: {
        publicBaseUrl: config.publicBaseUrl,
        dataDir: path.dirname(BUILD_STORAGE),
        roles: ROLES,
        rolePermissions: ROLE_PERMISSIONS,
        permissions: PERMISSIONS,
        serverHost: config.defaultServerHost,
        serverPort: config.defaultServerPort,
      },
    });
  });

  router.patch("/api/admin/settings", async (ctx) => {
    const actor = requirePermission(ctx, "settings.manage");
    const body = jsonBody<Record<string, unknown>>(ctx);
    const branding = saveBranding({
      brandName: typeof body.brandName === "string" ? body.brandName : undefined,
      logoUrl: body.logoUrl === null ? null : typeof body.logoUrl === "string" ? body.logoUrl : undefined,
      bannerUrl: body.bannerUrl === null ? null : typeof body.bannerUrl === "string" ? body.bannerUrl : undefined,
      discordUrl: body.discordUrl === null ? null : typeof body.discordUrl === "string" ? body.discordUrl : undefined,
      websiteUrl: body.websiteUrl === null ? null : typeof body.websiteUrl === "string" ? body.websiteUrl : undefined,
      storeUrl: body.storeUrl === null ? null : typeof body.storeUrl === "string" ? body.storeUrl : undefined,
      supportUrl: body.supportUrl === null ? null : typeof body.supportUrl === "string" ? body.supportUrl : undefined,
      welcomeTitle: typeof body.welcomeTitle === "string" ? body.welcomeTitle : undefined,
      welcomeText: typeof body.welcomeText === "string" ? body.welcomeText : undefined,
      maintenance: body.maintenance as { enabled: boolean; message: string } | undefined,
    });
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "settings.update", null, {
      keys: Object.keys(body),
    });
    sendJson(ctx.res, 200, { branding });
  });

  router.get("/api/admin/reports", async (ctx) => {
    requirePermission(ctx, "reports.manage");
    const rows = all(
      `SELECT id, user_id, username, subject, message, logs_path, system, status, created_at FROM support_reports
       ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, datetime(created_at) DESC LIMIT 200`,
    );
    sendJson(ctx.res, 200, {
      reports: rows.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          id: record.id,
          userId: record.user_id,
          username: record.username,
          subject: record.subject,
          message: record.message,
          hasLogs: Boolean(record.logs_path),
          system: record.system,
          status: record.status,
          createdAt: record.created_at,
        };
      }),
    });
  });

  router.get("/api/admin/reports/:id", async (ctx) => {
    requirePermission(ctx, "reports.manage");
    const row = one<{
      id: string;
      username: string | null;
      subject: string;
      message: string;
      logs_path: string | null;
      system: string | null;
      status: string;
      created_at: string;
    }>(
      "SELECT id, username, subject, message, logs_path, system, status, created_at FROM support_reports WHERE id = ?",
      ctx.params.id,
    );
    if (!row) throw new HttpError(404, "report_not_found", "Rapport introuvable");
    let logs = "";
    if (row.logs_path) {
      const absolute = path.join(REPORT_STORAGE, path.basename(row.logs_path));
      if (fs.existsSync(absolute)) logs = fs.readFileSync(absolute, "utf8").slice(0, 300_000);
    }
    sendJson(ctx.res, 200, {
      report: {
        id: row.id,
        username: row.username,
        subject: row.subject,
        message: row.message,
        system: row.system,
        status: row.status,
        createdAt: row.created_at,
      },
      logs,
    });
  });

  router.get("/api/admin/reports/:id/logs", async (ctx) => {
    requirePermission(ctx, "reports.manage");
    const row = one<{ logs_path: string | null }>("SELECT logs_path FROM support_reports WHERE id = ?", ctx.params.id);
    if (!row?.logs_path) throw new HttpError(404, "no_logs", "Aucun journal pour ce rapport");
    const absolute = path.join(REPORT_STORAGE, path.basename(row.logs_path));
    if (!fs.existsSync(absolute)) throw new HttpError(404, "no_logs", "Journal introuvable");
    sendFile(ctx.req, ctx.res, absolute, { contentType: "text/plain; charset=utf-8", downloadName: `${ctx.params.id}.log` });
  });

  router.patch("/api/admin/reports/:id", async (ctx) => {
    const actor = requirePermission(ctx, "reports.manage");
    const body = jsonBody<{ status?: string }>(ctx);
    const status = String(body.status ?? "");
    if (!["open", "in_progress", "closed"].includes(status)) throw new HttpError(422, "invalid_status", "Statut invalide");
    run("UPDATE support_reports SET status = ? WHERE id = ?", status, ctx.params.id);
    audit({ id: actor.id, label: `admin:${actor.username}`, ip: ctx.ip }, "report.update", ctx.params.id, { status });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/admin/meta", async (ctx) => {
    const user = requireUser(ctx);
    if (user.role === "player") throw new HttpError(403, "not_staff", "Accès réservé");
    sendJson(ctx.res, 200, {
      permissions: PERMISSIONS,
      roles: ROLES,
      rolePermissions: ROLE_PERMISSIONS,
      buildStorage: getSetting("storage_root", BUILD_STORAGE),
      serverHost: config.defaultServerHost,
      serverPort: config.defaultServerPort,
      buildFileKinds: ["mod", "config", "resourcepack", "shaderpack", "extra"],
      loaderOptions: [
        { value: "vanilla", label: "Vanilla" },
        { value: "fabric", label: "Fabric" },
        { value: "forge", label: "Forge" },
        { value: "neoforge", label: "NeoForge" },
      ],
    });
  });
}
