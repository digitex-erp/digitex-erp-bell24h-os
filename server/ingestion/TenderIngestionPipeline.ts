/**
 * Orchestrates: SourceAdapter -> raw result -> validate/normalize -> dedup
 * comparison against a caller-supplied prior state -> a PersistableIngestionResult.
 *
 * MOCK-FIRST, NO PERSISTENCE: this module never writes to a database. The
 * "prior state" it compares against is passed in by the caller (a test, or
 * eventually a real persistence layer) -- this keeps the pipeline itself
 * testable with zero I/O, matching this phase's explicit "no production
 * migration, no live schedule" boundary.
 *
 * Reuses server/audit.ts's existing emitAuditEvent() for provenance logging,
 * rather than inventing a second logging mechanism -- consistent with every
 * other job handler in this codebase (MediaJobHandler, PublishingJobHandler).
 *
 * SECURITY (Phase G): organizationId is NEVER read from the source payload.
 * It is supplied by the caller from a trusted context only (mirrors
 * MediaJobHandler's already-proven "organization_id from the trusted queue
 * row, never the payload" pattern, independently verified earlier this
 * engagement). Tender content itself is treated as untrusted external
 * input throughout -- see the explicit non-goals below.
 */
import { emitAuditEvent } from "../audit.js";
import type { NormalizedTenderRecord, SourceAdapter, SourceRetrievalResult } from "./TenderTypes.js";
import { normalizeTenderRecord } from "./tenderValidation.js";
import { compareForReingestion, type ReingestionComparison } from "./tenderDeduplication.js";
import {
  PRODUCTION_SOURCE_APPROVAL_POLICY,
  __createApprovalPolicyForTests,
  type SourceApprovalPolicy,
} from "./sourceApprovalPolicy.js";

export class UnapprovedSourceError extends Error {
  constructor(sourceId: unknown) {
    const shown = typeof sourceId === "string" ? sourceId : `<${typeof sourceId}>`;
    super(
      `Source "${shown}" is not approved -- refusing to ingest. ` +
        `The approved-source policy is authoritative and empty by default; see docs/audits/PROCUREMENT_PORTAL_ACCESS_REGISTER.md.`,
    );
    this.name = "UnapprovedSourceError";
  }
}

export interface PersistableIngestionResult {
  record: NormalizedTenderRecord;
  /** "insert" when no prior record existed for this dedup key; "update"/"noop" otherwise. */
  action: "insert" | "update" | "noop";
  comparison: ReingestionComparison | null;
}

export interface IngestOptions {
  /** Trusted context for audit logging only -- never derived from source content. */
  requestId: string;
  /** Organization the ingestion job is running under, from a trusted internal context (e.g. the job row), never from the source payload. */
  organizationId: string | null;
  /** Keyed by dedup key -- the caller's current known state, if any. This pipeline does not read a database itself. */
  priorRecords?: Map<string, NormalizedTenderRecord>;
  // NOTE: there is deliberately NO approval-policy field here. A caller must
  // not be able to authorize its own source. See sourceApprovalPolicy.ts's
  // header for why (this closed an empirically-reproduced P0 bypass).
}

/**
 * Runs one adapter's fetchPage() and returns normalized, deduplication-aware
 * results. Never throws on a per-record problem -- a record that fails
 * validation is returned with applicationStatus="validation_failed" and
 * manualReviewRequired=true, not dropped and not silently promoted.
 *
 * A retrieval-level failure (the adapter itself rejects, e.g. a network
 * error in a real future adapter) DOES propagate -- that is a job-level
 * failure the caller's retry/backoff logic should handle, not a per-record
 * validation concern.
 */
function createIngestor(policy: SourceApprovalPolicy) {
  return async function ingest(
    adapter: SourceAdapter,
    options: IngestOptions,
    cursor?: string | null,
  ): Promise<PersistableIngestionResult[]> {
    // Approval is checked BEFORE adapter.fetchPage() -- a rejected source is
    // never fetched, so an unapproved portal is never contacted even once.
    // `adapter?.sourceId` rather than `adapter.sourceId` so a malformed
    // adapter is rejected by the policy (which rejects non-strings) instead
    // of throwing a TypeError here.
    const sourceId = (adapter as SourceAdapter | undefined)?.sourceId;
    if (!policy.isApproved(sourceId)) {
      throw new UnapprovedSourceError(sourceId);
    }

    return runIngestion(adapter, options, cursor);
  };
}

async function runIngestion(
  adapter: SourceAdapter,
  options: IngestOptions,
  cursor?: string | null,
): Promise<PersistableIngestionResult[]> {
  const rawResults: SourceRetrievalResult[] = await adapter.fetchPage(cursor ?? null);
  const priorRecords = options.priorRecords ?? new Map<string, NormalizedTenderRecord>();
  const results: PersistableIngestionResult[] = [];

  for (const raw of rawResults) {
    const normalized = normalizeTenderRecord(raw);
    const prior = priorRecords.get(normalized.id);

    let action: PersistableIngestionResult["action"];
    let comparison: ReingestionComparison | null = null;

    if (!prior) {
      action = "insert";
    } else {
      comparison = compareForReingestion(prior, normalized);
      action = comparison.changed ? "update" : "noop";
      // Idempotent re-ingestion: the SAME notice re-fetched with no real change
      // produces "noop", never a second insert -- mirrors QueueManager's
      // idempotencyKey guarantee ("the second call returns the existing row").
      normalized.applicationStatus = comparison.nextApplicationStatus;
    }

    emitAuditEvent({
      actor: "service:tender-ingestion",
      organizationId: options.organizationId,
      action: `ingestion.tender.${action}`,
      targetType: "tender_record",
      targetId: normalized.id,
      outcome: normalized.manualReviewRequired ? "failure" : "success",
      requestId: options.requestId,
      metadata: {
        sourceId: normalized.sourceId,
        sourceNoticeId: normalized.sourceNoticeId,
        warningCount: normalized.validationWarnings.length,
        changedFields: comparison?.changedFields ?? [],
        statusChangedToTerminal: comparison?.statusChangedToTerminal ?? false,
      },
    });

    results.push({ record: normalized, action, comparison });
  }

  return results;
}

/**
 * THE production ingestion entry point.
 *
 * Its signature accepts no approval policy, by design: there is no argument
 * through which a request, job payload, or caller-supplied option object
 * could authorize a source. Approval comes solely from
 * PRODUCTION_SOURCE_APPROVAL_POLICY, which is built from a module-private,
 * frozen, never-exported list (see sourceApprovalPolicy.ts).
 */
export const ingestFromSource = createIngestor(PRODUCTION_SOURCE_APPROVAL_POLICY);

/**
 * TEST-ONLY ingestor factory. Lets the test suite exercise the full pipeline
 * against a fixture source without adding that fixture to the authoritative
 * production policy.
 *
 * Not reachable from any request path -- `ingestFromSource` above is what a
 * request calls, and it has no policy parameter. The underlying
 * `__createApprovalPolicyForTests` additionally refuses to run when
 * NODE_ENV === "production".
 */
export function __createIngestorForTests(approvedSourceIds: readonly string[]) {
  return createIngestor(__createApprovalPolicyForTests(approvedSourceIds));
}

/**
 * EXPLICIT NON-GOALS, enforced by what this function does NOT do:
 * - Never calls any AI provider or extraction service.
 * - Never constructs or returns an RFQ, Quote, Deal, or any VyaparSethu
 *   object -- its output is PersistableIngestionResult, a Bell24h-OS-local
 *   type, full stop. Promotion to a marketplace RFQ is a separate, explicit,
 *   human/business-reviewed workflow this module has no path to trigger.
 * - Never executes or interprets any string found in `rawPayload` as an
 *   instruction -- every field read out of it (tenderValidation.ts) is
 *   type-checked and copied as inert data, never passed to a template
 *   engine, shell, or LLM prompt in this phase.
 */
export function assertNeverPromotesToRfq(): void {
  // Intentionally a no-op marker function, referenced by
  // TenderIngestionPipeline.test.ts to make this guarantee explicit and
  // grep-able rather than only living in a comment.
}
