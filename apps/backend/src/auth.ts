import crypto from "node:crypto";
import type { Permission, Role, UserProfile } from "@assetown/shared";
import { ROLE_PERMISSIONS } from "@assetown/shared";
import { config, SECRET } from "./env.js";
import { one, run } from "./db.js";
import { HttpError, type Ctx } from "./http.js";
import { hashToken, now, randomToken, uid } from "./util.js";

export interface UserRow {
  id: string;
  email: string;
  username: string;
  username_lower: string;
  password_hash: string;
  discord: string | null;
  role: Role;
  permissions: string;
  email_verified: number;
  disabled: number;
  created_at: string;
  last_login_at: string | null;
  skin_model: string;
  skin_current: string | null;
  skin_previous: string | null;
  skin_updated_at: string | null;
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, n, r, p, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, "base64url");
    const expected = Buffer.from(hashB64, "base64url");
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function b64(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export interface AccessClaims {
  sub: string;
  role: Role;
  typ: "access";
  exp: number;
  iat: number;
}

export function signAccessToken(userId: string, role: Role, ttl = config.accessTtl): string {
  const iat = Math.floor(Date.now() / 1000);
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(JSON.stringify({ sub: userId, role, typ: "access", iat, exp: iat + ttl }));
  const signature = crypto.createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export function verifyAccessToken(token: string): AccessClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "invalid_token", "Jeton invalide");
  const [header, payload, signature] = parts;
  const expected = crypto.createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new HttpError(401, "invalid_token", "Signature du jeton invalide");
  }
  let claims: AccessClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessClaims;
  } catch {
    throw new HttpError(401, "invalid_token", "Jeton illisible");
  }
  if (claims.typ !== "access") throw new HttpError(401, "invalid_token", "Type de jeton invalide");
  if (!claims.exp || claims.exp * 1000 < Date.now()) {
    throw new HttpError(401, "token_expired", "Session expirée, veuillez vous reconnecter");
  }
  return claims;
}

export function createSession(user: UserRow, ip: string, userAgent: string | null): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} {
  const refreshToken = randomToken(48);
  run(
    "INSERT INTO sessions (id, user_id, refresh_hash, created_at, expires_at, revoked, ip, user_agent, last_used_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)",
    uid("ses"),
    user.id,
    hashToken(refreshToken),
    now(),
    new Date(Date.now() + config.refreshTtl * 1000).toISOString(),
    ip,
    userAgent,
    now(),
  );
  return {
    accessToken: signAccessToken(user.id, user.role),
    refreshToken,
    expiresIn: config.accessTtl,
  };
}

export function rotateSession(refreshToken: string, ip: string, userAgent: string | null): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: UserRow;
} {
  const session = one<{ id: string; user_id: string; expires_at: string; revoked: number }>(
    "SELECT id, user_id, expires_at, revoked FROM sessions WHERE refresh_hash = ?",
    hashToken(refreshToken),
  );
  if (!session || session.revoked === 1) {
    throw new HttpError(401, "invalid_session", "Session invalide ou déjà fermée");
  }
  if (new Date(session.expires_at).getTime() < Date.now()) {
    throw new HttpError(401, "session_expired", "Session expirée, veuillez vous reconnecter");
  }
  const user = findUserById(session.user_id);
  if (!user) throw new HttpError(401, "invalid_session", "Compte introuvable");
  if (user.disabled === 1) throw new HttpError(403, "account_disabled", "Ce compte a été désactivé");

  run("UPDATE sessions SET revoked = 1 WHERE id = ?", session.id);
  const fresh = createSession(user, ip, userAgent);
  return { ...fresh, user };
}

export function revokeSession(refreshToken: string): void {
  run("UPDATE sessions SET revoked = 1 WHERE refresh_hash = ?", hashToken(refreshToken));
}

export function revokeAllSessions(userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    run("UPDATE sessions SET revoked = 1 WHERE user_id = ? AND id != ?", userId, exceptSessionId);
  } else {
    run("UPDATE sessions SET revoked = 1 WHERE user_id = ?", userId);
  }
}

export function findUserById(id: string): UserRow | undefined {
  return one<UserRow>("SELECT * FROM users WHERE id = ?", id);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return one<UserRow>("SELECT * FROM users WHERE lower(email) = lower(?)", email);
}

export function findUserByUsername(username: string): UserRow | undefined {
  return one<UserRow>("SELECT * FROM users WHERE username_lower = ?", username.toLowerCase());
}

export function userPermissions(user: UserRow): Permission[] {
  const rolePermissions = ROLE_PERMISSIONS[user.role] ?? [];
  let extra: string[] = [];
  try {
    extra = JSON.parse(user.permissions || "[]") as string[];
  } catch {
    extra = [];
  }
  return Array.from(new Set([...rolePermissions, ...(extra as Permission[])]));
}

export function skinUrl(username: string, stamp: string | null): string | null {
  if (!stamp) return null;
  return `${config.publicBaseUrl}/api/skins/${encodeURIComponent(username)}.png?v=${encodeURIComponent(stamp)}`;
}

export function toProfile(user: UserRow): UserProfile {
  const skinStamp = user.skin_current ? user.skin_current : null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    discord: user.discord,
    role: user.role,
    permissions: userPermissions(user),
    emailVerified: user.email_verified === 1,
    disabled: user.disabled === 1,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    skin: {
      model: user.skin_model === "alex" ? "alex" : "steve",
      updatedAt: user.skin_updated_at,
      url: skinUrl(user.username, skinStamp),
      previousUrl: skinUrl(user.username, user.skin_previous),
      hasPrevious: Boolean(user.skin_previous),
    },
  };
}

export function bearerToken(ctx: Ctx): string | null {
  const header = ctx.req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function requireUser(ctx: Ctx): UserRow {
  const token = bearerToken(ctx);
  if (!token) throw new HttpError(401, "unauthenticated", "Authentification requise");
  const claims = verifyAccessToken(token);
  const user = findUserById(claims.sub);
  if (!user) throw new HttpError(401, "invalid_session", "Compte introuvable");
  if (user.disabled === 1) throw new HttpError(403, "account_disabled", "Ce compte a été désactivé");
  return user;
}

export function requirePermission(ctx: Ctx, permission: Permission): UserRow {
  const user = requireUser(ctx);
  if (!userPermissions(user).includes(permission)) {
    throw new HttpError(403, "forbidden", "Votre rôle ne permet pas cette action");
  }
  return user;
}

export function optionalUser(ctx: Ctx): UserRow | null {
  try {
    return requireUser(ctx);
  } catch {
    return null;
  }
}

/** Limiteur de tentatives en mémoire (protection force brute). */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): void {
  const entry = attempts.get(key);
  const current = Date.now();
  if (!entry || current > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: current + windowMs });
    return;
  }
  entry.count += 1;
  if (entry.count > max) {
    const seconds = Math.ceil((entry.resetAt - current) / 1000);
    throw new HttpError(429, "rate_limited", `Trop de tentatives. Réessayez dans ${seconds} s.`);
  }
}

export function resetRateLimit(key: string): void {
  attempts.delete(key);
}
