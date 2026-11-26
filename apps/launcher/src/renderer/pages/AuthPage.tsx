import { useState, type FormEvent } from "react";
import { Logo } from "../components/Logo";
import { bridge, isDesktop } from "../lib/bridge";
import type { Lang } from "../lib/i18n";
import type { UserProfile } from "@assetown/shared";

interface AuthPageProps {
  t: (key: string) => string;
  lang: Lang;
  onAuthenticated: (user: UserProfile) => void;
  initialError?: string | null;
}

type Mode = "login" | "register" | "forgot" | "verify";

export function AuthPage({ t, lang, onAuthenticated, initialError }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [discord, setDiscord] = useState("");
  const [accepted, setAccepted] = useState(false);

  const reset = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setDevLink(null);
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await bridge.auth.login(identifier.trim(), password);
      onAuthenticated(result.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(lang === "fr" ? "Les mots de passe ne correspondent pas." : "Passwords do not match.");
      return;
    }
    if (!accepted) {
      setError(lang === "fr" ? "Vous devez accepter le règlement." : "You must accept the rules.");
      return;
    }
    setBusy(true);
    try {
      const result = await bridge.auth.register({
        email: email.trim(),
        username: username.trim(),
        password,
        discord: discord.trim(),
        acceptedTerms: true,
      });
      onAuthenticated(result.user);
      if (result.devLink) setDevLink(result.devLink);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await bridge.auth.forgotPassword(email.trim());
      setNotice(t("auth.resetSent"));
      if (result?.devLink) setDevLink(result.devLink);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-left">
        <div className="auth-logo">
          <Logo size={46} className="mark" />
          <span className="wordmark">Assetown</span>
        </div>

        <div className="auth-hero">
          <h1>{t("auth.welcome")}</h1>
          <p>{t("auth.subtitle")}</p>

          <div className="auth-features">
            <div className="auth-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3 4 7v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V7l-8-4Z" strokeLinejoin="round" />
                <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div>
                <div className="t">Sessions sécurisées</div>
                <div className="d">Mots de passe hachés (scrypt), jetons chiffrés via le coffre Windows.</div>
              </div>
            </div>
            <div className="auth-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
              </svg>
              <div>
                <div className="t">Trois univers, un launcher</div>
                <div className="d">V1, V2 et V3 : fichiers, mods et configurations isolés par version.</div>
              </div>
            </div>
            <div className="auth-feature">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div>
                <div className="t">Mises à jour automatiques</div>
                <div className="d">Synchronisation par hash : seuls les fichiers nécessaires sont téléchargés.</div>
              </div>
            </div>
          </div>
        </div>

        <p className="small muted" style={{ maxWidth: 430, lineHeight: 1.6 }}>
          {t("auth.offlineNote")}
        </p>
      </div>

      <div className="auth-right">
        <div className="auth-card">
          {mode !== "forgot" && (
            <div className="auth-tabs">
              <button className={mode === "login" ? "active" : ""} onClick={() => reset("login")} type="button">
                {t("auth.login")}
              </button>
              <button className={mode === "register" ? "active" : ""} onClick={() => reset("register")} type="button">
                {t("auth.register")}
              </button>
            </div>
          )}

          {mode === "login" && (
            <form className="stack" onSubmit={handleLogin} style={{ gap: 14 }}>
              <h2>{t("auth.login")}</h2>
              <p className="sub">{t("auth.subtitle")}</p>
              <div className="field">
                <label htmlFor="identifier">{t("auth.identifier")}</label>
                <input
                  id="identifier"
                  className="input"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  autoComplete="username"
                  required
                  autoFocus
                />
              </div>
              <div className="field">
                <label htmlFor="password">{t("auth.password")}</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && <div className="alert error">{error}</div>}
              <button className="btn primary" disabled={busy} type="submit">
                {busy ? t("auth.signingIn") : t("auth.login")}
              </button>
              <button className="btn ghost small" type="button" onClick={() => reset("forgot")}>
                {t("auth.forgot")}
              </button>
              {!isDesktop && <div className="alert info">{t("app.webPreview")}</div>}
            </form>
          )}

          {mode === "register" && (
            <form className="stack" onSubmit={handleRegister} style={{ gap: 12 }}>
              <h2>{t("auth.register")}</h2>
              <p className="sub">{t("auth.offlineNote")}</p>
              <div className="field">
                <label htmlFor="email">{t("auth.email")}</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                />
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="username">{t("auth.username")}</label>
                  <input
                    id="username"
                    className="input"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Steve"
                    minLength={3}
                    maxLength={16}
                    pattern="[A-Za-z0-9_]{3,16}"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="discord">{t("auth.discord")}</label>
                  <input
                    id="discord"
                    className="input"
                    value={discord}
                    onChange={(event) => setDiscord(event.target.value)}
                    placeholder="pseudo"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="new-password">{t("auth.password")}</label>
                <input
                  id="new-password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
                <span className="help">8 caractères minimum, lettres et chiffres.</span>
              </div>
              <div className="field">
                <label htmlFor="confirm">{t("auth.confirmPassword")}</label>
                <input
                  id="confirm"
                  className="input"
                  type="password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>
              <label className="switch" style={{ alignItems: "flex-start" }}>
                <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                <span className="track" style={{ marginTop: 2 }} />
                <span className="label">{t("auth.acceptTerms")}</span>
              </label>
              {error && <div className="alert error">{error}</div>}
              {devLink && (
                <div className="alert info">
                  Lien de vérification (dev) :{" "}
                  <a
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      void bridge.app.openExternal(devLink);
                    }}
                  >
                    ouvrir
                  </a>
                </div>
              )}
              <button className="btn primary" disabled={busy} type="submit">
                {busy ? t("auth.creating") : t("auth.register")}
              </button>
            </form>
          )}

          {mode === "forgot" && (
            <form className="stack" onSubmit={handleForgot} style={{ gap: 14 }}>
              <h2>{t("auth.forgot")}</h2>
              <p className="sub">
                {lang === "fr"
                  ? "Indiquez l'adresse e-mail de votre compte : nous vous envoyons un lien de réinitialisation valable une heure."
                  : "Enter your account email: we'll send a reset link valid for one hour."}
              </p>
              <div className="field">
                <label htmlFor="forgot-email">{t("auth.email")}</label>
                <input
                  id="forgot-email"
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoFocus
                />
              </div>
              {notice && <div className="alert success">{notice}</div>}
              {error && <div className="alert error">{error}</div>}
              {devLink && (
                <div className="alert info">
                  Lien de réinitialisation (dev) :{" "}
                  <a
                    href="#"
                    onClick={(event) => {
                      event.preventDefault();
                      void bridge.app.openExternal(devLink);
                    }}
                  >
                    ouvrir
                  </a>
                </div>
              )}
              <button className="btn primary" disabled={busy} type="submit">
                {busy ? t("common.loading") : t("auth.forgot")}
              </button>
              <button className="btn ghost small" type="button" onClick={() => reset("login")}>
                {t("auth.backToLogin")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
