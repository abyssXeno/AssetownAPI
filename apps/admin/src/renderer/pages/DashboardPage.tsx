import { useCallback, useEffect, useState } from "react";
import type { AdminDashboard, Permission, UserProfile } from "@assetown/shared";
import { api } from "../lib/bridge";

interface DashboardPageProps {
  user: UserProfile;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  can: (permission: Permission) => boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function DashboardPage({ user, notify }: DashboardPageProps) {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const dashboard = await api.get<AdminDashboard>("/api/admin/dashboard");
      setData(dashboard);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="row" style={{ gap: 10, color: "var(--muted)", padding: 20 }}>
        <span className="spinner" /> Chargement du tableau de bord…
      </div>
    );
  }

  if (!data) return <div className="empty">Tableau de bord indisponible.</div>;

  const maxDownloads = Math.max(1, ...data.buildActivity.map((entry) => entry.downloads));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Tableau de bord</h1>
          <p>
            Bonjour {user.username} — vue d'ensemble de la communauté, des versions et des dernières actions administratives.
          </p>
        </div>
        <button className="btn small ghost" onClick={() => void load()}>
          Actualiser
        </button>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="label">Comptes créés</div>
          <div className="value">{data.totals.accounts}</div>
          <div className="note">joueurs inscrits au total</div>
        </div>
        <div className="stat">
          <div className="label">Joueurs actifs</div>
          <div className="value">{data.totals.activePlayers}</div>
          <div className="note">connexions sur 7 jours</div>
        </div>
        <div className="stat">
          <div className="label">Téléchargements</div>
          <div className="value">{data.totals.downloads}</div>
          <div className="note">fichiers de builds servis</div>
        </div>
        <div className="stat">
          <div className="label">Builds</div>
          <div className="value">{data.totals.builds}</div>
          <div className="note">{data.totals.announcements} annonce(s) publiée(s)</div>
        </div>
        <div className="stat">
          <div className="label">Rapports ouverts</div>
          <div className="value" style={{ color: data.totals.openReports > 0 ? "var(--amber)" : undefined }}>
            {data.totals.openReports}
          </div>
          <div className="note">support en attente</div>
        </div>
      </div>

      <div className="grid main-side">
        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Téléchargements — 14 derniers jours</h3>
              <span className="chip mono">{data.buildActivity.reduce((sum, entry) => sum + entry.downloads, 0)} total</span>
            </div>
            <div className="chart">
              {data.buildActivity.map((entry) => (
                <div className="bar-wrap" key={entry.day} title={`${entry.day} — ${entry.downloads} téléchargements`}>
                  <div className="bar" style={{ height: `${Math.max(2, (entry.downloads / maxDownloads) * 100)}%` }} />
                  <span className="lbl">{entry.day.slice(8)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card flush">
            <div className="row between" style={{ padding: "14px 16px 10px" }}>
              <h3 style={{ margin: 0 }}>Derniers joueurs inscrits</h3>
              <span className="chip">{data.recentUsers.length}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Pseudo</th>
                  <th>E-mail</th>
                  <th>Rôle</th>
                  <th>Inscription</th>
                </tr>
              </thead>
              <tbody>
                {data.recentUsers.length === 0 && (
                  <tr>
                    <td colSpan={4} className="empty">
                      Aucun joueur inscrit pour l'instant.
                    </td>
                  </tr>
                )}
                {data.recentUsers.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.username}</strong>
                    </td>
                    <td className="muted small">{entry.email}</td>
                    <td>
                      <span className={`chip ${entry.role === "player" ? "" : "tested"}`}>{entry.role}</span>
                    </td>
                    <td className="muted small">{formatDate(entry.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card flush">
            <div className="row between" style={{ padding: "14px 16px 10px" }}>
              <h3 style={{ margin: 0 }}>Derniers builds</h3>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Build</th>
                  <th>Canal</th>
                  <th>Statut</th>
                  <th>Fichiers</th>
                  <th>Publication</th>
                </tr>
              </thead>
              <tbody>
                {data.recentBuilds.length === 0 && (
                  <tr>
                    <td colSpan={5} className="empty">
                      Aucun build créé. Rendez-vous dans « Builds & versions ».
                    </td>
                  </tr>
                )}
                {data.recentBuilds.map((build) => (
                  <tr key={build.id}>
                    <td>{build.label}</td>
                    <td className="mono small">{build.channel.toUpperCase()}</td>
                    <td>
                      <span className={`chip ${build.status}`}>{build.status}</span>
                    </td>
                    <td className="mono small">{build.fileCount}</td>
                    <td className="muted small">{build.publishedAt ? formatDateTime(build.publishedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>État des versions</h3>
            {data.channelStates.map((channel) => (
              <div className="kv" key={channel.slug}>
                <span className="row" style={{ gap: 7 }}>
                  <span className={`dot ${channel.enabled && channel.online ? "online" : "offline"}`} />
                  {channel.name}
                </span>
                <span className="small mono">
                  {!channel.enabled ? "désactivée" : channel.online ? `${channel.players ?? 0} joueurs` : "hors ligne"}
                </span>
              </div>
            ))}
            <div className="small muted" style={{ marginTop: 10, lineHeight: 1.5 }}>
              Versions actives : {data.channelStates.map((channel) => `${channel.slug.toUpperCase()} → ${channel.activeBuild ?? "aucun build"}`).join(" · ")}
            </div>
          </div>

          <div className="card flush">
            <div style={{ padding: "14px 16px 10px" }}>
              <h3 style={{ margin: 0 }}>Historique des actions</h3>
            </div>
            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {data.audit.length === 0 && <div className="empty">Aucune action enregistrée.</div>}
              {data.audit.map((entry) => (
                <div key={entry.id} style={{ padding: "9px 16px", borderTop: "1px solid rgba(255,255,255,.04)" }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{entry.action}</span>
                    <span className="mono small muted">{formatDateTime(entry.createdAt)}</span>
                  </div>
                  <div className="small muted" style={{ marginTop: 2 }}>
                    {entry.actor}
                    {entry.target ? ` · ${entry.target.slice(0, 14)}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
