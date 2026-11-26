import fs from "node:fs";
import path from "node:path";
import type { UserRow } from "./auth.js";
import { SKIN_STORAGE } from "./env.js";
import { run } from "./db.js";
import { HttpError } from "./http.js";
import { now, sha256 } from "./util.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function validateSkinPng(buffer: Buffer): { width: number; height: number; hash: string } {
  if (buffer.length < 24) throw new HttpError(422, "invalid_skin", "Fichier PNG illisible");
  if (buffer.length > 2 * 1024 * 1024) throw new HttpError(413, "skin_too_large", "Le skin ne doit pas dépasser 2 Mo");
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new HttpError(422, "invalid_skin", "Le skin doit être un fichier PNG valide");
  }
  if (buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new HttpError(422, "invalid_skin", "En-tête PNG invalide");
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!((width === 64 && height === 64) || (width === 64 && height === 32))) {
    throw new HttpError(422, "invalid_skin", "Dimensions attendues : 64×64 (ou 64×32 pour l'ancien format)");
  }
  return { width, height, hash: sha256(buffer) };
}

export function skinFilePath(fileName: string | null): string | null {
  if (!fileName) return null;
  const base = path.basename(fileName);
  if (base !== fileName) return null;
  const full = path.join(SKIN_STORAGE, base);
  return fs.existsSync(full) ? full : null;
}

export function saveSkin(user: UserRow, buffer: Buffer, model: "steve" | "alex"): void {
  const { hash } = validateSkinPng(buffer);
  const fileName = `${user.id}-${hash.slice(0, 16)}.png`;
  const target = path.join(SKIN_STORAGE, fileName);
  fs.writeFileSync(target, buffer);
  run(
    "UPDATE users SET skin_previous = skin_current, skin_current = ?, skin_model = ?, skin_updated_at = ? WHERE id = ?",
    fileName,
    model,
    now(),
    user.id,
  );
}

export function restoreSkin(user: UserRow): boolean {
  if (!user.skin_previous) return false;
  run(
    "UPDATE users SET skin_current = skin_previous, skin_previous = skin_current, skin_updated_at = ? WHERE id = ?",
    now(),
    user.id,
  );
  return true;
}

export function deleteUserSkins(userId: string): void {
  if (!fs.existsSync(SKIN_STORAGE)) return;
  for (const file of fs.readdirSync(SKIN_STORAGE)) {
    if (file.startsWith(`${userId}-`)) {
      try {
        fs.unlinkSync(path.join(SKIN_STORAGE, file));
      } catch {
        /* ignore */
      }
    }
  }
}
