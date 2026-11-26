import { useCallback, useEffect, useState } from "react";
import type { Permission, Role } from "@assetown/shared";
import { api } from "../lib/bridge";
import { ConfirmModal } from "../components/Modal";

interface PlayerRow {
  id: string;
  username: string;
  email: string;
  discord: string | null;
  role: Role;
  emailVerified: boolean;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  skinUrl: string | null;
  permissions: string[];
}

const ROLES: Role[] = ["player", "moderator", "admin", "owner"];

export function PlayersPage({
  user,
  notify,
  can,
}: {
  user: { id: string; role: string; username: string };
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  can: (permission: Permission) => boolean;
}) {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PlayerRow | null>(null);
  const limit = 25;
  const manage = can("players.manage");

  const load = useCallback(
    async (nextOffset = offset, nextSearch = search) => {
      setLoading(true);
      try {
        const data = await api.get<{ total: number; players: PlayerRow[] }>(
          `/api/admin/players?q=${encodeURIComponent(nextSearch)}&limit=${limit}&offset=${nextOffset}`,
        );
        setPlayers(data.players);
        setTotal(data.total);
        setOffset(nextOffset);
      } catch (error) {
        notify((error as Error).message, "error");
      } finally {
        setLoading(false);
      }
    },
    [limit, notify, offset, search],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(0, search), 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    void load(0, "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = async (player: PlayerRow, body: Record<string, unknown>, label: string) => {
    try {
      await api.patch(`/api/admin/players/${player.id}`, body);
      await load(offset, search);
      notify(`${label} — ${player.username}`, "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/admin/players/${deleteTarget.id}`);
      setDeleteTarget(null);
      await load(offset, search);
      notify("Compte supprimé.", "success");
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Joueurs</h1>
          <p>
            Consultez les comptes, gérez les rôles et désactivez un accès en cas de problème. Chaque action est enregistrée
            dans le journal d'audit.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ width: 240 }}
            placeholder="Rechercher (pseudo, e-mail, Discord)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button className="btn small ghost" onClick={() => void load(offset, search)}>
            Actualiser
          </button>
        </div>
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Joueur</th>
              <th>E-mail</th>
              <th>Discord</th>
              <th>Rôle</th>
              <th>Inscription</th>
              <th>Dernière connexion</th>
              <th>État</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {players.length === 0 && (
              <tr>
                <td colSpan={8} className="empty">
                  {loading ? "Chargement…" : "Aucun joueur trouvé."}
                </td>
              </tr>
            )}
            {players.map((player) => (
              <tr key={player.id}>
                <td>
                  <div className="row" style={{ gap: 9 }}>
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 7,
                        overflow: "hidden",
                        background: "linear-gradient(135deg,#8b6bff,#4f9cff)",
                        display: "grid",
                        placeItems: "center",
                        fontSize: 11,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {player.skinUrl ? (
                        <img
                          src={player.skinUrl}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(3.3)", objectPosition: "12% 10%", imageRendering: "pixelated" }}
                        />
                      ) : (
                        player.username.slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{player.username}</div>
                      <div className="small muted">
                        {player.emailVerified ? "e-mail vérifié" : "e-mail non vérifié"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="small muted">{player.email}</td>
                <td className="small muted">{player.discord ?? "—"}</td>
                <td>
                  {manage ? (
                    <select
                      className="select"
                      style={{ width: 120, padding: "5px 26px 5px 8px", fontSize: 11.5 }}
                      value={player.role}
                      disabled={player.id === user.id || (player.role === "owner" && user.role !== "owner")}
                      onChange={(event) => void update(player, { role: event.target.value }, "Rôle mis à jour")}
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className={`chip ${player.role === "player" ? "" : "tested"}`}>{player.role}</span>
                  )}
                </td>
                <td className="small muted">
                  {new Date(player.createdAt).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
                </td>
                <td className="small muted">
                  {player.lastLoginAt
                    ? new Date(player.lastLoginAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : "jamais"}
                </td>
                <td>
                  <span className={`chip ${player.disabled ? "danger" : "published"}`}>
                    {player.disabled ? "désactivé" : "actif"}
                  </span>
                </td>
                <td>
                  <div className="row" style={{ gap: 5, justifyContent: "flex-end" }}>
                    {manage && player.id !== user.id && (
                      <button
                        className="btn small ghost"
                        onClick={() => void update(player, { disabled: !player.disabled }, player.disabled ? "Compte réactivé" : "Compte désactivé")}
                      >
                        {player.disabled ? "Réactiver" : "Désactiver"}
                      </button>
                    )}
                    {user.role === "owner" && player.id !== user.id && (
                      <button className="btn small danger" onClick={() => setDeleteTarget(player)}>
                        Supprimer
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row between" style={{ marginTop: 12 }}>
        <span className="small muted">
          {total} compte(s) · page {Math.floor(offset / limit) + 1} / {Math.max(1, Math.ceil(total / limit))}
        </span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn small" disabled={offset === 0} onClick={() => void load(Math.max(0, offset - limit), search)}>
            ← Précédent
          </button>
          <button
            className="btn small"
            disabled={offset + limit >= total}
            onClick={() => void load(offset + limit, search)}
          >
            Suivant →
          </button>
        </div>
      </div>

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Supprimer ce compte"
        message={`Le compte de ${deleteTarget?.username ?? ""} et ses données (skin, sessions) seront supprimés. Le pseudo restera réservé.`}
        confirmLabel="Supprimer définitivement"
        danger
        onConfirm={() => void remove()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
