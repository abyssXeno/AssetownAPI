import { useEffect, useRef, useState } from "react";
import type { Announcement, UserProfile } from "@assetown/shared";
import { Logo } from "./Logo";
import { bridge, isDesktop } from "../lib/bridge";
import { relativeTime } from "../lib/format";

interface TitleBarProps {
  user: UserProfile | null;
  t: (key: string) => string;
  notifications: Announcement[];
  onOpenNews: () => void;
}

export function TitleBar({ user, t, notifications, onOpenNews }: TitleBarProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const unread = notifications.filter((item) => Date.now() - new Date(item.publishedAt).getTime() < 86400000 * 3).length;

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="titlebar">
      <div className="brand">
        <Logo size={22} className="brand-logo" />
        Assetown
      </div>

      <div className="spacer" />

      {user && (
        <div className="status-pill">
          <span className="dot online" />
          {user.username}
        </div>
      )}

      <div ref={ref} style={{ position: "relative" }}>
        <button
          className="win-btn"
          title={t("app.notifications")}
          onClick={() => setOpen((value) => !value)}
          aria-label={t("app.notifications")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" />
          </svg>
          {unread > 0 && (
            <span
              style={{
                position: "absolute",
                top: 4,
                right: 6,
                width: 7,
                height: 7,
                borderRadius: 99,
                background: "var(--accent)",
                boxShadow: "0 0 0 2px #07070d",
              }}
            />
          )}
        </button>
        {open && (
          <div className="notif-pop">
            {notifications.length === 0 ? (
              <div className="notif-item muted">{t("app.noNotifications")}</div>
            ) : (
              notifications.slice(0, 8).map((item) => (
                <div
                  key={item.id}
                  className="notif-item"
                  onClick={() => {
                    setOpen(false);
                    onOpenNews();
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="t">{item.title}</div>
                  <div className="d">{item.body}</div>
                  <div className="small muted" style={{ marginTop: 4, fontSize: 10.5 }}>
                    {relativeTime(item.publishedAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {isDesktop && (
        <div className="win-controls">
          <button className="win-btn" onClick={() => void bridge.app.minimize()} aria-label={t("app.minimize")}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4">
              <path d="M2 6h8" />
            </svg>
          </button>
          <button className="win-btn close" onClick={() => void bridge.app.close()} aria-label={t("app.quit")}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.4">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
