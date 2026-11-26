import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Announcement, ChannelSlug, PublicConfig, UserProfile } from "@assetown/shared";
import { TitleBar } from "./components/TitleBar";
import { ProgressPanel } from "./components/ProgressPanel";
import { AuthPage } from "./pages/AuthPage";
import { HomePage } from "./pages/HomePage";
import { NewsPage } from "./pages/NewsPage";
import { SkinPage } from "./pages/SkinPage";
import { SettingsPage, type SettingsValues } from "./pages/SettingsPage";
import { SupportPage } from "./pages/SupportPage";
import { bridge, isDesktop } from "./lib/bridge";
import { translate, type Lang } from "./lib/i18n";
import type { GameStatus, SessionState, SyncProgress } from "../shared/types";

type NavKey = "home" | "news" | "skin" | "settings" | "support";

interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}

const DEFAULT_SETTINGS: SettingsValues = {
  apiBaseUrl: "https://assetown-api-router-3e3dmn-preview.freebuff.site",
  installDir: "",
  ramMinMb: 2048,
  ramMaxMb: 4096,
  resolutionWidth: 1920,
  resolutionHeight: 1080,
  fullscreen: false,
  language: "fr",
  autoStartOnBoot: false,
  closeOnLaunch: false,
  javaPath: "",
  jvmArgs: "",
  selectedChannel: "v2",
};

const IDLE_GAME: GameStatus = {
  phase: "idle",
  channel: null,
  pid: null,
  startedAt: null,
  exitCode: null,
  message: "",
  crashReport: null,
};

const NAV_ICONS: Record<NavKey, JSX.Element> = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1V10Z" strokeLinejoin="round" />
    </svg>
  ),
  news: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <path d="M4 5h13v14H6a2 2 0 0 1-2-2V5Z" strokeLinejoin="round" />
      <path d="M17 9h3v8a2 2 0 0 1-2 2h-1M7 9h7M7 13h7M7 16h4" strokeLinecap="round" />
    </svg>
  ),
  skin: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" strokeLinecap="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 7 3a1.7 1.7 0 0 0 1-1.6V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 14 3a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" strokeLinejoin="round" />
    </svg>
  ),
  support: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9a2.9 2.9 0 1 1 4.2 2.6c-.9.5-1.4 1-1.4 2M12 17.2h.01" strokeLinecap="round" />
    </svg>
  ),
};

export default function App() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [settings, setSettings] = useState<SettingsValues>(DEFAULT_SETTINGS);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [news, setNews] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<Announcement[]>([]);
  const [nav, setNav] = useState<NavKey>("home");
  const [selected, setSelected] = useState<ChannelSlug>("v2");
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [game, setGame] = useState<GameStatus>(IDLE_GAME);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const contentTimer = useRef<number | null>(null);

  const lang = (settings.language as Lang) ?? "fr";
  const t = useMemo(() => (key: string) => translate(lang, key), [lang]);

  const notify = useCallback((message: string, kind: Toast["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }, []);

  const loadContent = useCallback(async () => {
    try {
      const [publicConfig, newsData, notificationsData] = await Promise.all([
        bridge.content.config(),
        bridge.content.news(20),
        bridge.content.notifications(),
      ]);
      setConfig(publicConfig);
      setNews(newsData.announcements);
      setNotifications(notificationsData.notifications);
      setBootError(null);
      return true;
    } catch (error) {
      setBootError((error as Error).message);
      return false;
    }
  }, []);

  const boot = useCallback(async () => {
    setBooting(true);
    try {
      const raw = (await bridge.settings.get()) as unknown as Partial<SettingsValues>;
      const merged: SettingsValues = {
        ...DEFAULT_SETTINGS,
        ...raw,
        selectedChannel: raw.selectedChannel ?? DEFAULT_SETTINGS.selectedChannel,
      };
      setSettings(merged);
      setSelected(merged.selectedChannel);

      const state = await bridge.auth.state();
      setSession(state);
      if (state.user) {
        setSettings((current) => ({ ...current }));
      }
      await loadContent();
      const status = await bridge.game.status();
      setGame(status);
    } catch (error) {
      setBootError((error as Error).message);
    } finally {
      setBooting(false);
    }
  }, [loadContent]);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    if (!isDesktop) return;
    const unsubscribeProgress = bridge.events.onSyncProgress((next) => setProgress(next));
    const unsubscribeGame = bridge.events.onGameStatus((status) => {
      setGame(status);
      if (status.phase === "crashed") notify(status.message || t("common.error"), "error");
      if (status.phase === "exited") notify(status.message, "info");
    });
    const unsubscribeAuth = bridge.events.onAuthChanged((next) => {
      setSession(next);
      if (!next.authenticated) setNav("home");
    });
    return () => {
      unsubscribeProgress();
      unsubscribeGame();
      unsubscribeAuth();
    };
  }, [notify, t]);

  useEffect(() => {
    contentTimer.current = window.setInterval(() => {
      void loadContent();
    }, 90_000);
    return () => {
      if (contentTimer.current) window.clearInterval(contentTimer.current);
    };
  }, [loadContent]);

  const selectChannel = async (channel: ChannelSlug) => {
    setSelected(channel);
    setSettings((current) => ({ ...current, selectedChannel: channel }));
    try {
      await bridge.settings.save({ selectedChannel: channel });
    } catch {
      /* préférence non bloquante */
    }
  };

  const play = async (channel: ChannelSlug) => {
    if (game.phase === "running") {
      await bridge.game.kill();
      return;
    }
    setBusy(true);
    setProgress(null);
    try {
      const summary = await bridge.sync.start(channel);
      if (summary.downloaded > 0) {
        notify(
          lang === "fr"
            ? `Installation terminée : ${summary.downloaded} fichier(s) mis à jour`
            : `Installation complete: ${summary.downloaded} file(s) updated`,
          "success",
        );
      }
      const result = await bridge.game.launch(channel);
      if (!result.ok) notify(result.message ?? t("common.error"), "error");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(null), 2500);
    }
  };

  const repair = async (channel: ChannelSlug) => {
    setBusy(true);
    try {
      const summary = await bridge.sync.repair(channel);
      notify(
        lang === "fr"
          ? `Vérification terminée : ${summary.downloaded} fichier(s) réparé(s), ${summary.skipped} intact(s)`
          : `Check complete: ${summary.downloaded} repaired, ${summary.skipped} intact`,
        "success",
      );
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
      window.setTimeout(() => setProgress(null), 2000);
    }
  };

  const handleAuthenticated = (user: UserProfile) => {
    setSession({ authenticated: true, user, offline: false, apiBaseUrl: settings.apiBaseUrl });
    void loadContent();
  };

  const logout = () => {
    setSession({ authenticated: false, user: null, offline: true, apiBaseUrl: settings.apiBaseUrl });
    setNav("home");
  };

  if (booting) {
    return (
      <div className="shell">
        <TitleBar user={null} t={t} notifications={[]} onOpenNews={() => undefined} />
        <div style={{ flex: 1, display: "grid", placeItems: "center" }}>
          <div className="row" style={{ gap: 12, color: "var(--muted)" }}>
            <span className="spinner" /> {t("common.loading")}
          </div>
        </div>
      </div>
    );
  }

  if (bootError && !config) {
    return (
      <div className="shell">
        <TitleBar user={null} t={t} notifications={[]} onOpenNews={() => undefined} />
        <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
          <div className="card stack" style={{ maxWidth: 460, gap: 14 }}>
            <h3>{lang === "fr" ? "Serveur Assetown injoignable" : "Assetown server unreachable"}</h3>
            <p className="hint">{bootError}</p>
            <div className="field">
              <label>{t("settings.api")}</label>
              <input
                className="input"
                value={settings.apiBaseUrl}
                onChange={(event) => setSettings((current) => ({ ...current, apiBaseUrl: event.target.value }))}
              />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn primary"
                onClick={async () => {
                  try {
                    await bridge.settings.save({ apiBaseUrl: settings.apiBaseUrl });
                    await boot();
                  } catch (error) {
                    notify((error as Error).message, "error");
                  }
                }}
              >
                {t("common.retry")}
              </button>
              <button className="btn ghost" onClick={() => void boot()}>
                {t("settings.reset")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!session?.authenticated || !session.user) {
    return (
      <div className="shell">
        <TitleBar user={null} t={t} notifications={notifications} onOpenNews={() => undefined} />
        <AuthPage t={t} lang={lang} onAuthenticated={handleAuthenticated} initialError={null} />
        <ToastStack toasts={toasts} />
      </div>
    );
  }

  const user = session.user;
  const navItems: Array<{ key: NavKey; label: string }> = [
    { key: "home", label: t("nav.home") },
    { key: "news", label: t("nav.news") },
    { key: "skin", label: t("nav.skin") },
    { key: "settings", label: t("nav.settings") },
    { key: "support", label: t("nav.support") },
  ];

  return (
    <div className="shell">
      <TitleBar user={user} t={t} notifications={notifications} onOpenNews={() => setNav("news")} />
      <div className="body">
        <aside className="sidebar">
          <div className="nav-label">Assetown</div>
          {navItems.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${nav === item.key ? "active" : ""}`}
              onClick={() => setNav(item.key)}
            >
              {NAV_ICONS[item.key]}
              {item.label}
            </button>
          ))}

          <div className="nav-label" style={{ marginTop: 14 }}>
            {lang === "fr" ? "Versions" : "Versions"}
          </div>
          {(config?.channels ?? []).map((channel) => (
            <button
              key={channel.slug}
              className="nav-item"
              onClick={() => {
                void selectChannel(channel.slug);
                setNav("home");
              }}
              style={{ opacity: channel.enabled ? 1 : 0.45 }}
            >
              <span
                className={`dot ${channel.enabled ? (channel.status.online ? "online" : "offline") : ""}`}
                style={{ marginLeft: 2, marginRight: 3 }}
              />
              <span style={{ flex: 1 }}>{channel.name}</span>
              {selected === channel.slug && <span className="tag mono" style={{ fontSize: 9 }}>ON</span>}
            </button>
          ))}

          <div className="sidebar-footer">
            <div className="user-card">
              <div className="avatar">
                {user.skin?.url ? <img src={user.skin.url} alt="" /> : user.username.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className="name" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {user.username}
                </div>
                <div className="role">
                  {user.emailVerified ? t("app.online") : lang === "fr" ? "E-mail non vérifié" : "Email unverified"}
                </div>
              </div>
            </div>
          </div>
        </aside>

        <main className="content">
          {!isDesktop && <div className="banner-note">{t("app.webPreview")}</div>}

          {game.phase === "running" && (
            <div className="alert success" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>
                {t("home.running")} — {game.channel?.toUpperCase()} · PID {game.pid}
              </span>
              <button className="btn small" onClick={() => void bridge.game.kill()}>
                {t("home.stopGame")}
              </button>
            </div>
          )}

          {game.phase === "crashed" && (
            <div className="alert error" style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{game.message}</span>
              <button className="btn small" onClick={() => setNav("support")}>
                {t("support.crash")}
              </button>
            </div>
          )}

          {progress && progress.phase !== "idle" && (
            <div style={{ marginBottom: 18 }}>
              <ProgressPanel
                progress={progress}
                lang={lang}
                t={t}
                onPause={() => void bridge.sync.pause()}
                onResume={() => void bridge.sync.resume()}
                onCancel={() => void bridge.sync.stop()}
              />
            </div>
          )}

          {nav === "home" && config && (
            <HomePage
              config={config}
              news={news}
              selected={selected}
              onSelect={(channel) => void selectChannel(channel)}
              onPlay={(channel) => void play(channel)}
              onOpenNews={() => setNav("news")}
              busy={busy}
              game={game}
              lang={lang}
              t={t}
            />
          )}

          {nav === "news" && <NewsPage news={news} t={t} lang={lang} />}

          {nav === "skin" && (
            <SkinPage
              user={user}
              t={t}
              lang={lang}
              onUserUpdated={(next) =>
                setSession({ authenticated: true, user: next, offline: false, apiBaseUrl: settings.apiBaseUrl })
              }
              notify={notify}
            />
          )}

          {nav === "settings" && (
            <SettingsPage
              settings={settings}
              user={user}
              channels={config?.channels ?? []}
              selected={selected}
              t={t}
              lang={lang}
              busy={busy}
              notify={notify}
              onSaved={(next) => setSettings(next)}
              onUserUpdated={(next) =>
                setSession({ authenticated: true, user: next, offline: false, apiBaseUrl: settings.apiBaseUrl })
              }
              onLogout={logout}
              onRepair={(channel) => void repair(channel)}
            />
          )}

          {nav === "support" && (
            <SupportPage t={t} lang={lang} game={game} user={{ username: user.username, email: user.email }} notify={notify} />
          )}
        </main>
      </div>

      <ToastStack toasts={toasts} />
    </div>
  );
}

function ToastStack({ toasts }: { toasts: Toast[] }) {
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
