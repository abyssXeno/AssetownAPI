import type { SyncProgress } from "../../shared/types";
import { formatBytes, formatEta, formatSpeed } from "../lib/format";

interface ProgressPanelProps {
  progress: SyncProgress;
  lang: "fr" | "en";
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

export function ProgressPanel({ progress, lang, onPause, onResume, onCancel, t }: ProgressPanelProps) {
  const paused = progress.phase === "paused";
  const showActions = ["preparing", "checking", "downloading", "verifying", "applying", "paused"].includes(progress.phase);
  const label =
    progress.phase === "paused"
      ? t("sync.pause")
      : progress.phase === "downloading"
        ? t("sync.downloading")
        : progress.phase === "checking"
          ? t("sync.verifying")
          : progress.phase === "applying"
            ? t("sync.done")
            : progress.phase === "completed"
              ? t("sync.done")
              : t("sync.preparing");

  return (
    <div className="progress-panel">
      <div className="progress-head">
        <div className="row" style={{ gap: 10 }}>
          {progress.phase !== "completed" && <span className="spinner" />}
          <strong>
            {label}
            {progress.phase === "downloading" || progress.phase === "paused"
              ? ` — ${progress.percent.toFixed(0)} %`
              : ""}
          </strong>
        </div>
        <span className="mono small muted">{progress.percent.toFixed(0)}%</span>
      </div>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${Math.max(2, Math.min(100, progress.percent))}%` }} />
      </div>

      <div className="progress-meta">
        <span>{progress.message}</span>
        <span className="path">{progress.currentFile}</span>
      </div>

      <div className="progress-meta">
        <span>
          {progress.filesTotal > 0 ? `${progress.filesDone}/${progress.filesTotal} ${t("sync.files")}` : ""}
          {progress.bytesTotal > 0
            ? ` · ${formatBytes(progress.bytesDone)} / ${formatBytes(progress.bytesTotal)}`
            : ""}
        </span>
        <span>
          {progress.speedBps > 0 ? `${t("sync.speed")} ${formatSpeed(progress.speedBps)}` : ""}
          {progress.etaSeconds !== null && progress.speedBps > 0
            ? ` · ${formatEta(progress.etaSeconds, lang)} ${t("sync.remaining")}`
            : ""}
        </span>
      </div>

      {showActions && (
        <div className="progress-actions">
          {paused ? (
            <button className="btn small primary" onClick={onResume}>
              {t("sync.resume")}
            </button>
          ) : (
            <button className="btn small" onClick={onPause}>
              {t("sync.pause")}
            </button>
          )}
          <button className="btn small ghost" onClick={onCancel}>
            {t("sync.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}
