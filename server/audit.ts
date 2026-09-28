/**
 * Structured audit event emission.
 *
 * SECURITY_BASELINE.md requires audit events to carry actor, organization, action,
 * target type/id, timestamp, outcome, request ID, and safe metadata.
 *
 * PERSISTENCE (Phase 2): every event is ALWAYS written to stdout first as single-line JSON (a log drain is a second
 * copy), and — when a sink is registered with setAuditSink() — also handed to the durable store
 * (server/lib/auditStore.ts -> public.audit_events). The sink is best-effort and can never block or fail the caller;
 * its failures are counted (getAuditSinkStats) rather than hidden. No sink is registered unless the server has a
 * DATABASE_URL, and the table exists only after add_audit_log.sql has been applied — until then the counter shows
 * failures instead of silently pretending events were persisted.
 *
 * Never place secrets, tokens, prompts, or raw user content in `metadata`.
 */

export type AuditOutcome = "success" | "failure" | "denied";

export interface AuditEvent {
  actor: string | null;
  organizationId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  requestId: string;
  metadata?: Record<string, unknown>;
}

export type AuditSink = (record: AuditEvent & { kind: "audit"; timestamp: string }) => Promise<void> | void;

let sink: AuditSink | null = null;

/** Registers (or clears, with null) the durable sink. Called once at server start-up. */
export function setAuditSink(next: AuditSink | null): void {
  sink = next;
}

export function emitAuditEvent(event: AuditEvent): void {
  const record = {
    kind: "audit" as const,
    timestamp: new Date().toISOString(),
    ...event,
  };

  // Single-line JSON so log drains can parse it without multiline handling.
  console.log(JSON.stringify(record));

  // Durable copy: fire-and-forget; a sink problem must never reach the caller.
  if (sink) {
    try {
      void Promise.resolve(sink(record)).catch(() => undefined);
    } catch {
      /* a synchronous sink failure is ignored for the same reason */
    }
  }
}

/** Correlation id for a single inbound request. */
export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
