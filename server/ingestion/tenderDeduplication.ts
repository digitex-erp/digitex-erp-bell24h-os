/**
 * Idempotent re-ingestion comparison. Reuses the project's existing
 * idempotency philosophy (QueueManager's idempotencyKey -- "the second call
 * returns the existing row, not a new one") applied to tender records:
 * computeDedupKey() (tenderValidation.ts) is the idempotency key equivalent;
 * this module decides what happens on a SECOND sighting of the same key.
 *
 * Nothing here writes to a database. This phase is deterministic, in-memory
 * logic only -- a future persistent store would call compareForReingestion()
 * before deciding whether to write anything.
 */
import type { NormalizedTenderRecord } from "./TenderTypes.js";

export interface ReingestionComparison {
  /** True only when something a consumer would care about actually differs. */
  changed: boolean;
  changedFields: string[];
  /** The application status the stored record should move to. Never silently reuses the incoming record's own guess. */
  nextApplicationStatus: NormalizedTenderRecord["applicationStatus"];
  /** True when sourceStatus moved to closed/cancelled/withdrawn and that is new information (wasn't already true before). */
  statusChangedToTerminal: boolean;
}

const COMPARABLE_FIELDS: (keyof NormalizedTenderRecord)[] = [
  "title",
  "description",
  "procuringAuthority",
  "department",
  "category",
  "publicationDate",
  "submissionDeadline",
  "submissionDeadlineTimezone",
  "sourceStatus",
  "location",
  "currency",
  "estimatedValue",
  // Independent-review P2 fix: a corrigendum that only attaches a new/changed
  // document (e.g. a revised specification PDF) with no other field changing
  // was previously invisible to this comparison -- fieldsDiffer() already
  // handles array comparison correctly (JSON.stringify), this field was
  // simply missing from the list.
  "sourceDocumentRefs",
];

function fieldsDiffer(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) !== JSON.stringify(b);
  return a !== b;
}

/**
 * Compares a freshly-normalized incoming record against the previously
 * stored record for the SAME dedup key (same `id`). Callers must only call
 * this once they've already matched on `id` -- this function does not
 * itself decide whether two records are "the same notice."
 */
export function compareForReingestion(
  existing: NormalizedTenderRecord,
  incoming: NormalizedTenderRecord,
): ReingestionComparison {
  if (existing.id !== incoming.id) {
    throw new Error("compareForReingestion: existing and incoming records have different dedup keys -- caller must match on id first.");
  }

  const changedFields: string[] = [];
  for (const field of COMPARABLE_FIELDS) {
    if (fieldsDiffer(existing[field], incoming[field])) {
      changedFields.push(field as string);
    }
  }

  // rawProvenanceRef changing but no comparable field changing means the source
  // re-served byte-different content with no meaningful difference (e.g.
  // whitespace/formatting) -- worth recording as a re-fetch, not worth
  // treating as a content change.
  const changed = changedFields.length > 0;

  const wasAlreadyTerminal = existing.sourceStatus === "closed" || existing.sourceStatus === "cancelled" || existing.sourceStatus === "withdrawn";
  const isNowTerminal = incoming.sourceStatus === "closed" || incoming.sourceStatus === "cancelled" || incoming.sourceStatus === "withdrawn";
  const statusChangedToTerminal = isNowTerminal && !wasAlreadyTerminal;

  let nextApplicationStatus: NormalizedTenderRecord["applicationStatus"];
  if (incoming.manualReviewRequired) {
    nextApplicationStatus = "validation_failed";
  } else if (!changed) {
    nextApplicationStatus = "unchanged";
  } else {
    nextApplicationStatus = "updated";
  }

  return { changed, changedFields, nextApplicationStatus, statusChangedToTerminal };
}

/**
 * Decides whether two DIFFERENT dedup keys might actually be the same
 * notice under a weak (title+date) key collision. This never auto-merges --
 * it only flags the pair for manual review, per this phase's explicit
 * instruction not to merge solely on title similarity.
 */
export function flagPossibleDuplicateForReview(a: NormalizedTenderRecord, b: NormalizedTenderRecord): boolean {
  if (a.sourceId !== b.sourceId) return false;
  if (a.sourceNoticeId && b.sourceNoticeId) return false; // both have strong ids; not a candidate for this weak-key path
  const titleA = (a.title ?? "").trim().toLowerCase();
  const titleB = (b.title ?? "").trim().toLowerCase();
  if (!titleA || !titleB) return false;
  return titleA === titleB && a.publicationDate === b.publicationDate;
}
