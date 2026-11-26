import { all, run } from "./db.js";
import { now, uid } from "./util.js";

export interface Actor {
  id: string | null;
  label: string;
  ip?: string;
}

export function audit(actor: Actor, action: string, target: string | null = null, metadata?: unknown): void {
  run(
    "INSERT INTO audit_log (id, actor_id, actor, action, target, metadata, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    uid("aud"),
    actor.id,
    actor.label,
    action,
    target,
    metadata === undefined ? null : JSON.stringify(metadata),
    actor.ip ?? null,
    now(),
  );
}

export function recentAudit(limit = 40): Array<{
  id: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: string | null;
  ip: string | null;
  createdAt: string;
}> {
  return all<{
    id: string;
    actor: string;
    action: string;
    target: string | null;
    metadata: string | null;
    ip: string | null;
    createdAt: string;
  }>(`SELECT id, actor, action, target, metadata, ip, created_at as createdAt FROM audit_log ORDER BY created_at DESC LIMIT ?`, limit);
}
