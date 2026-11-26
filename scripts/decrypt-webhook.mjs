/**
 * Déchiffre un fichier `.enc.txt` reçu depuis le webhook Discord Assetown.
 *
 *   node scripts/decrypt-webhook.mjs <fichier.enc.txt> [clé]
 *
 * La clé est lue, dans cet ordre : argument, variable WEBHOOK_ENCRYPTION_KEY,
 * `.env` (WEBHOOK_ENCRYPTION_KEY), puis apps/backend/storage/secret.key.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function readMaterial() {
  const arg = process.argv[3];
  if (arg) return arg;
  if (process.env.WEBHOOK_ENCRYPTION_KEY) return process.env.WEBHOOK_ENCRYPTION_KEY;
  const envFile = path.resolve(".env");
  if (fs.existsSync(envFile)) {
    const match = fs.readFileSync(envFile, "utf8").match(/^WEBHOOK_ENCRYPTION_KEY=(.+)$/m);
    if (match && match[1].trim()) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  const secretFile = path.resolve("apps/backend/storage/secret.key");
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, "utf8").trim();
  throw new Error("Clé introuvable : passez-la en argument ou définissez WEBHOOK_ENCRYPTION_KEY");
}

const file = process.argv[2];
if (!file) {
  console.error("Usage : node scripts/decrypt-webhook.mjs <fichier.enc.txt> [clé]");
  process.exit(1);
}

const token = fs.readFileSync(file, "utf8").trim();
const key = crypto.createHash("sha256").update(`assetown-webhook:${readMaterial()}`).digest();
const buffer = Buffer.from(token.replace(/^v1\./, ""), "base64url");
const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
decipher.setAuthTag(buffer.subarray(12, 28));
const plain = Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8");
console.log(JSON.stringify(JSON.parse(plain), null, 2));
