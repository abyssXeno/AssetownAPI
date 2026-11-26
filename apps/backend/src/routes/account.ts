import type { Router } from "../http.js";
import { HttpError, jsonBody, sendJson } from "../http.js";
import {
  findUserByEmail,
  findUserByUsername,
  hashPassword,
  requireUser,
  revokeAllSessions,
  toProfile,
  verifyPassword,
  type UserRow,
} from "../auth.js";
import { all, one, run } from "../db.js";
import { audit } from "../audit.js";
import { optionalDiscord, requireEmail, requirePassword, requireString, requireUsername } from "../validation.js";
import { restoreSkin, saveSkin, deleteUserSkins } from "../skins.js";
import { now } from "../util.js";
import { sendMail, verificationEmail } from "../mail.js";
import { config, isProduction } from "../env.js";
import { hashToken, randomToken } from "../util.js";

function touchUser(id: string): UserRow {
  const user = one<UserRow>("SELECT * FROM users WHERE id = ?", id);
  if (!user) throw new HttpError(404, "user_not_found", "Compte introuvable");
  return user;
}

export function registerAccountRoutes(router: Router): void {
  router.get("/api/me", async (ctx) => {
    const user = requireUser(ctx);
    sendJson(ctx.res, 200, { user: toProfile(user) });
  });

  router.patch("/api/me", async (ctx) => {
    const user = requireUser(ctx);
    const body = jsonBody<{
      username?: string;
      email?: string;
      discord?: string;
      currentPassword?: string;
      newPassword?: string;
      skinModel?: string;
    }>(ctx);

    const wantsIdentityChange = Boolean(body.username || body.email || body.newPassword);
    if (wantsIdentityChange) {
      if (!body.currentPassword || !verifyPassword(body.currentPassword, user.password_hash)) {
        throw new HttpError(403, "password_required", "Mot de passe actuel incorrect");
      }
    }

    const updates: Array<[string, string | number | null]> = [];
    let verificationLinkSent = false;

    if (body.username && body.username !== user.username) {
      const username = requireUsername(body.username);
      if (findUserByUsername(username)) throw new HttpError(409, "username_taken", "Ce pseudo Minecraft est déjà utilisé");
      updates.push(["username", username]);
      updates.push(["username_lower", username.toLowerCase()]);
    }

    if (body.email && body.email.toLowerCase() !== user.email.toLowerCase()) {
      const email = requireEmail(body.email);
      if (findUserByEmail(email)) throw new HttpError(409, "email_taken", "Cette adresse e-mail est déjà utilisée");
      updates.push(["email", email]);
      updates.push(["email_verified", 0]);
    }

    if (body.discord !== undefined) {
      updates.push(["discord", optionalDiscord(body.discord)]);
    }

    if (body.newPassword) {
      updates.push(["password_hash", hashPassword(requirePassword(body.newPassword))]);
    }

    if (body.skinModel === "steve" || body.skinModel === "alex") {
      updates.push(["skin_model", body.skinModel]);
    }

    if (updates.length === 0) {
      sendJson(ctx.res, 200, { user: toProfile(user) });
      return;
    }

    const assignments = updates.map(([column]) => `${column} = ?`).join(", ");
    run(`UPDATE users SET ${assignments} WHERE id = ?`, ...updates.map(([, value]) => value), user.id);

    if (body.newPassword) revokeAllSessions(user.id);

    if (body.email && body.email.toLowerCase() !== user.email.toLowerCase()) {
      const token = randomToken(32);
      run(
        "INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, used, created_at) VALUES (?, ?, 'verify', ?, 0, ?)",
        hashToken(token),
        user.id,
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        now(),
      );
      const link = `${config.publicBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
      const mail = verificationEmail(user.username, link);
      mail.to = body.email;
      await sendMail(mail);
      verificationLinkSent = true;
    }

    audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "account.update", user.id, {
      fields: updates.map(([column]) => column),
    });

    const updated = touchUser(user.id);
    sendJson(ctx.res, 200, {
      user: toProfile(updated),
      verificationSent: verificationLinkSent,
      requiresRelogin: Boolean(body.newPassword),
      devLink: !isProduction && verificationLinkSent ? undefined : undefined,
    });
  });

  router.delete("/api/me", async (ctx) => {
    const user = requireUser(ctx);
    const body = jsonBody<{ password?: string; confirmation?: string }>(ctx);
    if (!body.password || !verifyPassword(body.password, user.password_hash)) {
      throw new HttpError(403, "password_required", "Mot de passe incorrect");
    }
    if ((body.confirmation ?? "").trim().toLowerCase() !== user.username.toLowerCase()) {
      throw new HttpError(422, "confirmation_required", "Saisissez votre pseudo pour confirmer la suppression");
    }

    run("INSERT OR REPLACE INTO username_reservations (username_lower, reserved_at) VALUES (?, ?)", user.username_lower, now());
    run("DELETE FROM users WHERE id = ?", user.id);
    deleteUserSkins(user.id);
    audit({ id: null, label: `user:${user.username}`, ip: ctx.ip }, "account.delete", user.id, { username: user.username });
    sendJson(ctx.res, 200, { ok: true });
  });

  router.put("/api/me/skin", async (ctx) => {
    const user = requireUser(ctx);
    const model = ctx.query.get("model") === "alex" ? "alex" : "steve";
    if (!ctx.body || ctx.body.length === 0) throw new HttpError(422, "invalid_skin", "Aucun fichier reçu");
    saveSkin(user, ctx.body, model);
    const updated = touchUser(user.id);
    audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "account.skin_update", user.id, { model });
    sendJson(ctx.res, 200, { user: toProfile(updated) });
  });

  router.post("/api/me/skin/restore", async (ctx) => {
    const user = requireUser(ctx);
    const restored = restoreSkin(user);
    if (!restored) throw new HttpError(409, "no_previous_skin", "Aucun skin précédent à restaurer");
    const updated = touchUser(user.id);
    audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "account.skin_restore", user.id);
    sendJson(ctx.res, 200, { user: toProfile(updated) });
  });

  router.get("/api/me/sessions", async (ctx) => {
    const user = requireUser(ctx);
    const rows = all<{ id: string; created_at: string; last_used_at: string | null; ip: string | null; user_agent: string | null; revoked: number }>(
      `SELECT id, created_at, last_used_at, ip, user_agent, revoked FROM sessions
       WHERE user_id = ? AND revoked = 0 AND expires_at > ? ORDER BY created_at DESC`,
      user.id,
      now(),
    );
    sendJson(ctx.res, 200, {
      sessions: rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
        ip: row.ip,
        userAgent: row.user_agent,
      })),
    });
  });

  router.post("/api/me/sessions/revoke-all", async (ctx) => {
    const user = requireUser(ctx);
    revokeAllSessions(user.id);
    audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "account.sessions_revoked", user.id);
    sendJson(ctx.res, 200, { ok: true });
  });
}
