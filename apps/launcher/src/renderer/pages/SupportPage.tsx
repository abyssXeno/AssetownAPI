import { useEffect, useState } from "react";
import type { GameStatus } from "../../shared/types";
import { bridge } from "../lib/bridge";
import type { Lang } from "../lib/i18n";

interface SupportPageProps {
  t: (key: string) => string;
  lang: Lang;
  game: GameStatus;
  user: { username: string; email: string };
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}

export function SupportPage({ t, lang, game, user, notify }: SupportPageProps) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [includeLogs, setIncludeLogs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState("");
  const [gameLogs, setGameLogs] = useState("");

  const refresh = async () => {
    try {
      const [launcherLogs, gameTail] = await Promise.all([
        bridge.support.recentLogs(250),
        bridge.support.gameLogTail(250),
      ]);
      setLogs(launcherLogs);
      setGameLogs(gameTail);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  useEffect(() => {
    void refresh();
  }, [game.phase]);

  const send = async () => {
    if (subject.trim().length < 3 || message.trim().length < 10) {
      notify(lang === "fr" ? "Décrivez le problème (10 caractères minimum)." : "Describe the issue (10 characters minimum).", "error");
      return;
    }
    setBusy(true);
    try {
      const info = await bridge.app.info();
      await bridge.support.report({
        subject,
        message,
        includeLogs,
        system: `${info.appVersion} · Electron ${info.electron} · ${info.platform} · ${user.username} <${user.email}>`,
      });
      setSubject("");
      setMessage("");
      notify(t("support.sent"), "success");
      await refresh();
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const exportLogs = async () => {
    try {
      const path = await bridge.support.exportLogs();
      if (path) notify(`${t("support.export")} → ${path}`, "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div className="page-head">
        <div>
          <h1>{t("support.title")}</h1>
          <p>{t("support.subtitle")}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn small ghost" onClick={() => void refresh()}>
            {t("support.refresh")}
          </button>
          <button className="btn small" onClick={() => void exportLogs()}>
            {t("support.export")}
          </button>
        </div>
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="card stack" style={{ gap: 14 }}>
            <h3>{lang === "fr" ? "Signaler un problème" : "Report an issue"}</h3>
            <div className="field">
              <label>{t("support.subject")}</label>
              <input
                className="input"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder={lang === "fr" ? "Le jeu ne démarre pas" : "Game won't start"}
              />
            </div>
            <div className="field">
              <label>{t("support.message")}</label>
              <textarea
                className="textarea"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={
                  lang === "fr"
                    ? "Décrivez ce qui se passe, la version utilisée (V1/V2/V3), les mods concernés…"
                    : "Describe what happens, the version used (V1/V2/V3), the mods involved…"
                }
              />
            </div>
            <label className="switch">
              <input type="checkbox" checked={includeLogs} onChange={(event) => setIncludeLogs(event.target.checked)} />
              <span className="track" />
              <span className="label">{t("support.includeLogs")}</span>
            </label>
            <button className="btn primary" onClick={() => void send()} disabled={busy}>
              {busy && <span className="spinner" />}
              {t("support.send")}
            </button>
          </div>

          {game.crashReport && (
            <div className="card stack" style={{ gap: 10, borderColor: "rgba(255,96,121,.3)" }}>
              <h3 style={{ color: "#ffb3bf" }}>{t("support.crash")}</h3>
              <div className="log-view" style={{ maxHeight: 320 }}>{game.crashReport.slice(0, 20000)}</div>
            </div>
          )}

          <div className="card stack" style={{ gap: 10 }}>
            <div className="row between">
              <h3>{lang === "fr" ? "État du jeu" : "Game state"}</h3>
              <span className="tag mono">{game.phase}</span>
            </div>
            <div className="kv">
              <span>{lang === "fr" ? "Dernier code de sortie" : "Last exit code"}</span>
              <span className="mono">{game.exitCode ?? "—"}</span>
            </div>
            <div className="kv">
              <span>{lang === "fr" ? "Message" : "Message"}</span>
              <span>{game.message || "—"}</span>
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card stack" style={{ gap: 10 }}>
            <h3>{t("support.logs")}</h3>
            <div className="log-view">{logs || (lang === "fr" ? "Aucun journal disponible." : "No log available.")}</div>
          </div>
          <div className="card stack" style={{ gap: 10 }}>
            <h3>{lang === "fr" ? "Sortie du jeu" : "Game output"}</h3>
            <div className="log-view">{gameLogs || (lang === "fr" ? "Aucune sortie de jeu." : "No game output.")}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
