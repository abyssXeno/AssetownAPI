import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/bridge";
import { Modal } from "../components/Modal";

interface ReportRow {
  id: string;
  username: string | null;
  subject: string;
  message: string;
  hasLogs: boolean;
  system: string | null;
  status: string;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  open: "ouvert",
  in_progress: "en cours",
  closed: "clos",
};

export function ReportsPage({
  notify,
  onChanged,
}: {
  notify: (message: string, kind?: "info" | "success" | "error") => void;
  onChanged: () => void;
}) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [detail, setDetail] = useState<{ report: ReportRow; logs: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "closed">("all");

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ reports: ReportRow[] }>("/api/admin/reports");
      setReports(data.reports);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (report: ReportRow) => {
    try {
      const data = await api.get<{ report: ReportRow; logs: string }>(`/api/admin/reports/${report.id}`);
      setDetail(data);
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const setStatus = async (report: ReportRow, status: string) => {
    try {
      await api.patch(`/api/admin/reports/${report.id}`, { status });
      await load();
      onChanged();
      notify(`Rapport ${STATUS_LABEL[status] ?? status}.`, "success");
      if (detail?.report.id === report.id) setDetail({ ...detail, report: { ...detail.report, status } });
    } catch (error) {
      notify((error as Error).message, "error");
    }
  };

  const visible = reports.filter((report) =>
    filter === "all" ? true : filter === "open" ? report.status !== "closed" : report.status === "closed",
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Rapports de support</h1>
          <p>Rapports envoyés depuis le launcher joueur, avec journaux joints pour diagnostiquer rapidement.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <div className="tabs">
            {(["all", "open", "closed"] as const).map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item === "all" ? "Tous" : item === "open" ? "Ouverts" : "Clos"}
              </button>
            ))}
          </div>
          <button className="btn small ghost" onClick={() => void load()}>
            Actualiser
          </button>
        </div>
      </div>

      <div className="card flush">
        <table>
          <thead>
            <tr>
              <th>Sujet</th>
              <th>Joueur</th>
              <th>Reçu</th>
              <th>Journaux</th>
              <th>Statut</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  Aucun rapport.
                </td>
              </tr>
            )}
            {visible.map((report) => (
              <tr key={report.id}>
                <td>
                  <strong>{report.subject}</strong>
                  <div className="small muted" style={{ marginTop: 2 }}>
                    {report.message.slice(0, 80)}
                    {report.message.length > 80 ? "…" : ""}
                  </div>
                </td>
                <td className="small">{report.username ?? "—"}</td>
                <td className="small muted">
                  {new Date(report.createdAt).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="small mono muted">{report.hasLogs ? "oui" : "—"}</td>
                <td>
                  <span className={`chip ${report.status === "open" ? "draft" : report.status === "closed" ? "archived" : "tested"}`}>
                    {STATUS_LABEL[report.status] ?? report.status}
                  </span>
                </td>
                <td>
                  <button className="btn small" onClick={() => void open(report)}>
                    Ouvrir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={Boolean(detail)}
        title={detail?.report.subject ?? ""}
        onClose={() => setDetail(null)}
        wide
        actions={
          <>
            {detail && detail.report.status !== "in_progress" && (
              <button className="btn" onClick={() => void setStatus(detail.report, "in_progress")}>
                Prendre en charge
              </button>
            )}
            {detail && detail.report.status !== "closed" && (
              <button className="btn success" onClick={() => void setStatus(detail.report, "closed")}>
                Clore
              </button>
            )}
            {detail && detail.report.status === "closed" && (
              <button className="btn" onClick={() => void setStatus(detail.report, "open")}>
                Réouvrir
              </button>
            )}
            <button className="btn ghost" onClick={() => setDetail(null)}>
              Fermer
            </button>
          </>
        }
      >
        {detail && (
          <>
            <div className="kv">
              <span>Joueur</span>
              <span>{detail.report.username ?? "—"}</span>
            </div>
            <div className="kv">
              <span>Système</span>
              <span className="mono small">{detail.report.system ?? "—"}</span>
            </div>
            <p style={{ whiteSpace: "pre-wrap" }}>{detail.report.message}</p>
            {detail.logs ? (
              <div className="log-view">{detail.logs}</div>
            ) : (
              <div className="alert info">Aucun journal joint à ce rapport.</div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
