import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditEntry } from "@assetown/shared";
import { api } from "../lib/bridge";

export function AuditPage({ notify }: { notify: (message: string, kind?: "info" | "success" | "error") => void }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [limit, setLimit] = useState(200);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ entries: AuditEntry[] }>(`/api/admin/audit?limit=${limit}`);
      setEntries(data.entries);
    } catch (error) {
      notify((error as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, [limit, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) =>
      [entry.actor, entry.action, entry.target ?? "", entry.ip ?? ""].join(" ").toLowerCase().includes(query),
    );
  }, [entries, search]);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Journal d'audit</h1>
          <p>Chaque action administrative sensible est horodatée et conservée pour traçabilité.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ width: 220 }}
            placeholder="Filtrer (acteur, action…)"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select className="select" style={{ width: 110 }} value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
          <button className="btn small" onClick={() => void load()} disabled={loading}>
            Actualiser
          </button>
        </div>
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Acteur</th>
              <th>Action</th>
              <th>Cible</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  Aucune entrée.
                </td>
              </tr>
            )}
            {filtered.map((entry) => (
              <tr key={entry.id}>
                <td className="mono small muted">
                  {new Date(entry.createdAt).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </td>
                <td className="small">{entry.actor}</td>
                <td>
                  <span className="chip">{entry.action}</span>
                </td>
                <td className="mono small muted" title={entry.metadata ?? undefined}>
                  {entry.target ?? "—"}
                </td>
                <td className="mono small muted">{entry.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
