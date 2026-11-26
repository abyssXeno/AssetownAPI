import { useCallback, useEffect, useState } from "react";
import type { AnnouncementType } from "@assetown/shared";
import { api, bridge } from "../lib/bridge";
import { Modal, ConfirmModal } from "../components/Modal";

interface AdminAnnouncement {
  id: string;
  type: AnnouncementType;
  title: string;
  body: string;
  imageUrl: string | null;
  linkUrl: string | null;
  linkLabel: string | null;
  pinned: boolean;
  publishedAt: string;
  expiresAt: string | null;
  eventAt: string | null;
  author: string | null;
  createdAt: string;
  updatedAt: string;
}

const TYPES: Array<{ value: AnnouncementType; label: string }> = [
  { value: "news", label: "Actualité" },
  { value: "event", label: "Événement" },
  { value: "maintenance", label: "Maintenance" },
  { value: "update", label: "Mise à jour" },
];

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const EMPTY = {
  type: "news" as AnnouncementType,
  title: "",
  body: "",
  imageUrl: "",
  linkUrl: "",
  linkLabel: "",
  pinned: false,
  publishedAt: toLocalInput(new Date().toISOString()),
  expiresAt: "",
  eventAt: "",
};

export function AnnouncementsPage({
  notify,
}: {
  notify: (message: string, kind?: "info" | "success" | "error") => void;
}) {
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminAnnouncement | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ announcements: AdminAnnouncement[] }>("/api/admin/announcements");
      setItems(data.announcements);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...EMPTY, publishedAt: toLocalInput(new Date().toISOString()) });
    setEditorOpen(true);
  };

  const openEdit = (item: AdminAnnouncement) => {
    setEditing(item);
    setForm({
      type: item.type,
      title: item.title,
      body: item.body,
      imageUrl: item.imageUrl ?? "",
      linkUrl: item.linkUrl ?? "",
      linkLabel: item.linkLabel ?? "",
      pinned: item.pinned,
      publishedAt: toLocalInput(item.publishedAt),
      expiresAt: toLocalInput(item.expiresAt),
      eventAt: toLocalInput(item.eventAt),
    });
    setEditorOpen(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        type: form.type,
        title: form.title,
        body: form.body,
        imageUrl: form.imageUrl || null,
        linkUrl: form.linkUrl || null,
        linkLabel: form.linkLabel || null,
        pinned: form.pinned,
        publishedAt: fromLocalInput(form.publishedAt) ?? new Date().toISOString(),
        expiresAt: fromLocalInput(form.expiresAt),
        eventAt: fromLocalInput(form.eventAt),
      };
      if (editing) await api.patch(`/api/admin/announcements/${editing.id}`, payload);
      else await api.post("/api/admin/announcements", payload);
      setEditorOpen(false);
      await load();
      notify(editing ? "Annonce mise à jour." : "Annonce créée et publiée.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      await api.delete(`/api/admin/announcements/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load();
      notify("Annonce supprimée.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async () => {
    try {
      const filePath = await bridge.pickImage();
      if (!filePath) return;
      const result = await bridge.uploadImage(filePath);
      setForm((current) => ({ ...current, imageUrl: result.url }));
      notify("Image envoyée.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const scheduled = (iso: string) => new Date(iso).getTime() > Date.now();

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Annonces</h1>
          <p>
            Les annonces publiées apparaissent immédiatement dans le launcher joueur : actualités, événements, maintenances
            et notes de mise à jour.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn small ghost" onClick={() => void load()}>
            Actualiser
          </button>
          <button className="btn primary" onClick={openCreate}>
            + Nouvelle annonce
          </button>
        </div>
      </div>

      <div className="stack">
        {items.length === 0 && <div className="card empty">Aucune annonce. Créez la première pour accueillir vos joueurs.</div>}
        {items.map((item) => (
          <div key={item.id} className="card">
            <div className="row between" style={{ alignItems: "flex-start", gap: 14 }}>
              <div style={{ display: "flex", gap: 14, minWidth: 0 }}>
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt=""
                    style={{ width: 96, height: 70, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)" }}
                  />
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className="chip">{TYPES.find((type) => type.value === item.type)?.label ?? item.type}</span>
                    {item.pinned && <span className="chip" style={{ color: "#ffc266" }}>★ épinglée</span>}
                    <span className={`chip ${scheduled(item.publishedAt) ? "draft" : "published"}`}>
                      {scheduled(item.publishedAt) ? "programmée" : "en ligne"}
                    </span>
                    <span className="small muted">
                      {new Date(item.publishedAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <h3 style={{ margin: "8px 0 6px", fontSize: 14 }}>{item.title}</h3>
                  <p className="small muted" style={{ margin: 0, lineHeight: 1.55, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {item.body}
                  </p>
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn small" onClick={() => openEdit(item)}>
                  Modifier
                </button>
                <button className="btn small danger" onClick={() => setDeleteTarget(item)}>
                  Supprimer
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={editorOpen}
        title={editing ? "Modifier l'annonce" : "Nouvelle annonce"}
        onClose={() => setEditorOpen(false)}
        wide
        actions={
          <>
            <button className="btn ghost" onClick={() => setEditorOpen(false)}>
              Annuler
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={busy || form.title.length < 3 || form.body.length < 3}>
              {editing ? "Enregistrer" : "Publier"}
            </button>
          </>
        }
      >
        <div className="field-row">
          <div className="field">
            <label>Type</label>
            <select
              className="select"
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as AnnouncementType })}
            >
              {TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Date de publication</label>
            <input
              className="input"
              type="datetime-local"
              value={form.publishedAt}
              onChange={(event) => setForm({ ...form, publishedAt: event.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label>Titre</label>
          <input className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
        </div>

        <div className="field">
          <label>Contenu</label>
          <textarea
            className="textarea"
            style={{ minHeight: 130 }}
            value={form.body}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
          />
        </div>

        <div className="field">
          <label>Image (URL ou fichier)</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              value={form.imageUrl}
              onChange={(event) => setForm({ ...form, imageUrl: event.target.value })}
              placeholder="https://…"
            />
            <button className="btn small" onClick={() => void uploadImage()}>
              Envoyer
            </button>
            {form.imageUrl && (
              <button className="btn small ghost" onClick={() => setForm({ ...form, imageUrl: "" })}>
                Retirer
              </button>
            )}
          </div>
        </div>

        <div className="field-row three">
          <div className="field">
            <label>Lien externe</label>
            <input
              className="input"
              value={form.linkUrl}
              onChange={(event) => setForm({ ...form, linkUrl: event.target.value })}
              placeholder="https://discord.gg/…"
            />
          </div>
          <div className="field">
            <label>Libellé du lien</label>
            <input
              className="input"
              value={form.linkLabel}
              onChange={(event) => setForm({ ...form, linkLabel: event.target.value })}
              placeholder="Rejoindre le Discord"
            />
          </div>
          <div className="field">
            <label>Date de l'événement</label>
            <input
              className="input"
              type="datetime-local"
              value={form.eventAt}
              onChange={(event) => setForm({ ...form, eventAt: event.target.value })}
            />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label>Expiration (optionnel)</label>
            <input
              className="input"
              type="datetime-local"
              value={form.expiresAt}
              onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
            />
          </div>
          <label className="switch" style={{ marginTop: 18 }}>
            <input
              type="checkbox"
              checked={form.pinned}
              onChange={(event) => setForm({ ...form, pinned: event.target.checked })}
            />
            <span className="track" />
            <span className="label">Épingler en haut du launcher</span>
          </label>
        </div>
      </Modal>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Supprimer l'annonce"
        message={`« ${deleteTarget?.title ?? ""} » sera retirée du launcher joueur immédiatement.`}
        confirmLabel="Supprimer"
        danger
        onConfirm={() => void remove()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
