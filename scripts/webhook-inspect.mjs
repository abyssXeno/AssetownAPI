/**
 * Récepteur local de webhooks (format Discord) pour vérifier la configuration
 * sans publier de données dans un vrai salon.
 *
 *   node scripts/webhook-inspect.mjs [port] [clé]
 *
 * Puis démarrez l'API avec :
 *   DISCORD_WEBHOOK_URL=http://127.0.0.1:4999/hook
 *   WEBHOOK_ENCRYPTION_KEY=<clé>
 * Les charges chiffrées reçues sont déchiffrées et affichées ici.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const port = Number(process.argv[2] ?? 4999);

function readMaterial() {
  if (process.argv[3]) return process.argv[3];
  if (process.env.WEBHOOK_ENCRYPTION_KEY) return process.env.WEBHOOK_ENCRYPTION_KEY;
  const envFile = path.resolve(".env");
  if (fs.existsSync(envFile)) {
    const match = fs.readFileSync(envFile, "utf8").match(/^WEBHOOK_ENCRYPTION_KEY=(.+)$/m);
    if (match && match[1].trim()) return match[1].trim();
  }
  const secretFile = path.resolve("apps/backend/storage/secret.key");
  if (fs.existsSync(secretFile)) return fs.readFileSync(secretFile, "utf8").trim();
  return "";
}

function decrypt(token, material) {
  const key = crypto.createHash("sha256").update(`assetown-webhook:${material}`).digest();
  const buffer = Buffer.from(token.trim().replace(/^v1\./, ""), "base64url");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString("utf8"));
}

function multipartPart(body, name) {
  const marker = `name="${name}"`;
  const start = body.indexOf(marker);
  if (start === -1) return null;
  const dataStart = body.indexOf("\r\n\r\n", start);
  if (dataStart === -1) return null;
  const end = body.indexOf("\r\n--", dataStart + 4);
  return body.slice(dataStart + 4, end === -1 ? undefined : end);
}

http
  .createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const payload = multipartPart(body, "payload_json");
      const filePart = multipartPart(body, "files[0]");
      let embed = {};
      try {
        embed = payload ? JSON.parse(payload).embeds?.[0] ?? {} : {};
      } catch {
        /* ignore */
      }
      console.log(`\n=== ${embed.title ?? "événement"} ===`);
      if (filePart) {
        try {
          console.log(JSON.stringify(decrypt(filePart, readMaterial()), null, 2));
        } catch (error) {
          console.log(`(déchiffrement impossible : ${error.message})`);
        }
      }
      response.writeHead(204).end();
    });
  })
  .listen(port, "127.0.0.1", () => console.log(`Récepteur webhook sur http://127.0.0.1:${port}/hook`));
