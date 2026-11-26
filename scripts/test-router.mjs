/**
 * Vérifie le routeur hors Cloudflare : Node 24 fournit fetch/Request/Response.
 *   node scripts/test-router.mjs [http://127.0.0.1:4200]
 */
import worker from "../site/src/index.js";

const upstream = (process.argv[2] || "http://127.0.0.1:4200").replace(/\/+$/, "");
const env = { API_UPSTREAM: upstream };
const origin = "http://router.test";

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

async function call(path, init = {}) {
  return worker.fetch(new Request(`${origin}${path}`, init), env);
}

console.log(`Routeur → ${upstream}`);

const home = await call("/");
const homeHtml = await home.text();
check("GET / → 200 html", home.status === 200 && (home.headers.get("content-type") || "").includes("text/html"));
check("page indique la base URL", homeHtml.includes(`${origin}/api`));
check("page indique la cible", homeHtml.includes(new URL(upstream).host));
check("page liste les routes", homeHtml.includes("/api/builds/:channel/manifest"));

const health = await call("/api/health");
const healthBody = await health.text();
check("GET /api/health → 200", health.status === 200, `(${health.status})`);
check("health JSON relayé", healthBody.includes('"status"'), healthBody.slice(0, 120));
check("en-tête routeur ajouté", health.headers.get("x-assetown-router") !== null);

const news = await call("/api/news");
check("GET /api/news → 200", news.status === 200, `(${news.status})`);

const config = await call("/api/config");
check("GET /api/config → 200", config.status === 200, `(${config.status})`);

const login = await call("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ identifier: "routeur@assetown.test", password: "motdepasse-invalide" }),
});
check("POST /api/auth/login relayé (401 attendu)", login.status === 401, `(${login.status})`);

const meta = await call("/router.json");
const metaBody = await meta.json();
check("GET /router.json → target", meta.status === 200 && metaBody.baseUrl === `${origin}/api` && metaBody.upstream === new URL(upstream).host);
check("router.json expose l'état", ["online", "degraded", "offline"].includes(metaBody.state), metaBody.state);

const missing = await call("/inconnu");
check("route inconnue → 404 JSON", missing.status === 404);

const badEnv = await worker.fetch(new Request(`${origin}/api/health`), { API_UPSTREAM: "pas une url" });
check("API_UPSTREAM invalide → 503", badEnv.status === 503, `(${badEnv.status})`);

const down = await worker.fetch(new Request(`${origin}/api/health`), { API_UPSTREAM: "http://127.0.0.1:9" });
check("backend injoignable → 502", down.status === 502, `(${down.status})`);

console.log(failures === 0 ? "\nRouteur : tous les contrôles sont passés." : `\nRouteur : ${failures} contrôle(s) en échec.`);
process.exit(failures === 0 ? 0 : 1);
