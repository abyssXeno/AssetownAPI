/**
 * Northflank — diagnostic du compte et création du projet Assetown via l'API.
 *
 * Le token est lu dans `.runtime/northflank-token` (dossier ignoré par Git) ou
 * dans la variable d'environnement NORTHFLANK_API_TOKEN. Il n'est jamais affiché.
 *
 *   node scripts/northflank-deploy.mjs              → diagnostic (aucune modification)
 *   node scripts/northflank-deploy.mjs --project    → crée le projet `assetown`
 *   node scripts/northflank-deploy.mjs --project --region europe-west
 */
import fs from "node:fs";

const API = "https://api.northflank.com/v1";
const TOKEN_FILE = ".runtime/northflank-token";

function readToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    const value = fs.readFileSync(TOKEN_FILE, "utf8").trim();
    if (value) return value;
  }
  return (process.env.NORTHFLANK_API_TOKEN ?? "").trim();
}

const TOKEN = readToken();
if (!TOKEN) {
  console.error(
    "Aucun token Northflank.\n" +
      "Crée-le dans Northflank (Settings → API tokens) puis enregistre-le :\n" +
      `  mkdir -p .runtime && printf '%s' 'TON_TOKEN' > ${TOKEN_FILE}`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const createProject = args.includes("--project");
const regionIndex = args.indexOf("--region");
const region = regionIndex >= 0 ? args[regionIndex + 1] : "europe-west";

async function call(method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

function summarize(data, limit = 900) {
  if (data === null || data === undefined) return "(vide)";
  if (typeof data === "string") return data.slice(0, limit);
  if (data.error) return `ERREUR ${data.error}: ${data.message ?? ""}`.trim();
  if (Array.isArray(data)) {
    return `${data.length} élément(s) : ` + JSON.stringify(data).slice(0, limit);
  }
  return JSON.stringify(data).slice(0, limit);
}

async function probe(label, path) {
  const result = await call("GET", path);
  console.log(`\n▸ ${label}  [GET ${path}]  → HTTP ${result.status}`);
  console.log("  " + summarize(result.data));
  return result;
}

console.log("Northflank — diagnostic (le token n'est jamais affiché)");

const teams = await probe("Équipes", "/teams");
if (teams.status === 401 || teams.status === 403) {
  console.error(
    "\nToken refusé. Vérifie qu'il est complet (aucun espace, aucune guillemet) et qu'il a les droits " +
      "« Team > Projects > Create ».",
  );
  process.exit(2);
}

await probe("Projets", "/projects");
await probe("Régions disponibles", "/regions");
await probe("Plans de calcul", "/plans");

const projects = await call("GET", "/projects");
const list = Array.isArray(projects.data) ? projects.data : projects.data?.projects ?? [];
const existing = list.find((project) => project?.name === "assetown");

if (!createProject) {
  console.log(
    "\nDiagnostic terminé. Relance avec --project pour créer le projet `assetown` " +
      `(région ${region}) si besoin.`,
  );
  process.exit(0);
}

if (existing) {
  console.log(`\nLe projet « assetown » existe déjà (id ${existing.id ?? existing.name}).`);
  process.exit(0);
}

const created = await call("POST", "/projects", {
  name: "assetown",
  description: "API Assetown (launcher, admin, site routeur)",
  region,
});

console.log(`\n▸ Création du projet  [POST /projects]  → HTTP ${created.status}`);
console.log("  " + summarize(created.data));

if (created.status >= 400) {
  console.error(
    "\nLa création a été refusée : c'est la même raison qui bloque l'interface (plan Sandbox non " +
      "activé, e-mail non vérifié, ou quota de projets atteint). Le message ci-dessus est celui de " +
      "Northflank.",
  );
  process.exit(3);
}

const id = created.data?.id ?? created.data?.projectId ?? created.data?.data?.id;
console.log(`\nProjet créé : assetown${id ? ` (id ${id})` : ""}`);
console.log("Étape suivante : création du service (script --service une fois le projet en place).");
