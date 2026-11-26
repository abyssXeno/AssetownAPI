/**
 * ASSETOWN — Routeur API
 *
 * - `/`            page d'état publique (rendue côté Worker)
 * - `/router.json` description des routes et de la cible
 * - `/api/*`       proxy transparent vers le backend Assetown (API_UPSTREAM)
 * - `/favicon.svg` ressource statique
 *
 * Le proxy conserve la méthode, les en-têtes (Authorization, Range…), le corps
 * et le flux de réponse : les builds et skins se téléchargent sans être chargés
 * en mémoire.
 */

import { renderPage } from "./page.js";

const DEFAULT_UPSTREAM = "";
const PROBE_TIMEOUT_MS = 4000;
const ROUTER_VERSION = "1.0.0";

const ROUTES = [
  { method: "GET", path: "/api/health" },
  { method: "GET", path: "/api/config" },
  { method: "GET", path: "/api/news" },
  { method: "GET", path: "/api/builds/:channel/manifest" },
  { method: "POST", path: "/api/auth/register" },
  { method: "POST", path: "/api/auth/login" },
  { method: "POST", path: "/api/admin/auth/login" },
  { method: "POST", path: "/api/support/report" },
];

function resolveUpstream(env) {
  const raw = ((env && env.API_UPSTREAM) || DEFAULT_UPSTREAM).trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    parsed.search = "";
    return parsed;
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "X-Assetown-Router": ROUTER_VERSION,
    },
  });
}

async function probe(upstream) {
  if (!upstream) return { state: "unconfigured" };
  const started = Date.now();
  try {
    const response = await fetch(new URL("/api/health", upstream), {
      headers: { Accept: "application/json", "User-Agent": "AssetownRouter/1.0" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let health = null;
    try {
      health = await response.json();
    } catch {
      health = null;
    }
    return {
      state: response.ok ? "online" : "degraded",
      status: response.status,
      latency: Date.now() - started,
      health,
    };
  } catch {
    return { state: "offline", latency: Date.now() - started };
  }
}

async function proxy(request, upstream) {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, upstream);
  const ip = request.headers.get("cf-connecting-ip");

  const headers = new Headers(request.headers);
  for (const name of [
    "host",
    "connection",
    "keep-alive",
    "transfer-encoding",
    "upgrade",
    "content-length",
    "cdn-loop",
    "cf-connecting-ip",
    "cf-ipcountry",
    "cf-ray",
    "cf-visitor",
    "cf-worker",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-for",
  ]) {
    headers.delete(name);
  }
  if (ip) headers.set("X-Forwarded-For", ip);
  headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
  headers.set("X-Forwarded-Host", url.host);
  headers.set("X-Forwarded-Port", url.port || (url.protocol === "https:" ? "443" : "80"));
  headers.set("X-Assetown-Router", ROUTER_VERSION);

  const init = { method: request.method, headers, redirect: "manual" };
  if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  let response;
  try {
    response = await fetch(target.toString(), init);
  } catch (error) {
    return json(
      {
        error: {
          code: "upstream_unreachable",
          message: "Le serveur Assetown est injoignable depuis le routeur.",
          details: String((error && error.message) || error),
        },
      },
      502,
    );
  }

  const out = new Headers(response.headers);
  out.delete("content-encoding");
  out.delete("content-length");
  out.delete("connection");
  out.delete("transfer-encoding");
  out.set("X-Assetown-Router", ROUTER_VERSION);

  const noBody = response.status === 204 || response.status === 304 || !response.body;
  return new Response(noBody ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: out,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = resolveUpstream(env);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!upstream) {
        return json(
          {
            error: {
              code: "router_misconfigured",
              message: "Aucun backend configuré : définissez API_UPSTREAM sur le routeur.",
            },
          },
          503,
        );
      }
      return proxy(request, upstream);
    }

    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      const status = await probe(upstream);
      const html = renderPage({
        origin: url.origin,
        upstreamHost: upstream ? upstream.host : "",
        status,
        routers: { label: `Router v${ROUTER_VERSION}` },
      });
      return new Response(request.method === "HEAD" ? null : html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Assetown-Router": ROUTER_VERSION,
        },
      });
    }

    if (url.pathname === "/router.json") {
      const status = await probe(upstream);
      return json({
        service: "assetown-router",
        version: ROUTER_VERSION,
        baseUrl: `${url.origin}/api`,
        upstream: upstream ? upstream.host : null,
        state: status.state,
        latency: status.latency ?? null,
        health: status.health ?? null,
        routes: ROUTES,
      });
    }

    if (env && env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    return json({ error: { code: "not_found", message: "Route inconnue sur le routeur." } }, 404);
  },
};
