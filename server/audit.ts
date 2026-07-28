/**
 * Structured audit event emission.
 *
 * SECURITY_BASELINE.md requires audit events to carry actor, organization, action,
 * target type/id, timestamp, outcome, request ID, and safe metadata.
 *
 * LIMITATION: events are currently emitted to stdout as structured JSON only.
 * Durable persistence (the `ai_request_logs` / audit tables) requires DATABASE_URL,
 * which is not configured in this environment. Rather than silently dropping
 * events, they are emitted where a log drain can collect them; durable write-through
 * is tracked follow-up work.
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

export function emitAuditEvent(event: AuditEvent): void {
  const record = {
    kind: "audit",
    timestamp: new Date().toISOString(),
    ...event,
  };

  // Single-line JSON so log drains can parse it without multiline handling.
  console.log(JSON.stringify(record));
}

/** Correlation id for a single inbound request. */
export function newRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
