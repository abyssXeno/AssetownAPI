import type { Router } from "../http.js";
import { HttpError, jsonBody, sendJson, sendText } from "../http.js";
import { config, isProduction } from "../env.js";
import { getSetting, one, run } from "../db.js";
import {
  createSession,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  hashPassword,
  rateLimit,
  resetRateLimit,
  requireUser,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  toProfile,
  verifyPassword,
} from "../auth.js";
import { optionalDiscord, requireEmail, requirePassword, requireString, requireUsername } from "../validation.js";
import { audit } from "../audit.js";
import { sendMail, resetEmail, verificationEmail } from "../mail.js";
import { notifyWebhook } from "../webhook.js";
import { hashToken, now, randomToken, uid } from "../util.js";

function createEmailToken(userId: string, kind: "verify" | "reset", ttlMs: number): string {
  const token = randomToken(32);
  run(
    "INSERT INTO email_tokens (token_hash, user_id, kind, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    hashToken(token),
    userId,
    kind,
    new Date(Date.now() + ttlMs).toISOString(),
    now(),
  );
  return token;
}

async function sendVerification(userId: string, email: string, username: string): Promise<string> {
  const token = createEmailToken(userId, "verify", 24 * 60 * 60 * 1000);
  const link = `${config.publicBaseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  const mail = verificationEmail(username, link);
  mail.to = email;
  await sendMail(mail);
  return link;
}

export function registerAuthRoutes(router: Router): void {
  router.post("/api/auth/register", async (ctx) => {
    const body = jsonBody<{ email?: string; username?: string; password?: string; discord?: string; acceptedTerms?: boolean }>(ctx);
    rateLimit(`register:${ctx.ip}`, 8, 10 * 60 * 1000);

    const email = requireEmail(body.email);
    const username = requireUsername(body.username);
    const password = requirePassword(body.password);
    const discord = optionalDiscord(body.discord);

    if (body.acceptedTerms === false) {
      throw new HttpError(422, "terms_required", "Vous devez accepter le règlement du serveur");
    }
    if (findUserByEmail(email)) {
      throw new HttpError(409, "email_taken", "Un compte utilise déjà cette adresse e-mail");
    }
    if (findUserByUsername(username)) {
      throw new HttpError(409, "username_taken", "Ce pseudo Minecraft est déjà utilisé");
    }
    const reserved = one<{ username_lower: string }>("SELECT username_lower FROM username_reservations WHERE username_lower = ?", username.toLowerCase());
    if (reserved) {
      throw new HttpError(409, "username_taken", "Ce pseudo Minecraft est réservé (compte supprimé récemment)");
    }

    const id = uid("usr");
    run(
      `INSERT INTO users (id, email, username, username_lower, password_hash, discord, role, permissions, email_verified, disabled, created_at, skin_model)
       VALUES (?, ?, ?, ?, ?, ?, 'player', '[]', 0, 0, ?, 'steve')`,
      id,
      email,
      username,
      username.toLowerCase(),
      hashPassword(password),
      discord,
      now(),
    );

    audit({ id, label: `user:${username}`, ip: ctx.ip }, "account.register", id, { email });
    notifyWebhook({
      event: "account.created",
      title: "Nouveau compte Assetown",
      username,
      color: 0x7c5cff,
      details: {
        userId: id,
        username,
        email,
        discord,
        ip: ctx.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
        channel: "launcher",
      },
    });
    const verificationLink = await sendVerification(id, email, username);
    const user = findUserById(id)!;
    const session = createSession(user, ctx.ip, ctx.req.headers["user-agent"] ?? null);

    sendJson(ctx.res, 201, {
      ...session,
      user: toProfile(user),
      verification: {
        required: true,
        // En développement, le lien est renvoyé pour permettre les tests sans SMTP.
        devLink: isProduction ? undefined : verificationLink,
      },
    });
  });

  router.post("/api/auth/login", async (ctx) => {
    const body = jsonBody<{ identifier?: string; password?: string }>(ctx);
    const identifier = requireString(body.identifier, "identifiant", { min: 3, max: 190, label: "L'identifiant" });
    const password = requireString(body.password, "password", { min: 1, max: 128, label: "Le mot de passe" });
    rateLimit(`login:${ctx.ip}:${identifier.toLowerCase()}`, 10, 5 * 60 * 1000);

    const user = findUserByEmail(identifier) ?? findUserByUsername(identifier);
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, "invalid_credentials", "Identifiants incorrects");
    }
    if (user.disabled === 1) {
      throw new HttpError(403, "account_disabled", "Ce compte a été désactivé. Contactez le support Assetown.");
    }

    resetRateLimit(`login:${ctx.ip}:${identifier.toLowerCase()}`);
    run("UPDATE users SET last_login_at = ? WHERE id = ?", now(), user.id);
    const session = createSession(user, ctx.ip, ctx.req.headers["user-agent"] ?? null);
    const refreshed = findUserById(user.id)!;
    audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "account.login", user.id);
    notifyWebhook({
      event: "auth.login",
      title: "Connexion au launcher",
      username: user.username,
      color: 0x3e86ff,
      details: {
        userId: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        ip: ctx.ip,
        userAgent: ctx.req.headers["user-agent"] ?? null,
        where: "launcher",
      },
    });

    sendJson(ctx.res, 200, { ...session, user: toProfile(refreshed) });
  });

  router.post("/api/auth/refresh", async (ctx) => {
    const body = jsonBody<{ refreshToken?: string }>(ctx);
    const token = requireString(body.refreshToken, "refreshToken", { min: 10, max: 500 });
    const rotated = rotateSession(token, ctx.ip, ctx.req.headers["user-agent"] ?? null);
    sendJson(ctx.res, 200, {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      expiresIn: rotated.expiresIn,
      user: toProfile(rotated.user),
    });
  });

  router.post("/api/auth/logout", async (ctx) => {
    const body = jsonBody<{ refreshToken?: string }>(ctx);
    if (body.refreshToken) revokeSession(String(body.refreshToken));
    sendJson(ctx.res, 200, { ok: true });
  });

  router.post("/api/auth/resend-verification", async (ctx) => {
    const user = requireUser(ctx);
    rateLimit(`verify-resend:${user.id}`, 3, 10 * 60 * 1000);
    if (user.email_verified === 1) {
      sendJson(ctx.res, 200, { ok: true, alreadyVerified: true });
      return;
    }
    const link = await sendVerification(user.id, user.email, user.username);
    sendJson(ctx.res, 200, { ok: true, devLink: isProduction ? undefined : link });
  });

  router.post("/api/auth/verify-email", async (ctx) => {
    const body = jsonBody<{ token?: string }>(ctx);
    const token = requireString(body.token, "token", { min: 10, max: 200 });
    const row = one<{ user_id: string; expires_at: string; used: number }>(
      "SELECT user_id, expires_at, used FROM email_tokens WHERE token_hash = ? AND kind = 'verify'",
      hashToken(token),
    );
    if (!row || row.used === 1) throw new HttpError(400, "invalid_token", "Lien de vérification invalide ou déjà utilisé");
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new HttpError(400, "expired_token", "Lien de vérification expiré");
    }
    run("UPDATE users SET email_verified = 1 WHERE id = ?", row.user_id);
    run("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND kind = 'verify'", row.user_id);
    const user = findUserById(row.user_id);
    audit({ id: row.user_id, label: `user:${user?.username ?? row.user_id}`, ip: ctx.ip }, "account.email_verified", row.user_id);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.get("/api/auth/verify-email", async (ctx) => {
    const token = ctx.query.get("token") ?? "";
    const html = (title: string, message: string, ok: boolean) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Assetown</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a12;color:#e9e9f4;font-family:system-ui,sans-serif}
.card{max-width:460px;padding:40px;border-radius:20px;background:#13131f;border:1px solid #26263a;text-align:center}
.badge{display:inline-block;padding:6px 14px;border-radius:99px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;background:${ok ? "rgba(124,92,255,.16)" : "rgba(255,90,110,.16)"};color:${ok ? "#a78bfa" : "#ff8095"}}
h1{font-size:22px;margin:18px 0 10px}p{color:#9c9cb5;line-height:1.6;margin:0}
</style></head>
<body><div class="card"><span class="badge">${ok ? "Vérifié" : "Erreur"}</span><h1>${title}</h1><p>${message}</p></div></body></html>`;

    const row = token
      ? one<{ user_id: string; expires_at: string; used: number }>(
          "SELECT user_id, expires_at, used FROM email_tokens WHERE token_hash = ? AND kind = 'verify'",
          hashToken(token),
        )
      : undefined;
    if (!row || row.used === 1) {
      sendText(ctx.res, 400, html("Lien invalide", "Ce lien de vérification n'est plus valide. Vous pouvez en demander un nouveau depuis le launcher.", false));
      return;
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      sendText(ctx.res, 400, html("Lien expiré", "Ce lien a expiré. Demandez un nouvel e-mail depuis le launcher.", false));
      return;
    }
    run("UPDATE users SET email_verified = 1 WHERE id = ?", row.user_id);
    run("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND kind = 'verify'", row.user_id);
    sendText(ctx.res, 200, html("Adresse e-mail confirmée", "Votre compte Assetown est vérifié. Vous pouvez revenir au launcher.", true));
  });

  router.post("/api/auth/forgot-password", async (ctx) => {
    const body = jsonBody<{ email?: string }>(ctx);
    const email = requireEmail(body.email);
    rateLimit(`forgot:${ctx.ip}`, 6, 15 * 60 * 1000);
    rateLimit(`forgot-email:${email}`, 3, 15 * 60 * 1000);

    const user = findUserByEmail(email);
    let devLink: string | undefined;
    if (user && user.disabled === 0) {
      const token = createEmailToken(user.id, "reset", 60 * 60 * 1000);
      const link = `${config.publicBaseUrl}/reset-password?token=${encodeURIComponent(token)}`;
      const mail = resetEmail(user.username, link);
      mail.to = email;
      await sendMail(mail);
      audit({ id: user.id, label: `user:${user.username}`, ip: ctx.ip }, "account.password_reset_requested", user.id);
      if (!isProduction) devLink = link;
    }
    // Réponse identique pour ne pas révéler l'existence d'un compte
    sendJson(ctx.res, 200, { ok: true, devLink });
  });

  router.post("/api/auth/reset-password", async (ctx) => {
    const body = jsonBody<{ token?: string; password?: string }>(ctx);
    const token = requireString(body.token, "token", { min: 10, max: 200 });
    const password = requirePassword(body.password);
    const row = one<{ user_id: string; expires_at: string; used: number }>(
      "SELECT user_id, expires_at, used FROM email_tokens WHERE token_hash = ? AND kind = 'reset'",
      hashToken(token),
    );
    if (!row || row.used === 1) throw new HttpError(400, "invalid_token", "Lien de réinitialisation invalide ou déjà utilisé");
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new HttpError(400, "expired_token", "Lien de réinitialisation expiré");
    }
    run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), row.user_id);
    run("UPDATE email_tokens SET used = 1 WHERE user_id = ? AND kind = 'reset'", row.user_id);
    revokeAllSessions(row.user_id);
    const user = findUserById(row.user_id);
    audit({ id: row.user_id, label: `user:${user?.username ?? row.user_id}`, ip: ctx.ip }, "account.password_reset", row.user_id);
    sendJson(ctx.res, 200, { ok: true });
  });

  // Page web de réinitialisation (lien reçu par e-mail)
  router.get("/reset-password", async (ctx) => {
    const token = ctx.query.get("token") ?? "";
    const valid = token
      ? Boolean(
          one<{ token_hash: string }>(
            "SELECT token_hash FROM email_tokens WHERE token_hash = ? AND kind = 'reset' AND used = 0 AND expires_at > ?",
            hashToken(token),
            now(),
          ),
        )
      : false;
    sendText(
      ctx.res,
      valid ? 200 : 400,
      `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Assetown — nouveau mot de passe</title>
<style>body{font-family:system-ui,sans-serif;background:#0a0a12;color:#e9e9f4;display:grid;place-items:center;min-height:100vh;margin:0}
form{background:#13131f;border:1px solid #26263a;padding:32px;border-radius:18px;width:340px}
h1{font-size:19px;margin:0 0 18px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #2b2b40;background:#0e0e18;color:#fff;margin-bottom:12px}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#7c5cff;color:#fff;font-weight:600;cursor:pointer}
p{color:#9c9cb5;font-size:13px}</style></head><body>
${valid
  ? `<form id="f"><h1>Nouveau mot de passe</h1><input id="p" type="password" minlength="8" placeholder="8 caractères minimum" required><input id="p2" type="password" placeholder="Confirmer" required><button>Enregistrer</button><p id="msg"></p></form>
<script>const t=${JSON.stringify(token)};document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const p=document.getElementById('p').value,p2=document.getElementById('p2').value,m=document.getElementById('msg');if(p!==p2){m.textContent='Les mots de passe ne correspondent pas';return;}const r=await fetch('/api/auth/reset-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:t,password:p})});const d=await r.json().catch(()=>({}));m.textContent=r.ok?'Mot de passe modifié, vous pouvez fermer cette page.':(d?.error?.message||'Erreur');if(r.ok)document.getElementById('f').reset();};</script>`
  : `<div><h1>Lien invalide ou expiré</h1><p>Demandez un nouveau lien depuis le launcher Assetown.</p></div>`}
</body></html>`,
    );
  });

  router.get("/api/health", async (ctx) => {
    sendJson(ctx.res, 200, {
      status: "ok",
      service: getSetting("brand_name", "Assetown"),
      time: now(),
      version: "1.0.0",
    });
  });
}
