/**
 * Page publique du routeur Assetown.
 * Rendu côté Worker : aucune donnée sensible, uniquement l'hôte du backend.
 */

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATE_LABEL = {
  online: "API EN LIGNE",
  degraded: "API DÉGRADÉE",
  offline: "API INJOIGNABLE",
  unconfigured: "BACKEND NON CONFIGURÉ",
};

const ENDPOINTS = [
  { method: "GET", path: "/api/health", desc: "État du service et version du protocole." },
  { method: "GET", path: "/api/config", desc: "Configuration publique consommée par le launcher." },
  { method: "GET", path: "/api/news", desc: "Annonces publiées depuis le panneau d'administration." },
  { method: "GET", path: "/api/builds/:channel/manifest", desc: "Manifest de mise à jour signé (v1, v2, v3)." },
  { method: "POST", path: "/api/auth/register", desc: "Création de compte joueur." },
  { method: "POST", path: "/api/auth/login", desc: "Connexion joueur et émission des jetons." },
  { method: "POST", path: "/api/admin/auth/login", desc: "Connexion du panneau d'administration." },
  { method: "POST", path: "/api/support/report", desc: "Envoi d'un ticket support ou d'un rapport de crash." },
];

export function renderPage({ origin, upstreamHost, status, routers }) {
  const state = status.state;
  const badgeClass = state === "online" ? "ok" : state === "degraded" ? "warn" : "bad";
  const latency = typeof status.latency === "number" ? `${status.latency} ms` : "—";
  const upstreamLabel = upstreamHost ? escapeHtml(upstreamHost) : "non configuré";
  const apiBase = `${escapeHtml(origin)}/api`;

  const rows = ENDPOINTS.map(
    (endpoint) => `<li>
        <span class="method ${endpoint.method === "GET" ? "get" : "post"}">${endpoint.method}</span>
        <code>${escapeHtml(endpoint.path)}</code>
        <span class="desc">${escapeHtml(endpoint.desc)}</span>
      </li>`,
  ).join("");

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Assetown — Routeur API</title>
<meta name="description" content="Point d'entrée unique de l'API Assetown pour le launcher joueur et le panneau d'administration." />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>
:root {
  --bg: #07070d;
  --panel: #101020;
  --panel-2: #15152a;
  --line: #23233d;
  --text: #ececf7;
  --muted: #9a9ab8;
  --accent: #8b6cff;
  --accent-2: #5b8cff;
  --ok: #4ade80;
  --warn: #fbbf24;
  --bad: #f87171;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background:
    radial-gradient(900px 480px at 12% -10%, rgba(139, 108, 255, 0.22), transparent 70%),
    radial-gradient(760px 420px at 92% 4%, rgba(91, 140, 255, 0.16), transparent 72%),
    var(--bg);
  color: var(--text);
  font-family: "Segoe UI", Inter, system-ui, -apple-system, sans-serif;
  line-height: 1.55;
}
.wrap { max-width: 1040px; margin: 0 auto; padding: 32px 24px 72px; }
header { display: flex; align-items: center; gap: 14px; }
.logo { width: 44px; height: 44px; flex: none; }
.brand { font-weight: 800; letter-spacing: 0.16em; font-size: 15px; }
.brand small { display: block; font-size: 11px; letter-spacing: 0.24em; color: var(--muted); font-weight: 600; }
.nav-spacer { flex: 1; }
.pill {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--line); background: rgba(16, 16, 32, 0.7);
  border-radius: 999px; padding: 7px 14px; font-size: 12px; color: var(--muted);
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.ok { background: var(--ok); box-shadow: 0 0 12px var(--ok); }
.dot.warn { background: var(--warn); box-shadow: 0 0 12px var(--warn); }
.dot.bad { background: var(--bad); box-shadow: 0 0 12px var(--bad); }
h1 { font-size: clamp(30px, 5vw, 46px); line-height: 1.12; margin: 44px 0 12px; letter-spacing: -0.02em; }
h1 span { background: linear-gradient(100deg, var(--accent), var(--accent-2)); -webkit-background-clip: text; background-clip: text; color: transparent; }
.lead { color: var(--muted); max-width: 620px; margin: 0 0 32px; font-size: 15.5px; }
.cards { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
.card {
  background: linear-gradient(180deg, var(--panel), var(--panel-2));
  border: 1px solid var(--line); border-radius: 16px; padding: 18px 18px 16px;
}
.card .label { font-size: 11px; letter-spacing: 0.16em; color: var(--muted); text-transform: uppercase; font-weight: 700; }
.card .value { margin-top: 8px; font-size: 19px; font-weight: 700; word-break: break-word; }
.badge { display: inline-block; margin-top: 8px; font-size: 12.5px; font-weight: 700; letter-spacing: 0.08em; padding: 5px 10px; border-radius: 8px; }
.badge.ok { color: var(--ok); background: rgba(74, 222, 128, 0.12); border: 1px solid rgba(74, 222, 128, 0.32); }
.badge.warn { color: var(--warn); background: rgba(251, 191, 36, 0.12); border: 1px solid rgba(251, 191, 36, 0.32); }
.badge.bad { color: var(--bad); background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.32); }
section { margin-top: 34px; }
h2 { font-size: 15px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin: 0 0 14px; }
ul.routes { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 16px; overflow: hidden; background: var(--panel); }
ul.routes li { display: flex; align-items: center; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
ul.routes li:last-child { border-bottom: 0; }
.method { font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em; padding: 3px 8px; border-radius: 6px; flex: none; }
.method.get { color: #7dd3fc; background: rgba(125, 211, 252, 0.12); }
.method.post { color: #c4b5fd; background: rgba(196, 181, 253, 0.14); }
code { font-family: "Cascadia Code", Consolas, monospace; font-size: 13px; color: #d9d9f2; }
.desc { color: var(--muted); font-size: 13px; margin-left: auto; text-align: right; }
.note { margin-top: 26px; border-left: 3px solid var(--accent); background: rgba(139, 108, 255, 0.08); padding: 14px 18px; border-radius: 0 12px 12px 0; color: var(--muted); font-size: 13.5px; }
.note strong { color: var(--text); }
footer { margin-top: 44px; font-size: 12px; color: #6b6b8c; display: flex; gap: 16px; flex-wrap: wrap; }
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
@media (max-width: 640px) { .desc { margin-left: 0; text-align: left; width: 100%; } }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <svg class="logo" viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#a78bfa" />
            <stop offset="1" stop-color="#5b8cff" />
          </linearGradient>
        </defs>
        <path d="M32 3 58 18v28L32 61 6 46V18z" fill="none" stroke="url(#g)" stroke-width="3.5" stroke-linejoin="round" />
        <path d="M32 17 45 45h-8.4l-2.2-5.6h-8.6L23.4 45H15z M32 27.6l-2.9 7.2h5.8z" fill="url(#g)" />
      </svg>
      <div class="brand">ASSETOWN<small>API ROUTER</small></div>
      <div class="nav-spacer"></div>
      <span class="pill"><span class="dot ${badgeClass}"></span>${escapeHtml(STATE_LABEL[state] ?? "ÉTAT INCONNU")}</span>
    </header>

    <h1>Point d'entrée unique de <span>l'API Assetown</span></h1>
    <p class="lead">
      Ce domaine expose l'API consommée par le launcher joueur et le panneau d'administration.
      Toutes les requêtes <code>/api/*</code> sont routées vers le serveur Assetown, avec conservation
      des en-têtes d'authentification, des plages d'octets et des téléchargements de builds.
    </p>

    <div class="cards">
      <div class="card">
        <div class="label">Base URL</div>
        <div class="value">${apiBase}</div>
      </div>
      <div class="card">
        <div class="label">Backend</div>
        <div class="value">${upstreamLabel}</div>
      </div>
      <div class="card">
        <div class="label">Latence</div>
        <div class="value">${escapeHtml(latency)}</div>
      </div>
      <div class="card">
        <div class="label">État</div>
        <span class="badge ${badgeClass}">${escapeHtml(STATE_LABEL[state] ?? "INCONNU")}</span>
      </div>
    </div>

    <section>
      <h2>Routes routées</h2>
      <ul class="routes">${rows}</ul>
    </section>

    <div class="note">
      <strong>Configuration des applications.</strong>
      Dans l'écran de connexion du launcher et du panneau d'administration, renseignez
      <code>${escapeHtml(origin)}</code> comme URL d'API : le routeur préfixe automatiquement <code>/api</code>.
      Le backend cible est défini par la variable <code>API_UPSTREAM</code> du routeur.
    </div>

    <footer>
      <span>${escapeHtml(routers.label)}</span>
      <span>GET <a href="/api/health">/api/health</a></span>
      <span>GET <a href="/router.json">/router.json</a></span>
    </footer>
  </div>
</body>
</html>`;
}
