import crypto from "node:crypto";
import { config, SECRET } from "./env.js";
import { now } from "./util.js";

/**
 * Notifications Discord chiffrées.
 *
 * - Le message Discord contient un résumé minimal (type d'événement, pseudo).
 * - Toutes les données sensibles (IP, e-mail, message du ticket, user-agent…)
 *   sont chiffrées en AES-256-GCM et envoyées dans un fichier `.enc` joint.
 * - Le webhook est appelé en HTTPS depuis le serveur uniquement : l'URL et la
 *   clé ne sont jamais exposées aux launchers.
 */

export type WebhookEventName = "account.created" | "auth.login" | "support.report";

const ENABLED_EVENTS = new Set(config.webhook.events);

function keyFrom(material: string): Buffer {
  return crypto.createHash("sha256").update(`assetown-webhook:${material}`).digest();
}

const DEFAULT_KEY = keyFrom(config.webhook.key || SECRET);

/** Chiffre une charge utile en AES-256-GCM (format `v1.<base64url(iv|tag|data)>`). */
export function encryptPayload(data: unknown, material?: string): string {
  const key = material ? keyFrom(material) : DEFAULT_KEY;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(data), "utf8")), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Déchiffre une charge utile produite par `encryptPayload`. */
export function decryptPayload(token: string, material?: string): unknown {
  const key = material ? keyFrom(material) : DEFAULT_KEY;
  const buffer = Buffer.from(token.trim().replace(/^v1\./, ""), "base64url");
  if (buffer.length < 29) throw new Error("Charge chiffrée invalide");
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const body = buffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8"));
}

export interface WebhookPayload {
  event: WebhookEventName | string;
  title: string;
  username?: string;
  color?: number;
  details: Record<string, unknown>;
}

function maskUrl(url: string): string {
  return url.replace(/\/([^/]{6})[^/]*$/, "/$1…");
}

/** true si un webhook est configuré (utilisé par le panneau admin et les diagnostics). */
export function webhookEnabled(): boolean {
  return Boolean(config.webhook.url);
}

let queue: Promise<void> = Promise.resolve();

/**
 * Envoie un événement au webhook configuré, sans jamais bloquer ni casser la
 * requête HTTP en cours. Les envois sont sérialisés pour conserver l'ordre.
 */
export function notifyWebhook(payload: WebhookPayload): Promise<void> {
  if (!config.webhook.url) return Promise.resolve();
  if (!ENABLED_EVENTS.has(payload.event)) return Promise.resolve();
  const task = (): Promise<void> => deliver(payload);
  const next = queue.then(task, task).then(
    () => undefined,
    () => undefined,
  );
  queue = next;
  return next;
}

async function deliver(payload: WebhookPayload): Promise<void> {
  const at = now();
  const encrypted = encryptPayload({ event: payload.event, at, ...payload.details });
  const stamp = at.replace(/[:.]/g, "-");
  const fileName = `assetown-${payload.event}-${stamp}.enc.txt`;

  const fields: { name: string; value: string; inline?: boolean }[] = [];
  if (config.webhook.plaintext && payload.username) {
    fields.push({ name: "Pseudo", value: payload.username.slice(0, 100), inline: true });
  }
  fields.push({ name: "Événement", value: `\`${payload.event}\``, inline: true });
  fields.push({
    name: "Détails",
    value: "Chiffrés en AES-256-GCM — ouvrez la pièce jointe `.enc` avec `node scripts/decrypt-webhook.mjs`.",
  });

  const form = new FormData();
  form.append(
    "payload_json",
    JSON.stringify({
      username: "Assetown",
      embeds: [
        {
          title: payload.title.slice(0, 250),
          color: payload.color ?? 0x7c5cff,
          timestamp: at,
          fields,
          footer: { text: "Assetown · journal sécurisé" },
        },
      ],
    }),
  );
  form.append("files[0]", new Blob([encrypted], { type: "text/plain" }), fileName);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(config.webhook.url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      const text = await response.text().catch(() => "");
      console.warn(
        `[webhook] ${payload.event} refusé (${response.status}) sur ${maskUrl(config.webhook.url)} ${text.slice(0, 160)}`,
      );
      // Erreur définitive côté client (hors limite de débit) : inutile de réessayer.
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return;
    } catch (error) {
      console.warn(`[webhook] ${payload.event} échec (tentative ${attempt}/3) : ${(error as Error).message}`);
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }
}
