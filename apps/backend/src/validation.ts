import { HttpError } from "./http.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

export function requireString(
  value: unknown,
  field: string,
  options: { min?: number; max?: number; label?: string } = {},
): string {
  const label = options.label ?? field;
  if (typeof value !== "string") throw new HttpError(422, "invalid_field", `${label} est requis`);
  const trimmed = value.trim();
  if (options.min !== undefined && trimmed.length < options.min) {
    throw new HttpError(422, "invalid_field", `${label} doit contenir au moins ${options.min} caractères`);
  }
  if (options.max !== undefined && trimmed.length > options.max) {
    throw new HttpError(422, "invalid_field", `${label} ne doit pas dépasser ${options.max} caractères`);
  }
  return trimmed;
}

export function optionalString(value: unknown, max = 200): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export function requireEmail(value: unknown): string {
  const email = requireString(value, "email", { min: 5, max: 190, label: "L'adresse e-mail" }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(422, "invalid_email", "Adresse e-mail invalide");
  return email;
}

export function requireUsername(value: unknown): string {
  const username = requireString(value, "username", { min: 3, max: 16, label: "Le pseudo Minecraft" });
  if (!USERNAME_RE.test(username)) {
    throw new HttpError(422, "invalid_username", "Le pseudo doit contenir 3 à 16 caractères (lettres, chiffres, _)");
  }
  if (/^(admin|administrator|owner|assetown|moderator|staff|system|server|console)$/i.test(username)) {
    throw new HttpError(422, "reserved_username", "Ce pseudo est réservé");
  }
  return username;
}

export function requirePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 8) {
    throw new HttpError(422, "weak_password", "Le mot de passe doit contenir au moins 8 caractères");
  }
  if (value.length > 128) {
    throw new HttpError(422, "weak_password", "Le mot de passe ne doit pas dépasser 128 caractères");
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new HttpError(422, "weak_password", "Le mot de passe doit contenir au moins une lettre et un chiffre");
  }
  return value;
}

export function optionalDiscord(value: unknown): string | null {
  const discord = optionalString(value, 40);
  if (!discord) return null;
  if (!/^[A-Za-z0-9._#-]{2,40}$/.test(discord)) {
    throw new HttpError(422, "invalid_discord", "Pseudo Discord invalide (2 à 40 caractères)");
  }
  return discord;
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
      } catch {
        /* retombe sur un découpage ligne par ligne */
      }
    }
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return [];
}

export function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return fallback;
}

export function toInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

export function requireIsoDate(value: unknown, field: string): string {
  const raw = requireString(value, field, { max: 40, label: field });
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new HttpError(422, "invalid_date", `${field} invalide`);
  return date.toISOString();
}
