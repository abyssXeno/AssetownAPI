import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { count, one, run } from "./db.js";
import { config, DATA_DIR } from "./env.js";
import { hashPassword } from "./auth.js";
import { now, uid } from "./util.js";

const DEFAULT_CHANNELS = [
  {
    slug: "v1",
    name: "Assetown V1",
    description: "L'aventure originale : survie, économie et events historiques d'Assetown.",
    accent: "#7c5cff",
    sortOrder: 1,
  },
  {
    slug: "v2",
    name: "Assetown V2",
    description: "La saison communauté : mods techniques, donjons et progression partagée.",
    accent: "#3ea8ff",
    sortOrder: 2,
  },
  {
    slug: "v3",
    name: "Assetown V3",
    description: "La nouvelle génération : monde étendu, quêtes et contenu exclusif.",
    accent: "#ff5c9d",
    sortOrder: 3,
  },
] as const;

export function ensureChannels(): void {
  for (const channel of DEFAULT_CHANNELS) {
    const existing = one<{ slug: string }>("SELECT slug FROM channels WHERE slug = ?", channel.slug);
    if (existing) continue;
    run(
      `INSERT INTO channels (slug, name, description, accent, enabled, server_host, server_port, discord_url, sort_order, active_build_id)
       VALUES (?, ?, ?, ?, 1, ?, ?, NULL, ?, NULL)`,
      channel.slug,
      channel.name,
      channel.description,
      channel.accent,
      config.defaultServerHost,
      config.defaultServerPort,
      channel.sortOrder,
    );
  }
}

export interface InitialAdminResult {
  created: boolean;
  email?: string;
  password?: string;
  file?: string;
}

export function ensureInitialAdmin(): InitialAdminResult {
  const staff = count("SELECT COUNT(*) as n FROM users WHERE role IN ('owner','admin')");
  if (staff > 0) return { created: false };

  const email = config.initialAdmin.email.toLowerCase();
  if (one<{ id: string }>("SELECT id FROM users WHERE lower(email) = ?", email)) {
    return { created: false };
  }

  const password = config.initialAdmin.password || crypto.randomBytes(12).toString("base64url").slice(0, 16);
  const username = config.initialAdmin.username;
  const id = uid("usr");
  run(
    `INSERT INTO users (id, email, username, username_lower, password_hash, discord, role, permissions, email_verified, disabled, created_at, skin_model)
     VALUES (?, ?, ?, ?, ?, NULL, 'owner', '[]', 1, 0, ?, 'steve')`,
    id,
    email,
    username,
    username.toLowerCase(),
    hashPassword(password),
    now(),
  );

  const file = path.join(DATA_DIR, "initial-admin.txt");
  fs.writeFileSync(
    file,
    `ASSETOWN — compte administrateur initial\nEmail : ${email}\nMot de passe : ${password}\n\nChangez ce mot de passe après la première connexion.\n`,
    { mode: 0o600 },
  );
  return { created: true, email, password, file };
}

export function bootstrap(): InitialAdminResult {
  ensureChannels();
  return ensureInitialAdmin();
}
