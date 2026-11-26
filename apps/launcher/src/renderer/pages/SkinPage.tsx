import { useEffect, useState } from "react";
import type { UserProfile } from "@assetown/shared";
import { SkinViewer } from "../components/SkinViewer";
import { bridge } from "../lib/bridge";
import type { Lang } from "../lib/i18n";

interface SkinPageProps {
  user: UserProfile;
  t: (key: string) => string;
  lang: Lang;
  onUserUpdated: (user: UserProfile) => void;
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}

export function SkinPage({ user, t, lang, onUserUpdated, notify }: SkinPageProps) {
  const [preview, setPreview] = useState<{ current: string | null; previous: string | null; model: "steve" | "alex" }>({
    current: null,
    previous: null,
    model: user.skin?.model ?? "steve",
  });
  const [pending, setPending] = useState<{ path: string; dataUrl: string } | null>(null);
  const [model, setModel] = useState<"steve" | "alex">(user.skin?.model ?? "steve");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const data = await bridge.skin.preview();
      setPreview(data);
      setModel(data.model);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const choose = async () => {
    try {
      const filePath = await bridge.skin.chooseFile();
      if (!filePath) return;
      const dataUrl = await bridge.skin.readFile(filePath);
      if (!dataUrl) {
        notify(lang === "fr" ? "Fichier PNG illisible" : "Unreadable PNG file", "error");
        return;
      }
      setPending({ path: filePath, dataUrl });
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const save = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const result = await bridge.skin.upload(pending.path, model);
      onUserUpdated(result.user);
      setPending(null);
      await load();
      notify(lang === "fr" ? "Skin enregistré" : "Skin saved", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    try {
      const result = await bridge.skin.restore();
      onUserUpdated(result.user);
      setPending(null);
      await load();
      notify(lang === "fr" ? "Skin précédent restauré" : "Previous skin restored", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const shown = pending?.dataUrl ?? preview.current;

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div className="page-head">
        <div>
          <h1>{t("skin.title")}</h1>
          <p>{t("skin.subtitle")}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="tag">{pending ? (lang === "fr" ? "Aperçu local" : "Local preview") : t("skin.current")}</span>
          {user.skin?.updatedAt && (
            <span className="tag mono">{new Date(user.skin.updatedAt).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB")}</span>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div>
          {loading ? (
            <div className="skin-stage">
              <span className="spinner" />
            </div>
          ) : (
            <SkinViewer skin={shown} model={model} />
          )}
        </div>

        <div className="stack">
          <div className="card stack" style={{ gap: 12 }}>
            <h3>{t("skin.import")}</h3>
            <p className="hint">
              {lang === "fr"
                ? "PNG 64×64 (ou 64×32 pour l'ancien format). Le skin est validé puis stocké de manière sécurisée côté serveur."
                : "64×64 PNG (or 64×32 legacy). The skin is validated then stored securely server-side."}
            </p>
            <button className="btn primary" onClick={() => void choose()} disabled={busy}>
              {t("skin.import")}
            </button>
            {pending && (
              <button className="btn" onClick={() => void save()} disabled={busy}>
                {busy && <span className="spinner" />}
                {t("skin.save")}
              </button>
            )}
            {pending && (
              <button className="btn ghost small" onClick={() => setPending(null)} disabled={busy}>
                {t("common.cancel")}
              </button>
            )}
          </div>

          <div className="card stack" style={{ gap: 10 }}>
            <h3>{lang === "fr" ? "Modèle" : "Model"}</h3>
            <div className="model-toggle">
              <button className={`model-option ${model === "steve" ? "active" : ""}`} onClick={() => setModel("steve")}>
                <div className="t">Steve</div>
                <div className="small muted">4 px — {lang === "fr" ? "large" : "wide"}</div>
              </button>
              <button className={`model-option ${model === "alex" ? "active" : ""}`} onClick={() => setModel("alex")}>
                <div className="t">Alex</div>
                <div className="small muted">3 px — {lang === "fr" ? "fin" : "slim"}</div>
              </button>
            </div>
            <span className="help">
              {lang === "fr"
                ? "Le modèle est appliqué à l'enregistrement et utilisé par le serveur pour le rendu en jeu."
                : "The model is applied on save and used by the server for in-game rendering."}
            </span>
          </div>

          <div className="card stack" style={{ gap: 10 }}>
            <h3>{lang === "fr" ? "Historique" : "History"}</h3>
            {preview.previous ? (
              <>
                <div className="row" style={{ gap: 12 }}>
                  <img
                    src={preview.previous}
                    alt="skin précédent"
                    style={{ width: 56, height: 56, borderRadius: 10, background: "#0a0a12", imageRendering: "pixelated", border: "1px solid var(--line)" }}
                  />
                  <span className="small muted">
                    {lang === "fr" ? "Vous pouvez revenir au skin précédent à tout moment." : "You can return to the previous skin at any time."}
                  </span>
                </div>
                <button className="btn small" onClick={() => void restore()} disabled={busy}>
                  {t("skin.restore")}
                </button>
              </>
            ) : (
              <p className="hint">{lang === "fr" ? "Aucun skin précédent enregistré." : "No previous skin stored."}</p>
            )}
          </div>

          <div className="alert info">{t("skin.offlineInfo")}</div>
        </div>
      </div>
    </div>
  );
}
