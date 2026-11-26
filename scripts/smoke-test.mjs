/**
 * Test de bout en bout de l'API Assetown (développement).
 *   node scripts/smoke-test.mjs [http://127.0.0.1:4200]
 *
 * Vérifie : santé, inscription, connexion, configuration publique, connexion
 * admin, création/upload/test/publication d'un build, manifest, téléchargement
 * signé + hash, annonce, gestion joueur, tableau de bord, audit.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.argv[2] || "http://127.0.0.1:4200").replace(/\/+$/, "");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✔ ${name}`);
  } else {
    failures += 1;
    console.log(`  ✖ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method, route, { body, token, raw, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(raw ? { "Content-Type": "application/octet-stream" } : body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}

function adminCredentials() {
  const file = path.join(root, "apps", "backend", "storage", "initial-admin.txt");
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, "utf8");
  const email = /Email\s*:\s*(\S+)/.exec(content)?.[1];
  const password = /Mot de passe\s*:\s*(\S+)/.exec(content)?.[1];
  return email && password ? { email, password } : null;
}

const suffix = crypto.randomBytes(3).toString("hex");
const player = {
  email: `test.${suffix}@assetown.test`,
  username: `Test${suffix}`,
  password: "Assetown1234",
  discord: `test_${suffix}`,
};

console.log(`\nAssetown — test API sur ${base}\n`);

let health = await call("GET", "/api/health");
check("GET /api/health répond 200", health.status === 200, `status ${health.status}`);
if (health.status !== 200) {
  console.log("\nLe backend n'est pas démarré. Lancez `npm run build:backend && npm start -w @assetown/backend`.");
  process.exit(1);
}

let config = await call("GET", "/api/config");
check("GET /api/config expose 3 versions", config.status === 200 && config.data?.channels?.length === 3);

let registration = await call("POST", "/api/auth/register", { body: player });
check("Inscription joueur (201)", registration.status === 201, JSON.stringify(registration.data));
const playerToken = registration.data?.accessToken;
const playerId = registration.data?.user?.id;
check("Profil créé avec pseudo Minecraft", registration.data?.user?.username === player.username);
check("E-mail non vérifié à l'inscription", registration.data?.user?.emailVerified === false);

let duplicate = await call("POST", "/api/auth/register", { body: { ...player, email: `other.${suffix}@assetown.test` } });
check("Pseudo Minecraft unique (409)", duplicate.status === 409 && duplicate.data?.error?.code === "username_taken");

let weak = await call("POST", "/api/auth/register", {
  body: { email: `weak.${suffix}@assetown.test`, username: `Weak${suffix}`, password: "abc" },
});
check("Mot de passe faible refusé", weak.status === 422);

let login = await call("POST", "/api/auth/login", { body: { identifier: player.username, password: player.password } });
check("Connexion par pseudo (200)", login.status === 200, JSON.stringify(login.data));

let badLogin = await call("POST", "/api/auth/login", { body: { identifier: player.username, password: "wrong-password" } });
check("Mot de passe invalide refusé (401)", badLogin.status === 401);

let me = await call("GET", "/api/me", { token: playerToken });
check("GET /api/me authentifié", me.status === 200 && me.data?.user?.username === player.username);
let unauth = await call("GET", "/api/me");
check("GET /api/me sans jeton (401)", unauth.status === 401);

let refresh = await call("POST", "/api/auth/refresh", { body: { refreshToken: login.data?.refreshToken } });
check("Rafraîchissement de session", refresh.status === 200 && Boolean(refresh.data?.accessToken));
const token = refresh.data?.accessToken ?? playerToken;

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAQSURBVHhe7cExAQAAAMKg9U9tCy8gAAAAAAAAAAAAAAAA4N8AKgABAAH8ZQAAAABJRU5ErkJggg==",
  "base64",
);
let skin = await call("PUT", "/api/me/skin?model=alex", { token, raw: png });
check("Upload du skin PNG 64×64", skin.status === 200 && Boolean(skin.data?.user?.skin?.url), JSON.stringify(skin.data));
let badSkin = await call("PUT", "/api/me/skin", { token, raw: Buffer.from("not a png") });
check("PNG invalide refusé", badSkin.status === 422);

const creds = adminCredentials();
let adminToken = null;
if (creds) {
  let adminLogin = await call("POST", "/api/admin/auth/login", { body: creds });
  check("Connexion admin", adminLogin.status === 200 && adminLogin.data?.user?.role === "owner", JSON.stringify(adminLogin.data));
  adminToken = adminLogin.data?.accessToken;

  let playerAdmin = await call("POST", "/api/admin/auth/login", { body: { email: player.email, password: player.password } });
  check("Joueur refusé sur le panneau admin (403)", playerAdmin.status === 403);
} else {
  console.log("  ! Identifiants admin introuvables (apps/backend/storage/initial-admin.txt)");
  failures += 1;
}

if (adminToken) {
  let dashboard = await call("GET", "/api/admin/dashboard", { token: adminToken });
  check("Tableau de bord admin", dashboard.status === 200 && typeof dashboard.data?.totals?.accounts === "number");

  let createBuild = await call("POST", "/api/admin/builds", {
    token: adminToken,
    body: {
      channel: "v1",
      label: `Smoke build ${suffix}`,
      minecraftVersion: "1.20.1",
      loader: "vanilla",
      description: "Build de test automatisé",
      changelog: "Test",
    },
  });
  check("Création d'un build (201)", createBuild.status === 201, JSON.stringify(createBuild.data));
  const buildId = createBuild.data?.build?.id;

  const configContent = Buffer.from(`assetown smoke test ${suffix}\n`, "utf8");
  const expectedHash = crypto.createHash("sha256").update(configContent).digest("hex");
  let upload = await call("PUT", `/api/admin/builds/${buildId}/files?path=config%2Fassetown%2Fsmoke.txt&kind=config`, {
    token: adminToken,
    raw: configContent,
  });
  check("Upload d'un fichier de build", upload.status === 200 && upload.data?.sha256 === expectedHash, JSON.stringify(upload.data));

  let test = await call("POST", `/api/admin/builds/${buildId}/test`, { token: adminToken });
  check("Test du build (hashes validés)", test.status === 200 && test.data?.ok === true, JSON.stringify(test.data));

  let earlyPublish = await call("POST", `/api/admin/builds/${buildId}/publish`, { token: adminToken, body: { confirm: false } });
  check("Publication sans confirmation refusée", earlyPublish.status === 428);

  let publish = await call("POST", `/api/admin/builds/${buildId}/publish`, {
    token: adminToken,
    body: { confirm: true, changelog: "Build publié par le test" },
  });
  check("Publication du build", publish.status === 200 && publish.data?.build?.status === "published", JSON.stringify(publish.data));

  let manifest = await call("GET", "/api/builds/v1/manifest");
  check("Manifest V1 publié", manifest.status === 200 && manifest.data?.build?.id === buildId);
  const file = manifest.data?.files?.find((entry) => entry.path === "config/assetown/smoke.txt");
  check("Manifest contient le hash SHA-256", file?.sha256 === expectedHash);
  check("Manifest protège saves/screenshots", manifest.data?.protectedPaths?.includes("saves"));

  let download = await fetch(file.url);
  const downloaded = Buffer.from(await download.arrayBuffer());
  check("Téléchargement signé du fichier", download.status === 200 && crypto.createHash("sha256").update(downloaded).digest("hex") === expectedHash);
  let tampered = await fetch(file.url.replace(/sig=[^&]+/, "sig=deadbeef"));
  check("Signature falsifiée refusée", tampered.status === 403);

  let etag = manifest.data?.etag;
  let conditional = await call("GET", "/api/builds/v1/manifest", { headers: { "If-None-Match": `"${etag}"` } });
  check("Manifest ETag (304)", conditional.status === 304);

  let announcement = await call("POST", "/api/admin/announcements", {
    token: adminToken,
    body: { type: "news", title: `Annonce ${suffix}`, body: "Contenu de test", pinned: true },
  });
  check("Création d'une annonce", announcement.status === 201);
  let news = await call("GET", "/api/news");
  check("Annonce visible côté launcher", news.data?.announcements?.some((item) => item.title === `Annonce ${suffix}`));

  let notifications = await call("GET", "/api/notifications");
  check("Notifications du launcher", notifications.status === 200 && Array.isArray(notifications.data?.notifications));

  let channels = await call("GET", "/api/admin/channels", { token: adminToken });
  check("Liste des canaux admin", channels.status === 200 && channels.data?.channels?.length === 3);

  let toggleChannel = await call("PATCH", "/api/admin/channels/v1", { token: adminToken, body: { enabled: false } });
  let disabledManifest = await call("GET", "/api/builds/v1/manifest");
  check("Version désactivée bloque le manifest (409)", toggleChannel.status === 200 && disabledManifest.status === 409);
  await call("PATCH", "/api/admin/channels/v1", { token: adminToken, body: { enabled: true } });

  let disablePlayer = await call("PATCH", `/api/admin/players/${playerId}`, { token: adminToken, body: { disabled: true } });
  check("Désactivation d'un compte", disablePlayer.status === 200);
  let blockedLogin = await call("POST", "/api/auth/login", { body: { identifier: player.username, password: player.password } });
  check("Compte désactivé ne peut plus se connecter (403)", blockedLogin.status === 403);
  await call("PATCH", `/api/admin/players/${playerId}`, { token: adminToken, body: { disabled: false } });

  let audit = await call("GET", "/api/admin/audit?limit=50", { token: adminToken });
  const actions = (audit.data?.entries ?? []).map((entry) => entry.action);
  check("Journal d'audit alimenté", actions.includes("build.publish") && actions.includes("player.update"));

  let reports = await call("GET", "/api/admin/reports", { token: adminToken });
  check("Liste des rapports support", reports.status === 200 && Array.isArray(reports.data?.reports));

  let settings = await call("GET", "/api/admin/settings", { token: adminToken });
  check("Paramètres de marque", settings.status === 200 && Boolean(settings.data?.branding?.brandName));

  let search = await call("GET", `/api/admin/players?q=${encodeURIComponent(player.username)}`, { token: adminToken });
  check("Recherche de joueur", search.data?.players?.some((entry) => entry.id === playerId));

  let unauthorized = await call("GET", "/api/admin/dashboard", { token });
  check("Permissions : joueur bloqué sur l'admin (403)", unauthorized.status === 403);
}

let supportReport = await call("POST", "/api/support/reports", {
  token,
  body: { subject: "Test automatique", message: "Rapport généré par le test de fumée.", logs: "ligne de log", system: "smoke-test" },
});
check("Envoi d'un rapport de support", supportReport.status === 201);

let forgot = await call("POST", "/api/auth/forgot-password", { body: { email: player.email } });
check("Mot de passe oublié (réponse neutre)", forgot.status === 200);

console.log(`\n${failures === 0 ? "✔ Tous les contrôles sont passés" : `✖ ${failures} contrôle(s) en échec`}\n`);
process.exit(failures === 0 ? 0 : 1);
