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
  // P2-A fix: a corrigendum that only attaches a revised specification
  // document changes nothing else on the notice. Without this field, such an
  // amendment was reported as `changed: false` / "unchanged" -- a real
  // content change silently missed by the only update-detection mechanism
  // this phase has.
  "sourceDocumentRefs",
];

/**
 * DOCUMENTED COMPARISON RULE for `sourceDocumentRefs`:
 *
 * Compared as an unordered SET of unique values, not as an ordered list.
 * Rationale: a portal re-serving the same attachments in a different order
 * (common when a listing page is regenerated) is not a substantive change to
 * the notice, and flagging it would produce update churn with no reviewer
 * value. Adding, removing, or replacing a reference IS a change.
 *
 * Consequences, stated explicitly so the tradeoff is visible rather than
 * implicit:
 *   - Reorder only            -> NOT a change.
 *   - Duplicate added/removed -> NOT a change (compared as unique values).
 *   - Any new/removed URL     -> IS a change.
 *   - [] vs []                -> NOT a change (both "no documents known").
 *
 * All other fields use strict `!==` identity comparison.
 */
function documentRefsDiffer(a: unknown, b: unknown): boolean {
  const toSet = (v: unknown): Set<string> =>
    new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const setA = toSet(a);
  const setB = toSet(b);
  if (setA.size !== setB.size) return true;
  for (const value of setA) {
    if (!setB.has(value)) return true;
  }
  return false;
}

function fieldsDiffer(field: keyof NormalizedTenderRecord, a: unknown, b: unknown): boolean {
  if (field === "sourceDocumentRefs") return documentRefsDiffer(a, b);
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
    if (fieldsDiffer(field, existing[field], incoming[field])) {
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
