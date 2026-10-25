/**
 * Authoritative source-approval policy for tender ingestion. FAIL-CLOSED.
 *
 * SECURITY DESIGN (closes the P0 bypass found in independent review of PR #15,
 * where both of these were empirically reproduced against the running code):
 *
 *   1. The approved-id collection is module-private and never exported. No
 *      caller can obtain a reference to it, so no caller can mutate it. The
 *      previous design exported a `ReadonlySet<string>` -- a compile-time-only
 *      guarantee whose underlying JS `Set` accepted `.add()` at runtime and
 *      permanently corrupted the production default for the life of the
 *      process.
 *
 *   2. The production entry point takes NO policy parameter. The previous
 *      design accepted `IngestOptions.approvedSourceIds`, which any caller
 *      could supply to authorize any source. Injection is now structurally
 *      impossible through the request path: there is no argument to pass.
 *
 * Test injection is available ONLY via `__createApprovalPolicyForTests()`,
 * which (a) is a separate module-level export that no request routes through,
 * and (b) refuses to run when NODE_ENV === "production" as defense in depth.
 */

/**
 * THE authoritative list. Deliberately EMPTY: no procurement portal has
 * passed documented legal / terms-of-service / operational review. See
 * docs/audits/PROCUREMENT_PORTAL_ACCESS_REGISTER.md -- every portal examined
 * so far (CPPP, GeM, Maharashtra e-Tenders) is classified UNVERIFIED, and a
 * portal must reach APPROVED there, with a cited clause and date, before its
 * id may be added here.
 *
 * Frozen so an accidental in-module push is also rejected, not just an
 * external one. Not exported under any circumstances.
 */
const AUTHORITATIVE_APPROVED_SOURCE_IDS: readonly string[] = Object.freeze([]);

/** A policy is just a decision function -- no collection reference escapes. */
export interface SourceApprovalPolicy {
  isApproved(sourceId: unknown): boolean;
  /** Human-readable identification for audit/error messages. Never the raw list. */
  readonly description: string;
}

/**
 * Validates the shape of a source id before any approval decision. A
 * non-string, empty, or whitespace-only id is malformed and is rejected
 * outright -- never normalized into something that might accidentally match.
 */
function isWellFormedSourceId(sourceId: unknown): sourceId is string {
  return typeof sourceId === "string" && sourceId.trim().length > 0 && sourceId.trim() === sourceId;
}

function buildPolicy(approvedIds: readonly string[], description: string): SourceApprovalPolicy {
  // Defensive copy taken at construction: even if the caller later mutates
  // the array it passed in, this policy's decisions do not change.
  const snapshot: readonly string[] = Object.freeze([...approvedIds]);
  return Object.freeze({
    description,
    isApproved(sourceId: unknown): boolean {
      if (!isWellFormedSourceId(sourceId)) return false;
      // Exact match only. No case-folding or trimming at match time -- a
      // malformed id was already rejected above, so a "near match" here
      // would only ever be a genuinely different id.
      return snapshot.includes(sourceId);
    },
  });
}

/** The single policy every production code path uses. */
export const PRODUCTION_SOURCE_APPROVAL_POLICY: SourceApprovalPolicy = buildPolicy(
  AUTHORITATIVE_APPROVED_SOURCE_IDS,
  "production (authoritative, empty until a portal passes documented review)",
);

/**
 * Read-only diagnostic view. Returns a fresh array each call, so a caller
 * mutating the result cannot affect any approval decision. Intended for an
 * operator diagnostic or a test assertion, never as an authorization input.
 */
export function listApprovedSourceIdsForDiagnostics(): string[] {
  return [...AUTHORITATIVE_APPROVED_SOURCE_IDS];
}

/**
 * TEST-ONLY policy factory.
 *
 * Not reachable from any request path: the production ingestion entry point
 * accepts no policy argument, so nothing a caller can send over HTTP, put in
 * a job payload, or pass through `IngestOptions` selects this. Guarded
 * against NODE_ENV === "production" as a second, independent barrier.
 */
export function __createApprovalPolicyForTests(approvedIds: readonly string[]): SourceApprovalPolicy {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "__createApprovalPolicyForTests must never be used in production -- the authoritative policy is PRODUCTION_SOURCE_APPROVAL_POLICY.",
    );
  }
  return buildPolicy(approvedIds, `test-only (${approvedIds.length} fixture id(s))`);
}
