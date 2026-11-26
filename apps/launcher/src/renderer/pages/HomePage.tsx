import type { Announcement, ChannelSlug, ChannelSummary, PublicConfig } from "@assetown/shared";
import type { GameStatus } from "../../shared/types";
import { Logo } from "../components/Logo";
import { bridge } from "../lib/bridge";
import { channelGradient, formatDate, loaderLabel, relativeTime } from "../lib/format";
import type { Lang } from "../lib/i18n";

interface HomePageProps {
  config: PublicConfig;
  news: Announcement[];
  selected: ChannelSlug;
  onSelect: (channel: ChannelSlug) => void;
  onPlay: (channel: ChannelSlug) => void;
  onOpenNews: () => void;
  busy: boolean;
  game: GameStatus;
  lang: Lang;
  t: (key: string) => string;
}

const TYPE_KEY: Record<string, string> = {
  news: "common.news",
  event: "common.event",
  maintenance: "common.maintenance",
  update: "common.update",
};

export function HomePage({ config, news, selected, onSelect, onPlay, onOpenNews, busy, game, lang, t }: HomePageProps) {
  const current = config.channels.find((channel) => channel.slug === selected) ?? config.channels[0];
  const totalPlayers = config.channels.reduce((sum, channel) => sum + (channel.status.players?.online ?? 0), 0);
  const running = game.phase === "running";
  const events = news
    .filter((item) => item.type === "event" && item.eventAt && new Date(item.eventAt).getTime() > Date.now())
    .sort((a, b) => new Date(a.eventAt!).getTime() - new Date(b.eventAt!).getTime())
    .slice(0, 3);

  const playLabel = running
    ? t("home.stopGame")
    : game.phase === "preparing"
      ? t("home.launching")
      : t("home.play");

  return (
    <div style={{ animation: "fadeUp .35s ease" }}>
      {config.maintenance.enabled && (
        <div className="banner-note">
          <span className="dot busy" />
          <div>
            <strong>{t("home.maintenance")}</strong>
            {config.maintenance.message ? ` — ${config.maintenance.message}` : ""}
          </div>
        </div>
      )}

      <section
        className="hero"
        style={
          config.bannerUrl
            ? {
                backgroundImage: `linear-gradient(100deg, rgba(8,8,14,.96) 8%, rgba(8,8,14,.62) 52%, rgba(8,8,14,.25)), url("${config.bannerUrl}")`,
              }
            : undefined
        }
      >
        <div className="hero-content">
          <div className="row" style={{ gap: 12, marginBottom: 4 }}>
            <Logo size={34} />
            <span className="hero-badge">
              <span className="dot online" />
              {totalPlayers} {t("home.players")}
            </span>
          </div>
          <h2>{config.welcomeTitle || `${config.brandName} — ${current?.name ?? ""}`}</h2>
          <p>{config.welcomeText}</p>
          <div className="hero-actions">
            {running ? (
              <button className="btn play" style={{ background: "linear-gradient(135deg,#ff6b81,#e0435c)" }} onClick={() => void bridge.game.kill()}>
                {playLabel}
              </button>
            ) : (
              <button className="btn play" onClick={() => onPlay(selected)} disabled={busy}>
                {busy && <span className="spinner" />}
                {playLabel}
              </button>
            )}
            {config.discordUrl && (
              <button className="btn ghost" onClick={() => void bridge.app.openExternal(config.discordUrl!)}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M19.6 5.4A16.5 16.5 0 0 0 15.5 4l-.3.6a12 12 0 0 1 3.4 1.5 13.7 13.7 0 0 0-11.2 0A12 12 0 0 1 10.8 4.6L10.5 4a16.5 16.5 0 0 0-4.1 1.4C3.9 9.2 3.2 12.9 3.5 16.6a16.6 16.6 0 0 0 5 2.5l.7-1.1a10.6 10.6 0 0 1-1.7-.8l.4-.3a11.8 11.8 0 0 0 10.3 0l.4.3c-.5.3-1.1.6-1.7.8l.7 1.1a16.6 16.6 0 0 0 5-2.5c.4-4.3-.6-8-2.9-11.2ZM8.9 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8c0 1-.7 1.8-1.6 1.8Zm6.2 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.7.8 1.6 1.8c0 1-.7 1.8-1.6 1.8Z" />
                </svg>
                {t("home.discord")}
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="section-head">
        <h3>
          {t("home.selectVersion")}
          <span className="count">{config.channels.filter((channel) => channel.enabled).length}/3</span>
        </h3>
        <span className="small muted">
          {current?.activeBuild ? `${t("home.latestBuild")} : ${current.activeBuild.label}` : t("home.installNeeded")}
        </span>
      </div>

      <div className="version-grid">
        {config.channels.map((channel) => (
          <VersionCard
            key={channel.slug}
            channel={channel}
            selected={channel.slug === selected}
            onSelect={() => channel.enabled && onSelect(channel.slug)}
            t={t}
          />
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 22 }}>
        <div>
          <div className="section-head" style={{ marginTop: 6 }}>
            <h3>{t("home.news")}</h3>
            <button className="btn small ghost" onClick={onOpenNews}>
              {t("common.open")}
            </button>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {news.length === 0 && <div className="empty-state">{t("home.noNews")}</div>}
            {news.slice(0, 5).map((item) => (
              <article key={item.id} className="news-item" onClick={onOpenNews} style={{ cursor: "pointer" }}>
                {item.imageUrl ? (
                  <img className="news-thumb" src={item.imageUrl} alt="" />
                ) : (
                  <div className="news-thumb">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <path d="M4 5h16v14H4z" />
                      <path d="M7 9h10M7 13h7" strokeLinecap="round" />
                    </svg>
                  </div>
                )}
                <div style={{ minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="tag">{t(TYPE_KEY[item.type] ?? "common.news")}</span>
                    {item.pinned && <span className="tag" style={{ color: "#ffc266" }}>★ {t("common.pinned")}</span>}
                    <span className="small muted">{relativeTime(item.publishedAt, lang)}</span>
                  </div>
                  <h4>{item.title}</h4>
                  <p>{item.body}</p>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{t("home.serverStatus")}</h3>
              <span className={`dot ${current?.status.online ? "online" : "offline"}`} />
            </div>
            {config.channels.map((channel) => (
              <div className="kv" key={channel.slug}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={`dot ${!channel.enabled ? "" : channel.status.online ? "online" : "offline"}`} />
                  {channel.name}
                </span>
                <span className="mono small">
                  {channel.enabled
                    ? channel.status.online
                      ? `${channel.status.players?.online ?? 0}/${channel.status.players?.max ?? 0}`
                      : t("home.offline")
                    : t("home.disabled")}
                </span>
              </div>
            ))}
            <div className="kv" style={{ borderTop: "1px dashed rgba(255,255,255,.06)" }}>
              <span>Latence</span>
              <span className="mono small">
                {current?.status.online && current.status.latency !== null ? `${current.status.latency} ms` : "—"}
              </span>
            </div>
          </div>

          {events.length > 0 && (
            <div className="card">
              <h3 style={{ marginBottom: 10 }}>{t("home.events")}</h3>
              <div className="stack" style={{ gap: 10 }}>
                {events.map((event) => (
                  <div key={event.id} className="row between" style={{ alignItems: "flex-start", gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{event.title}</div>
                      <div className="small muted" style={{ marginTop: 2 }}>
                        {formatDate(event.eventAt, lang)}
                      </div>
                    </div>
                    <span className="tag">{t("common.event")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {config.discordUrl && (
            <div className="card" style={{ background: "linear-gradient(135deg, rgba(88,101,242,.18), rgba(255,255,255,.02))", borderColor: "rgba(88,101,242,.3)" }}>
              <h3>{config.brandName} Discord</h3>
              <p className="hint" style={{ marginBottom: 12 }}>
                {t("home.discordText")}
              </p>
              <button className="btn small" onClick={() => void bridge.app.openExternal(config.discordUrl!)}>
                {t("home.discord")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function VersionCard({
  channel,
  selected,
  onSelect,
  t,
}: {
  channel: ChannelSummary;
  selected: boolean;
  onSelect: () => void;
  t: (key: string) => string;
}) {
  const build = channel.activeBuild;
  return (
    <button
      className={`version-card ${selected ? "selected" : ""} ${channel.enabled ? "" : "disabled"}`}
      onClick={onSelect}
      style={{ ["--accent-grad" as string]: channelGradient(channel.slug, channel.accent) }}
    >
      <div className="version-top">
        <div>
          <div className="version-name">{channel.name}</div>
          <div className="version-meta">
            {build ? (
              <>
                <span className="tag mono">MC {build.minecraftVersion}</span>
                <span className="tag">{loaderLabel(build.loader)}</span>
              </>
            ) : (
              <span className="tag">Build à venir</span>
            )}
          </div>
        </div>
        <div className="check">{selected && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}</div>
      </div>
      <div className="version-desc">{channel.description}</div>
      <div className="version-footer">
        <span className="row" style={{ gap: 6 }}>
          <span className={`dot ${channel.enabled ? (channel.status.online ? "online" : "offline") : ""}`} />
          {!channel.enabled
            ? t("home.disabled")
            : channel.status.online
              ? `${channel.status.players?.online ?? 0}/${channel.status.players?.max ?? 0} ${t("home.players")}`
              : t("home.offline")}
        </span>
        <span className="mono" style={{ fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase" }}>
          {selected ? t("home.selected") : t("home.select")}
        </span>
      </div>
    </button>
  );
}
