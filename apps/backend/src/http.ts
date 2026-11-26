import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { config } from "./env.js";

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  ip: string;
  body: Buffer;
  query: URLSearchParams;
}

export type Handler = (ctx: Ctx) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  maxBody: number;
  raw: boolean;
}

const DEFAULT_MAX_BODY = 1 * 1024 * 1024;
export const UPLOAD_MAX_BODY = 256 * 1024 * 1024;

export class Router {
  private routes: Route[] = [];

  add(
    method: string,
    pattern: string,
    handler: Handler,
    options: { maxBody?: number; raw?: boolean } = {},
  ): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
      maxBody: options.maxBody ?? DEFAULT_MAX_BODY,
      raw: options.raw ?? false,
    });
  }

  get(pattern: string, handler: Handler, options?: { maxBody?: number; raw?: boolean }): void {
    this.add("GET", pattern, handler, options);
  }
  post(pattern: string, handler: Handler, options?: { maxBody?: number; raw?: boolean }): void {
    this.add("POST", pattern, handler, options);
  }
  put(pattern: string, handler: Handler, options?: { maxBody?: number; raw?: boolean }): void {
    this.add("PUT", pattern, handler, options);
  }
  patch(pattern: string, handler: Handler, options?: { maxBody?: number; raw?: boolean }): void {
    this.add("PATCH", pattern, handler, options);
  }
  delete(pattern: string, handler: Handler, options?: { maxBody?: number; raw?: boolean }): void {
    this.add("DELETE", pattern, handler, options);
  }

  private match(segments: string[], routeSegments: string[]): Record<string, string> | null {
    if (segments.length !== routeSegments.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < routeSegments.length; i += 1) {
      const expected = routeSegments[i];
      const actual = segments[i];
      if (expected.startsWith(":")) {
        params[expected.slice(1)] = decodeURIComponent(actual);
      } else if (expected !== actual) {
        return null;
      }
    }
    return params;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const method = (req.method ?? "GET").toUpperCase();
    const segments = url.pathname.split("/").filter(Boolean);

    let allowedMethods: string[] = [];
    for (const route of this.routes) {
      const params = this.match(segments, route.segments);
      if (!params) continue;
      if (route.method !== method) {
        allowedMethods.push(route.method);
        continue;
      }
      // Les routes binaires (raw) reçoivent aussi le corps complet dans ctx.body :
      // `raw` signifie « pas de parsing JSON », pas « pas de lecture ».
      const body = await readBody(req, route.maxBody);
      const ctx: Ctx = { req, res, url, params, ip: clientIp(req), body, query: url.searchParams };
      await route.handler(ctx);
      return true;
    }

    if (allowedMethods.length > 0) {
      throw new HttpError(405, "method_not_allowed", `Méthode ${method} non autorisée sur ${url.pathname}`);
    }
    return false;
  }
}

export function clientIp(req: IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export async function readBody(req: IncomingMessage, limit = DEFAULT_MAX_BODY): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new HttpError(413, "payload_too_large", "Contenu trop volumineux"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function jsonBody<T = Record<string, unknown>>(ctx: Ctx): T {
  if (!ctx.body || ctx.body.length === 0) return {} as T;
  try {
    return JSON.parse(ctx.body.toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "invalid_json", "Corps de requête JSON invalide");
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown,
  headers: Record<string, string> = {},
): void {
  const payload = Buffer.from(JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(payload.length),
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(payload);
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  const payload = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(payload.length),
  });
  res.end(payload);
}

export function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization,X-Assetown-Client,X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jar": "application/java-archive",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".toml": "text/plain; charset=utf-8",
  ".cfg": "text/plain; charset=utf-8",
};

export function mimeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Envoie un fichier avec support des requêtes Range (reprise de téléchargement). */
export function sendFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  options: { cache?: string; downloadName?: string; contentType?: string } = {},
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new HttpError(404, "not_found", "Fichier introuvable");
  }
  if (!stat.isFile()) throw new HttpError(404, "not_found", "Fichier introuvable");

  const contentType = options.contentType ?? mimeFor(filePath);
  const headers: Record<string, string | number> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": options.cache ?? "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  };
  if (options.downloadName) {
    headers["Content-Disposition"] = `attachment; filename="${options.downloadName.replace(/"/g, "")}"`;
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (!Number.isNaN(start) && !Number.isNaN(end) && start <= end && start < stat.size) {
        const safeEnd = Math.min(end, stat.size - 1);
        res.writeHead(206, {
          ...headers,
          "Content-Range": `bytes ${start}-${safeEnd}/${stat.size}`,
          "Content-Length": safeEnd - start + 1,
        });
        fs.createReadStream(filePath, { start, end: safeEnd }).pipe(res);
        return;
      }
    }
  }

  res.writeHead(200, { ...headers, "Content-Length": stat.size });
  fs.createReadStream(filePath).pipe(res);
}
