/**
 * Durable audit persistence (Phase 2, item 9) — the sink behind server/audit.ts and the query side for
 * GET /api/audit/events.
 *
 * Contract (read this before relying on it):
 *  - The sink is BEST-EFFORT and NEVER blocks or fails the request that produced the event. A database outage
 *    therefore loses durable rows, not the request — which is why every failure is COUNTED and exposed via
 *    getAuditSinkStats() (GET /api/audit/status) instead of being swallowed. stdout JSON is still emitted first, so
 *    a log drain remains a second copy.
 *  - Metadata is redacted here before it is stored: keys that look like secrets / tokens / prompts / bodies are
 *    replaced, long strings are truncated, depth and size are capped. The rule "never put secrets in metadata" stays
 *    the primary defence; this is the backstop.
 *  - Nothing here reads or writes any other table.
 */

import type pg from "pg";
import type { AuditEvent, AuditOutcome } from "../audit.js";

export interface AuditRecord extends AuditEvent {
  kind: "audit";
  timestamp: string;
}

const SENSITIVE_KEY = /(secret|token|password|passwd|authorization|api[-_]?key|apikey|credential|cookie|signature|private[-_]?key|prompt|body|html|otp)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;
const MAX_KEYS = 40;
const MAX_JSON_BYTES = 8 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[depth-limit]";
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => redactValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : redactValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Redacts and bounds audit metadata. Exported for tests. */
export function redactMetadata(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  const cleaned = redactValue(meta, 0) as Record<string, unknown>;
  const json = JSON.stringify(cleaned);
  if (json.length > MAX_JSON_BYTES) return { truncated: true, keys: Object.keys(cleaned).slice(0, MAX_KEYS) };
  return cleaned;
}

// ---- sink statistics ------------------------------------------------------------------------------------------

interface SinkStats {
  written: number;
  failed: number;
  lastFailureAt: string | null;
  lastFailure: string | null;
}
const stats: SinkStats = { written: 0, failed: 0, lastFailureAt: null, lastFailure: null };

export function getAuditSinkStats(): Readonly<SinkStats> {
  return { ...stats };
}
export function resetAuditSinkStats(): void {
  stats.written = 0;
  stats.failed = 0;
  stats.lastFailureAt = null;
  stats.lastFailure = null;
}

/** A sink for server/audit.ts: inserts the record; on any failure counts it and returns (never throws). */
export function createAuditSink(getPool: () => pg.Pool): (record: AuditRecord) => Promise<void> {
  return async (record) => {
    try {
      const org = record.organizationId && UUID_RE.test(record.organizationId) ? record.organizationId : null;
      await getPool().query(
        `INSERT INTO public.audit_events (occurred_at, actor, organization_id, action, target_type, target_id, outcome, request_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
        [
          record.timestamp,
          record.actor === null ? null : String(record.actor).slice(0, 200),
          org,
          String(record.action).slice(0, 200),
          String(record.targetType).slice(0, 100),
          String(record.targetId).slice(0, 300),
          record.outcome,
          String(record.requestId).slice(0, 100),
          JSON.stringify(redactMetadata(record.metadata)),
        ],
      );
      stats.written++;
    } catch (err) {
      stats.failed++;
      stats.lastFailureAt = new Date().toISOString();
      stats.lastFailure = String((err as Error)?.message ?? err).slice(0, 200);
    }
  };
}

// ---- query ----------------------------------------------------------------------------------------------------

export interface AuditQuery {
  action?: string;
  outcome?: AuditOutcome;
  targetType?: string;
  targetId?: string;
  actor?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export class AuditQueryError extends Error {
  constructor(public readonly field: string, message: string) {
    super(`${field}: ${message}`);
  }
}

const OUTCOMES: AuditOutcome[] = ["success", "failure", "denied"];

function str(field: string, v: unknown, max = 200): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || v.length > max || /[\u0000-\u001F\u007F]/.test(v)) throw new AuditQueryError(field, `must be a string of at most ${max} characters without control characters`);
  return v;
}
function ts(field: string, v: unknown): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new AuditQueryError(field, "must be an ISO-8601 date");
  return new Date(v).toISOString();
}

export function parseAuditQuery(q: Record<string, unknown>): Required<Pick<AuditQuery, "limit" | "offset">> & AuditQuery {
  const outcome = str("outcome", q.outcome, 20);
  if (outcome !== undefined && !OUTCOMES.includes(outcome as AuditOutcome)) throw new AuditQueryError("outcome", `must be one of: ${OUTCOMES.join(", ")}`);
  const limitRaw = q.limit === undefined || q.limit === "" ? 50 : Number(q.limit);
  const offsetRaw = q.offset === undefined || q.offset === "" ? 0 : Number(q.offset);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 200) throw new AuditQueryError("limit", "must be an integer from 1 to 200");
  if (!Number.isInteger(offsetRaw) || offsetRaw < 0 || offsetRaw > 100000) throw new AuditQueryError("offset", "must be an integer from 0 to 100000");
  return {
    action: str("action", q.action),
    outcome: outcome as AuditOutcome | undefined,
    targetType: str("targetType", q.targetType, 100),
    targetId: str("targetId", q.targetId, 300),
    actor: str("actor", q.actor),
    since: ts("since", q.since),
    until: ts("until", q.until),
    limit: limitRaw,
    offset: offsetRaw,
  };
}

/** Organization-scoped read. `action` is a PREFIX match (e.g. "communication." ), with LIKE wildcards escaped. */
export async function queryAuditEvents(pool: pg.Pool, organizationId: string, q: ReturnType<typeof parseAuditQuery>) {
  const where: string[] = ["organization_id = $1"];
  const params: unknown[] = [organizationId];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (q.action) add("action LIKE ? ESCAPE '\\'", `${q.action.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  if (q.outcome) add("outcome = ?", q.outcome);
  if (q.targetType) add("target_type = ?", q.targetType);
  if (q.targetId) add("target_id = ?", q.targetId);
  if (q.actor) add("actor = ?", q.actor);
  if (q.since) add("occurred_at >= ?", q.since);
  if (q.until) add("occurred_at < ?", q.until);
  const total = await pool.query(`SELECT COUNT(*)::int AS n FROM public.audit_events WHERE ${where.join(" AND ")}`, params);
  params.push(q.limit, q.offset);
  const rows = await pool.query(
    `SELECT id, occurred_at, actor, action, target_type, target_id, outcome, request_id, metadata
       FROM public.audit_events WHERE ${where.join(" AND ")}
      ORDER BY occurred_at DESC, id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { events: rows.rows, total: total.rows[0].n as number, limit: q.limit, offset: q.offset };
}

export async function auditSummary(pool: pg.Pool, organizationId: string) {
  const r = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE occurred_at > NOW() - INTERVAL '24 hours')::int AS last_24h,
            COUNT(*) FILTER (WHERE outcome = 'denied' AND occurred_at > NOW() - INTERVAL '24 hours')::int AS denied_24h,
            COUNT(*) FILTER (WHERE outcome = 'failure' AND occurred_at > NOW() - INTERVAL '24 hours')::int AS failed_24h,
            MIN(occurred_at) AS oldest, MAX(occurred_at) AS newest
       FROM public.audit_events WHERE organization_id = $1`,
    [organizationId],
  );
  return r.rows[0] as { last_24h: number; denied_24h: number; failed_24h: number; oldest: string | null; newest: string | null };
}
