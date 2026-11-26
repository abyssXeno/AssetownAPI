import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { config, DATA_DIR } from "./env.js";
import { Router, HttpError, applyCors, sendJson, sendText } from "./http.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAccountRoutes } from "./routes/account.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { bootstrap } from "./bootstrap.js";
import { getBranding } from "./branding.js";
import { pingServer } from "./ping.js";
import { getChannel } from "./builds.js";

const LOG_DIR = path.join(DATA_DIR, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "server.log");

function rotateLogs(): void {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > 5 * 1024 * 1024) {
      fs.renameSync(LOG_FILE, path.join(LOG_DIR, `server-${Date.now()}.log`));
    }
  } catch {
    /* fichier absent */
  }
}

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* ignore */
  }
}

const router = new Router();
registerPublicRoutes(router);
registerAuthRoutes(router);
registerAccountRoutes(router);
registerAdminRoutes(router);

router.get("/", async (ctx) => {
  const branding = getBranding();
  sendText(
    ctx.res,
    200,
    `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${branding.brandName} API</title>
<style>body{font-family:system-ui,sans-serif;background:#08080f;color:#e9e9f4;padding:48px;max-width:760px;margin:auto}
h1{font-size:26px;margin-bottom:6px}code{background:#15151f;padding:2px 6px;border-radius:6px;color:#a78bfa}
li{margin:6px 0;color:#9c9cb5}a{color:#a78bfa}.ok{color:#5ee7a0}</style></head><body>
<h1>${branding.brandName} — API</h1><p class="ok">Service en ligne</p>
<p>Interfaces disponibles :</p><ul>
<li><code>GET /api/health</code> — état du service</li>
<li><code>GET /api/config</code> — configuration publique du launcher</li>
<li><code>GET /api/news</code> — annonces publiées</li>
<li><code>GET /api/builds/v1|v2|v3/manifest</code> — manifest de mise à jour</li>
<li><code>POST /api/auth/register</code> / <code>POST /api/auth/login</code> — comptes joueurs</li>
<li><code>POST /api/admin/auth/login</code> — accès panneau d'administration</li>
</ul>
<p>Les launchers officiels consomment cette API.</p></body></html>`,
  );
});

router.get("/api/server-status/:channel", async (ctx) => {
  const channel = getChannel(ctx.params.channel);
  if (!channel) throw new HttpError(404, "channel_not_found", "Version inconnue");
  const status = await pingServer(channel.server_host, channel.server_port);
  sendJson(ctx.res, 200, { channel: channel.slug, ...status });
});

function readBodySafely(req: http.IncomingMessage, limit = 2 * 1024 * 1024): Promise<Buffer> {
  // Le corps a déjà été consommé par le routeur : ne jamais réattendre 'end'.
  if (req.readableEnded || req.complete) return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total <= limit) chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", () => resolve(Buffer.alloc(0)));
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const started = Date.now();
  applyCors(req, res);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Les uploads laissent le routeur lire le flux ; les autres requêtes sont bornées ici.
  try {
    const handled = await router.handle(req, res);
    if (!handled) {
      await readBodySafely(req);
      sendJson(res, 404, { error: { code: "not_found", message: "Route inconnue" } });
    }
  } catch (error) {
    const isHttp = error instanceof HttpError;
    const status = isHttp ? (error as HttpError).status : 500;
    if (status >= 500) {
      log(`ERREUR ${req.method} ${req.url} — ${(error as Error).stack ?? error}`);
    }
    if (!res.headersSent) {
      sendJson(res, status, {
        error: {
          code: isHttp ? (error as HttpError).code : "internal_error",
          message: isHttp ? (error as Error).message : "Erreur interne du serveur",
          details: isHttp ? (error as HttpError).details : undefined,
        },
      });
    } else {
      res.end();
    }
  } finally {
    const duration = Date.now() - started;
    if (duration > 400 || process.env.ASSETOWN_VERBOSE === "1") {
      log(`${req.method} ${req.url} → ${res.statusCode} (${duration} ms)`);
    }
  }
}

const serverFactory = (handler: http.RequestListener) =>
  config.https.keyFile && config.https.certFile
    ? https.createServer(
        {
          key: fs.readFileSync(config.https.keyFile),
          cert: fs.readFileSync(config.https.certFile),
        },
        handler,
      )
    : http.createServer(handler);

const server = serverFactory((req, res) => {
  void handle(req, res);
});

server.requestTimeout = 15 * 60 * 1000;
server.headersTimeout = 65 * 1000;

const boot = bootstrap();
if (boot.created) {
  log("======================================================");
  log("Compte administrateur initial créé");
  log(`  Email       : ${boot.email}`);
  log(`  Mot de passe: ${boot.password}`);
  log(`  Fichier     : ${boot.file}`);
  log("Changez ce mot de passe après la première connexion.");
  log("======================================================");
}

rotateLogs();

server.listen(config.port, config.host, () => {
  log(`Assetown API à l'écoute sur http://${config.host}:${config.port}`);
  log(`URL publique : ${config.publicBaseUrl}`);
  log(`Données     : ${DATA_DIR}`);
});

const shutdown = () => {
  log("Arrêt du serveur…");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 4000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (reason) => log(`Promesse rejetée : ${String(reason)}`));
