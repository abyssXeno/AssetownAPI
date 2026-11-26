import { useCallback, useEffect, useMemo, useState } from "react";
import type { Permission, UserProfile } from "@assetown/shared";
import { Logo } from "./components/Logo";
import { api, bridge, isDesktopAdmin } from "./lib/bridge";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { BuildsPage } from "./pages/BuildsPage";
import { AnnouncementsPage } from "./pages/AnnouncementsPage";
import { PlayersPage } from "./pages/PlayersPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AuditPage } from "./pages/AuditPage";
import { SettingsPage } from "./pages/SettingsPage";
import type { AdminSessionState } from "../shared/types";

type AdminNav = "dashboard" | "builds" | "announcements" | "players" | "reports" | "audit" | "settings";

interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}

const NAV: Array<{ key: AdminNav; label: string; permission: Permission; section: string }> = [
  { key: "dashboard", label: "Tableau de bord", permission: "dashboard.view", section: "Pilotage" },
  { key: "players", label: "Joueurs", permission: "players.view", section: "Pilotage" },
  { key: "builds", label: "Builds & versions", permission: "builds.view", section: "Contenu" },
  { key: "announcements", label: "Annonces", permission: "announcements.manage", section: "Contenu" },
  { key: "reports", label: "Rapports de support", permission: "reports.manage", section: "Communauté" },
  { key: "audit", label: "Journal d'audit", permission: "audit.view", section: "Sécurité" },
  { key: "settings", label: "Paramètres", permission: "settings.manage", section: "Sécurité" },
];

const ICONS: Record<AdminNav, JSX.Element> = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  players: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" strokeLinecap="round" />
      <path d="M16.5 5.5a3.4 3.4 0 0 1 0 6.5M17.5 20a6.4 6.4 0 0 0-2-4.5" strokeLinecap="round" />
    </svg>
  ),
  builds: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" strokeLinejoin="round" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" strokeLinejoin="round" />
    </svg>
  ),
  announcements: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 10v4a2 2 0 0 0 2 2h2l5 4V4L8 8H6a2 2 0 0 0-2 2Z" strokeLinejoin="round" />
      <path d="M17 9a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  ),
  reports: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M5 3h9l5 5v13H5V3Z" strokeLinejoin="round" />
      <path d="M14 3v5h5M8 13h8M8 17h5" strokeLinecap="round" />
    </svg>
  ),
  audit: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M12 3 4 6.5V12c0 4.6 3.4 8.4 8 9 4.6-.6 8-4.4 8-9V6.5L12 3Z" strokeLinejoin="round" />
      <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 3a1.7 1.7 0 0 0 1-1.6V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 14 3a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" strokeLinejoin="round" />
    </svg>
  ),
};

export default function App() {
  const [state, setState] = useState<AdminSessionState | null>(null);
  const [booting, setBooting] = useState(true);
  const [nav, setNav] = useState<AdminNav>("dashboard");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [openReports, setOpenReports] = useState(0);

  const notify = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6500);
  }, []);

  const can = useCallback(
    (permission: Permission): boolean => Boolean(state?.user?.permissions.includes(permission)),
    [state],
  );

  const boot = useCallback(async () => {
    setBooting(true);
    try {
      const next = await bridge.state();
      setState(next);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBooting(false);
    }
  }, [notify]);

  useEffect(() => {
    void boot();
  }, [boot]);

  const refreshReportCount = useCallback(async () => {
    if (!state?.user?.permissions.includes("reports.manage")) return;
    try {
      const data = await api.get<{ reports: Array<{ status: string }> }>("/api/admin/reports");
      setOpenReports(data.reports.filter((report) => report.status === "open").length);
    } catch {
      /* silencieux */
    }
  }, [state]);

  useEffect(() => {
    void refreshReportCount();
    const timer = window.setInterval(() => void refreshReportCount(), 60_000);
    return () => window.clearInterval(timer);
  }, [refreshReportCount]);

  const availableNav = useMemo(() => NAV.filter((item) => can(item.permission)), [can]);

  if (booting) {
    return (
      <div className="shell">
        <TitleBar />
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <div className="row" style={{ gap: 10, color: "var(--muted)" }}>
            <span className="spinner" /> Chargement de la console…
          </div>
        </div>
      </div>
    );
  }

  if (!state?.authenticated || !state.user) {
    return (
      <div className="shell">
        <TitleBar />
        <LoginPage
          apiBaseUrl={state?.apiBaseUrl ?? "https://assetown-api-router-3e3dmn-preview.freebuff.site"}
          onAuthenticated={async () => {
            await boot();
          }}
          notify={notify}
        />
        <Toasts toasts={toasts} />
      </div>
    );
  }

  const user = state.user;
  const permissions = user.permissions;

  return (
    <div className="shell">
      <TitleBar />
      <div className="body">
        <aside className="sidebar">
          {Array.from(new Set(NAV.map((item) => item.section))).map((section) => {
            const items = availableNav.filter((item) => item.section === section);
            if (items.length === 0) return null;
            return (
              <div key={section}>
                <div className="nav-label">{section}</div>
                {items.map((item) => (
                  <button
                    key={item.key}
                    className={`nav-item ${nav === item.key ? "active" : ""}`}
                    onClick={() => setNav(item.key)}
                  >
                    {ICONS[item.key]}
                    {item.label}
                    {item.key === "reports" && openReports > 0 && <span className="badge">{openReports}</span>}
                  </button>
                ))}
              </div>
            );
          })}

          <div className="sidebar-footer">
            <div className="staff">
              <div className="av">{user.username.slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <div className="nm">{user.username}</div>
                <div className="rl">{user.role}</div>
              </div>
            </div>
            <button
              className="btn ghost small"
              onClick={async () => {
                await bridge.logout();
                await boot();
              }}
            >
              Se déconnecter
            </button>
          </div>
        </aside>

        <main className="content">
          {!isDesktopAdmin && (
            <div className="alert warn" style={{ marginBottom: 14 }}>
              Aperçu navigateur : l'envoi de fichiers de build et d'images nécessite l'application Assetown Admin Panel.
            </div>
          )}

          {nav === "dashboard" && <DashboardPage user={user} notify={notify} can={can} />}
          {nav === "builds" && <BuildsPage user={user} notify={notify} can={can} />}
          {nav === "announcements" && <AnnouncementsPage notify={notify} />}
          {nav === "players" && <PlayersPage user={user} notify={notify} can={can} />}
          {nav === "reports" && <ReportsPage notify={notify} onChanged={refreshReportCount} />}
          {nav === "audit" && <AuditPage notify={notify} />}
          {nav === "settings" && <SettingsPage notify={notify} apiBaseUrl={state.apiBaseUrl} />}

          {availableNav.length === 0 && (
            <div className="card">
              <h3>Aucune permission</h3>
              <p className="muted small">
                Votre rôle ne donne accès à aucune section. Contactez un propriétaire pour obtenir des permissions.
              </p>
            </div>
          )}

          {!isDesktopAdmin && permissions.length === 0 && <div className="small muted">—</div>}
        </main>
      </div>
      <Toasts toasts={toasts} />
    </div>
  );
}

function TitleBar() {
  return (
    <div className="titlebar">
      <div className="brand">
        <Logo size={20} />
        Assetown Admin
        <small>Console d'administration</small>
      </div>
      <div className="spacer" />
      <div className="win-controls">
        <button className="win-btn" onClick={() => void bridge.app.minimize()} aria-label="Réduire">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4">
            <path d="M2 6h8" />
          </svg>
        </button>
        <button className="win-btn close" onClick={() => void bridge.app.close()} aria-label="Fermer">
          <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span className="bar" />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}

export type { UserProfile };
