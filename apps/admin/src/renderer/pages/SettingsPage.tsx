import { useCallback, useEffect, useState } from "react";
import { api, bridge } from "../lib/bridge";

interface SettingsResponse {
  branding: {
    brandName: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    discordUrl: string | null;
    websiteUrl: string | null;
    storeUrl: string | null;
    supportUrl: string | null;
    welcomeTitle: string;
    welcomeText: string;
    maintenance: { enabled: boolean; message: string };
  };
  metadata: {
    publicBaseUrl: string;
    dataDir: string;
    roles: string[];
    permissions: string[];
    serverHost: string;
    serverPort: number;
  };
}

export function SettingsPage({
  notify,
  apiBaseUrl,
}: {
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  apiBaseUrl: string;
}) {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState(apiBaseUrl);

  const load = useCallback(async () => {
    try {
      const data = await api.get<SettingsResponse>("/api/admin/settings");
      setSettings(data);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!settings) return <div className="empty">Chargement des paramètres…</div>;

  const branding = settings.branding;
  const patch = (next: Partial<SettingsResponse["branding"]>) =>
    setSettings({ ...settings, branding: { ...branding, ...next } });

  const save = async () => {
    setBusy(true);
    try {
      const data = await api.patch<{ branding: SettingsResponse["branding"] }>("/api/admin/settings", {
        brandName: branding.brandName,
        logoUrl: branding.logoUrl,
        bannerUrl: branding.bannerUrl,
        discordUrl: branding.discordUrl,
        websiteUrl: branding.websiteUrl,
        storeUrl: branding.storeUrl,
        supportUrl: branding.supportUrl,
        welcomeTitle: branding.welcomeTitle,
        welcomeText: branding.welcomeText,
        maintenance: branding.maintenance,
      });
      setSettings({ ...settings, branding: data.branding });
      notify("Paramètres enregistrés. Les launchers les récupèrent au prochain rafraîchissement.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const upload = async (field: "logoUrl" | "bannerUrl") => {
    try {
      const filePath = await bridge.pickImage();
      if (!filePath) return;
      const result = await bridge.uploadImage(filePath);
      patch({ [field]: result.url } as Partial<SettingsResponse["branding"]>);
      notify("Image envoyée. Enregistrez pour appliquer.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const changeApi = async () => {
    try {
      await bridge.setApiUrl(apiUrl.trim());
      notify("Serveur API mis à jour. Reconnectez-vous.", "success");
      window.location.reload();
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Paramètres</h1>
          <p>Identité visuelle du launcher, accès à l'API et informations d'infrastructure.</p>
        </div>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>
          Enregistrer
        </button>
      </div>

      <div className="grid main-side">
        <div className="stack">
          <div className="card stack" style={{ gap: 12 }}>
            <h3>Identité du launcher</h3>
            <div className="field">
              <label>Nom de la marque</label>
              <input className="input" value={branding.brandName} onChange={(event) => patch({ brandName: event.target.value })} />
            </div>
            <div className="field">
              <label>Titre de bienvenue (accueil joueur)</label>
              <input className="input" value={branding.welcomeTitle} onChange={(event) => patch({ welcomeTitle: event.target.value })} />
            </div>
            <div className="field">
              <label>Texte de bienvenue</label>
              <textarea
                className="textarea"
                value={branding.welcomeText}
                onChange={(event) => patch({ welcomeText: event.target.value })}
              />
            </div>

            <div className="field-row">
              <div className="field">
                <label>Logo (URL)</label>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" value={branding.logoUrl ?? ""} onChange={(event) => patch({ logoUrl: event.target.value || null })} />
                  <button className="btn small" onClick={() => void upload("logoUrl")}>
                    …
                  </button>
                </div>
                {branding.logoUrl && (
                  <img src={branding.logoUrl} alt="logo" style={{ height: 40, marginTop: 6, objectFit: "contain" }} />
                )}
              </div>
              <div className="field">
                <label>Bannière (URL)</label>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input" value={branding.bannerUrl ?? ""} onChange={(event) => patch({ bannerUrl: event.target.value || null })} />
                  <button className="btn small" onClick={() => void upload("bannerUrl")}>
                    …
                  </button>
                </div>
                {branding.bannerUrl && (
                  <img src={branding.bannerUrl} alt="bannière" style={{ height: 40, marginTop: 6, borderRadius: 6, objectFit: "cover" }} />
                )}
              </div>
            </div>
          </div>

          <div className="card stack" style={{ gap: 12 }}>
            <h3>Liens communautaires</h3>
            <div className="field-row">
              <div className="field">
                <label>Discord</label>
                <input className="input" value={branding.discordUrl ?? ""} onChange={(event) => patch({ discordUrl: event.target.value || null })} />
              </div>
              <div className="field">
                <label>Site web</label>
                <input className="input" value={branding.websiteUrl ?? ""} onChange={(event) => patch({ websiteUrl: event.target.value || null })} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Boutique</label>
                <input className="input" value={branding.storeUrl ?? ""} onChange={(event) => patch({ storeUrl: event.target.value || null })} />
              </div>
              <div className="field">
                <label>Support</label>
                <input className="input" value={branding.supportUrl ?? ""} onChange={(event) => patch({ supportUrl: event.target.value || null })} />
              </div>
            </div>
          </div>

          <div className="card stack" style={{ gap: 12 }}>
            <h3>Maintenance</h3>
            <label className="switch">
              <input
                type="checkbox"
                checked={branding.maintenance.enabled}
                onChange={(event) =>
                  patch({ maintenance: { ...branding.maintenance, enabled: event.target.checked } })
                }
              />
              <span className="track" />
              <span className="label">Afficher un bandeau de maintenance dans le launcher</span>
            </label>
            <div className="field">
              <label>Message de maintenance</label>
              <input
                className="input"
                value={branding.maintenance.message}
                onChange={(event) => patch({ maintenance: { ...branding.maintenance, message: event.target.value } })}
                placeholder="Les serveurs reviennent à 18h."
              />
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card stack" style={{ gap: 10 }}>
            <h3>Serveur API</h3>
            <div className="field">
              <label>URL utilisée par cette console</label>
              <input className="input" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
            </div>
            <button className="btn small" onClick={() => void changeApi()}>
              Appliquer et se reconnecter
            </button>
            <div className="kv">
              <span>URL publique (backend)</span>
              <span className="mono small">{settings.metadata.publicBaseUrl}</span>
            </div>
            <div className="kv">
              <span>Stockage des builds</span>
              <span className="mono small" style={{ maxWidth: 190, wordBreak: "break-all" }}>
                {settings.metadata.dataDir}
              </span>
            </div>
            <div className="kv">
              <span>Serveur par défaut</span>
              <span className="mono small">
                {settings.metadata.serverHost}:{settings.metadata.serverPort}
              </span>
            </div>
          </div>

          <div className="card">
            <h3>Rôles & permissions</h3>
            <div className="pill-list" style={{ marginBottom: 10 }}>
              {settings.metadata.roles.map((role) => (
                <span key={role} className="chip">
                  {role}
                </span>
              ))}
            </div>
            <div className="small muted" style={{ lineHeight: 1.6 }}>
              {settings.metadata.permissions.join(" · ")}
            </div>
          </div>

          <div className="alert info small">
            Les clés secrètes (SMTP, secret de signature, base de données) sont configurées côté serveur via le fichier
            <span className="mono"> .env</span> — jamais dans les launchers.
          </div>
        </div>
      </div>
    </div>
  );
}
