import { useMemo, useState } from "react";
import type { Announcement } from "@assetown/shared";
import { bridge } from "../lib/bridge";
import { formatDateTime, relativeTime } from "../lib/format";
import type { Lang } from "../lib/i18n";

interface NewsPageProps {
  news: Announcement[];
  t: (key: string) => string;
  lang: Lang;
}

const FILTERS = ["all", "news", "event", "maintenance", "update"] as const;

export function NewsPage({ news, t, lang }: NewsPageProps) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const items = useMemo(() => {
    return news
      .filter((item) => filter === "all" || item.type === filter)
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
      });
  }, [news, filter]);

  const label = (type: string) =>
    type === "event"
      ? t("common.event")
      : type === "maintenance"
        ? t("common.maintenance")
        : type === "update"
          ? t("common.update")
          : t("common.news");

  return (
    <div style={{ animation: "fadeUp .3s ease" }}>
      <div className="page-head">
        <div>
          <h1>{t("nav.news")}</h1>
          <p>{lang === "fr" ? "Toutes les annonces, événements et informations du serveur Assetown." : "All announcements, events and information from the Assetown server."}</p>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 8, marginBottom: 18 }}>
        {FILTERS.map((item) => (
          <button
            key={item}
            className={`btn small ${filter === item ? "primary" : "ghost"}`}
            onClick={() => setFilter(item)}
          >
            {item === "all" ? (lang === "fr" ? "Tout" : "All") : label(item)}
          </button>
        ))}
      </div>

      <div className="stack" style={{ gap: 12 }}>
        {items.length === 0 && <div className="empty-state">{t("home.noNews")}</div>}
        {items.map((item) => (
          <article key={item.id} className="card" style={{ display: "flex", gap: 18, padding: 18 }}>
            {item.imageUrl && (
              <img
                src={item.imageUrl}
                alt=""
                style={{ width: 190, height: 130, objectFit: "cover", borderRadius: 12, border: "1px solid var(--line)", flexShrink: 0 }}
              />
            )}
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="row wrap" style={{ gap: 8 }}>
                <span className="tag">{label(item.type)}</span>
                {item.pinned && <span className="tag" style={{ color: "#ffc266" }}>★ {t("common.pinned")}</span>}
                <span className="small muted">{relativeTime(item.publishedAt, lang)}</span>
                {item.eventAt && (
                  <span className="tag mono" style={{ color: "#cbbcff" }}>
                    {formatDateTime(item.eventAt, lang)}
                  </span>
                )}
              </div>
              <h3 style={{ margin: 0, fontSize: 16 }}>{item.title}</h3>
              <p style={{ margin: 0, color: "var(--text-soft)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {item.body}
              </p>
              {item.linkUrl && (
                <button
                  className="btn small"
                  style={{ alignSelf: "flex-start", marginTop: 4 }}
                  onClick={() => void bridge.app.openExternal(item.linkUrl!)}
                >
                  {item.linkLabel || t("common.open")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
