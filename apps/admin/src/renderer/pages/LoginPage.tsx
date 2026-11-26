import { useState, type FormEvent } from "react";
import { Logo } from "../components/Logo";
import { bridge } from "../lib/bridge";

interface LoginPageProps {
  apiBaseUrl: string;
  onAuthenticated: () => Promise<void> | void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}

export function LoginPage({ apiBaseUrl, onAuthenticated, notify }: LoginPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [apiUrl, setApiUrl] = useState(apiBaseUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApi, setShowApi] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (apiUrl.trim() && apiUrl.trim() !== apiBaseUrl) {
        await bridge.setApiUrl(apiUrl.trim());
      }
      await bridge.login(email.trim(), password);
      await onAuthenticated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={submit}>
        <div className="head">
          <Logo size={36} />
          <div>
            <h1>Assetown Admin Panel</h1>
            <p className="sub">Accès réservé à l'équipe autorisée</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="admin-email">Adresse e-mail</label>
          <input
            id="admin-email"
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="username"
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="admin-password">Mot de passe</label>
          <input
            id="admin-password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && <div className="alert error">{error}</div>}

        <button className="btn primary" type="submit" disabled={busy} style={{ padding: "11px 16px" }}>
          {busy && <span className="spinner" />}
          {busy ? "Connexion…" : "Se connecter"}
        </button>

        <button className="btn ghost small" type="button" onClick={() => setShowApi((value) => !value)}>
          {showApi ? "Masquer le serveur" : "Configurer le serveur"}
        </button>

        {showApi && (
          <div className="field">
            <label htmlFor="api">Adresse de l'API Assetown</label>
            <input id="api" className="input" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
            <span className="help">HTTPS obligatoire hors réseau local (ex. https://api.assetown.fr).</span>
          </div>
        )}

        <div className="row" style={{ gap: 6, color: "var(--muted)", fontSize: 11 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <rect x="4" y="10" width="16" height="11" rx="2" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" />
          </svg>
          Toutes les actions sensibles sont enregistrées dans le journal d'audit.
        </div>

        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            void bridge.app.openExternal("https://assetown.fr/admin").catch(() => notify("Lien indisponible", "error"));
          }}
          style={{ display: "none" }}
        >
          Aide
        </button>
      </form>
    </div>
  );
}
