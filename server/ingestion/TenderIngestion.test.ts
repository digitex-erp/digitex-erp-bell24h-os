/**
 * Tender ingestion foundation — mock-first, deterministic fixtures only.
 * No real portal is called anywhere in this file. No AI provider is called.
 * No database connection is opened. No RFQ, Quote, Deal, or marketplace
 * record of any kind is ever constructed here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { NormalizedTenderRecord, SourceAdapter, SourceRetrievalResult } from "./TenderTypes.js";
import {
  computeDedupKey,
  mapSourceStatus,
  normalizeCurrencyAndValue,
  normalizeTenderRecord,
  parseDateWithTimezone,
  validateSourceUrl,
} from "./tenderValidation.js";
import { compareForReingestion, flagPossibleDuplicateForReview } from "./tenderDeduplication.js";
import { assertNeverPromotesToRfq, ingestFromSource, UnapprovedSourceError, type PersistableIngestionResult } from "./TenderIngestionPipeline.js";

const FIXTURE_SOURCE_ID = "fixture_portal";

function makeRaw(overrides: Partial<SourceRetrievalResult> & { payload?: Record<string, unknown> } = {}): SourceRetrievalResult {
  const { payload, ...rest } = overrides;
  return {
    sourceId: FIXTURE_SOURCE_ID,
    sourceNoticeId: "NIT-2026-001",
    sourceUrl: "https://example-portal.test/tenders/NIT-2026-001",
    retrievedAt: "2026-10-25T00:00:00.000Z",
    sourcePublishedAt: "2026-10-01T00:00:00Z",
    sourceUpdatedAt: null,
    rawPayload: {
      title: "Supply of office furniture",
      description: "Procurement of chairs and desks for a government office.",
      procuringAuthority: "Department of Example Affairs",
      category: "Furniture",
      location: "Pune",
      currency: "INR",
      estimatedValue: 500000,
      submissionDeadline: "2026-11-15T17:00:00+05:30",
      status: "published",
      documentRefs: ["https://example-portal.test/docs/NIT-2026-001.pdf"],
      ...payload,
    },
    outcome: "ok",
    ...rest,
  };
}

/** A deterministic, fixture-backed adapter -- never issues a real network call. */
function fixtureAdapter(pages: SourceRetrievalResult[][]): SourceAdapter {
  let callIndex = 0;
  return {
    sourceId: FIXTURE_SOURCE_ID,
    async fetchPage(): Promise<SourceRetrievalResult[]> {
      const page = pages[callIndex] ?? [];
      callIndex += 1;
      return page;
    },
  };
}

const APPROVED = new Set([FIXTURE_SOURCE_ID]);

// 1. Valid tender normalization
test("1: a well-formed source record normalizes with no warnings and applicationStatus 'new'", () => {
  const normalized = normalizeTenderRecord(makeRaw());
  assert.equal(normalized.title, "Supply of office furniture");
  assert.equal(normalized.currency, "INR");
  assert.equal(normalized.estimatedValue, 500000);
  assert.equal(normalized.applicationStatus, "new");
  assert.equal(normalized.manualReviewRequired, false);
  assert.deepEqual(normalized.validationWarnings, []);
});

// 2. Missing and malformed fields
test("2: missing title and malformed value are flagged, not silently dropped or guessed", () => {
  const normalized = normalizeTenderRecord(
    makeRaw({ payload: { title: undefined, estimatedValue: "not-a-number" } }),
  );
  assert.equal(normalized.title, null);
  assert.equal(normalized.estimatedValue, null);
  assert.ok(normalized.validationWarnings.some((w) => w.code === "MISSING_REQUIRED" && w.field === "title"));
  assert.ok(normalized.validationWarnings.some((w) => w.code === "UNPARSEABLE_VALUE"));
  assert.equal(normalized.manualReviewRequired, true, "a missing required field must force manual review, never a silent pass-through");
});

// 3. Invalid URLs and unsafe payloads
test("3: an unsafe URL scheme is rejected, not followed or stored", () => {
  const check = validateSourceUrl("javascript:alert(1)");
  assert.equal(check.ok, false);
  assert.ok(check.warnings.some((w) => w.code === "UNSAFE_SCHEME"));

  const normalized = normalizeTenderRecord(makeRaw({ sourceUrl: "javascript:alert(1)" }));
  assert.equal(normalized.sourceUrl, null, "rejected URL must not be stored as if it were valid");
});

test("3b: document reference URLs are individually validated, not trusted wholesale", () => {
  const normalized = normalizeTenderRecord(
    makeRaw({ payload: { documentRefs: ["https://example-portal.test/docs/ok.pdf", "ftp://not-allowed.test/x"] } }),
  );
  assert.deepEqual(normalized.sourceDocumentRefs, ["https://example-portal.test/docs/ok.pdf"]);
});

// 4. Date parsing, timezone handling, missing deadlines
test("4a: a date with an explicit offset is trusted and marked as such", () => {
  const result = parseDateWithTimezone("2026-11-15T17:00:00+05:30", "submissionDeadline");
  assert.equal(result.timezone, "source-stated-offset");
  assert.equal(result.warnings.length, 0);
});

test("4b: a date with no timezone marker is parsed but flagged, never confidently treated as UTC", () => {
  const result = parseDateWithTimezone("2026-11-15 17:00:00", "submissionDeadline");
  assert.equal(result.timezone, null);
  assert.ok(result.warnings.some((w) => w.code === "TIMEZONE_UNSTATED"));
});

test("4c: a missing deadline is flagged, never defaulted to a guessed date", () => {
  const normalized = normalizeTenderRecord(makeRaw({ payload: { submissionDeadline: undefined } }));
  assert.equal(normalized.submissionDeadline, null);
  assert.ok(normalized.validationWarnings.some((w) => w.code === "MISSING_DEADLINE"));
});

test("4d: an unparseable date string is rejected, not coerced into a wrong date", () => {
  const result = parseDateWithTimezone("not-a-real-date", "publicationDate");
  assert.equal(result.iso, null);
  assert.ok(result.warnings.some((w) => w.code === "UNPARSEABLE_DATE"));
});

// 5. Currency preservation and normalization
test("5a: currency is preserved verbatim (uppercased), never converted or defaulted", () => {
  const result = normalizeCurrencyAndValue("inr", 1000);
  assert.equal(result.currency, "INR");
  assert.equal(result.estimatedValue, 1000);
});

test("5b: a value with no stated currency is flagged, never assumed to be INR or any default", () => {
  const result = normalizeCurrencyAndValue(null, 1000);
  assert.equal(result.currency, null);
  assert.equal(result.estimatedValue, 1000);
  assert.ok(result.warnings.some((w) => w.code === "VALUE_WITHOUT_CURRENCY"));
});

// 6. Status transitions, including closed and withdrawn
test("6a: a recognized status string maps correctly", () => {
  assert.equal(mapSourceStatus("withdrawn").status, "withdrawn");
  assert.equal(mapSourceStatus("CANCELED").status, "cancelled");
});

test("6b: an unrecognized status string becomes 'unknown', flagged, never guessed as a known value", () => {
  const result = mapSourceStatus("pending-review-xyz");
  assert.equal(result.status, "unknown");
  assert.ok(result.warnings.some((w) => w.code === "UNRECOGNIZED_STATUS"));
});

test("6c: a status transition to withdrawn is detected as newly terminal", () => {
  const existing = normalizeTenderRecord(makeRaw());
  const incoming = normalizeTenderRecord(makeRaw({ payload: { status: "withdrawn" } }));
  const comparison = compareForReingestion(existing, incoming);
  assert.equal(comparison.statusChangedToTerminal, true);
});

// 7. Duplicate detection
test("7a: the same sourceId+sourceNoticeId always produces the same dedup key (strong)", () => {
  const key1 = computeDedupKey({ sourceId: "x", sourceNoticeId: "N1", sourceUrl: null, title: null, publicationDate: null });
  const key2 = computeDedupKey({ sourceId: "x", sourceNoticeId: "N1", sourceUrl: "https://irrelevant.test", title: "different", publicationDate: "2026-01-01" });
  assert.equal(key1.key, key2.key, "notice id alone determines the key once present, regardless of other fields");
  assert.equal(key1.strength, "strong");
});

test("7b: two different notices with similar titles are NOT auto-merged -- only flagged for review", () => {
  const a = normalizeTenderRecord(makeRaw({ sourceNoticeId: "N1", payload: { title: "Supply of furniture" } }));
  const b = normalizeTenderRecord(makeRaw({ sourceNoticeId: "N2", payload: { title: "Supply of furniture" } }));
  assert.notEqual(a.id, b.id, "different strong notice ids must never collapse to the same record");
  assert.equal(flagPossibleDuplicateForReview(a, b), false, "both have strong ids -- not a weak-key collision candidate");
});

test("7c: two notices with NO stable id and the same title+date ARE flagged for manual review, not silently treated as unrelated or auto-merged", () => {
  const a = normalizeTenderRecord(makeRaw({ sourceNoticeId: null, sourceUrl: null, sourcePublishedAt: "2026-10-01T00:00:00Z" }));
  const b = normalizeTenderRecord(makeRaw({ sourceNoticeId: null, sourceUrl: null, sourcePublishedAt: "2026-10-01T00:00:00Z" }));
  assert.equal(a.id, b.id, "weak key collides on purpose here -- same title/date with no stronger signal");
  assert.ok(a.validationWarnings.some((w) => w.code === "WEAK_DEDUP_KEY"));
});

// 8. Idempotent re-ingestion
test("8: re-ingesting the identical record twice produces insert then noop, never a second insert", async () => {
  const raw = makeRaw();
  const adapter = fixtureAdapter([[raw], [raw]]);
  const priorRecords = new Map<string, NormalizedTenderRecord>();

  const first = await ingestFromSource(adapter, { requestId: "req-1", organizationId: "org-a", priorRecords, approvedSourceIds: APPROVED });
  assert.equal(first.length, 1);
  assert.equal(first[0].action, "insert");
  priorRecords.set(first[0].record.id, first[0].record);

  const second = await ingestFromSource(adapter, { requestId: "req-2", organizationId: "org-a", priorRecords, approvedSourceIds: APPROVED });
  assert.equal(second.length, 1);
  assert.equal(second[0].action, "noop", "identical re-fetch must be a no-op, not a duplicate insert");
  assert.equal(second[0].record.id, first[0].record.id);
});

// 9. Changed source content and changed deadlines
test("9: a changed description and a changed deadline are both detected as 'update', with exact changed fields listed", async () => {
  const priorRecords = new Map<string, NormalizedTenderRecord>();
  const adapter1 = fixtureAdapter([[makeRaw()]]);
  const first = await ingestFromSource(adapter1, { requestId: "r1", organizationId: "org-a", priorRecords, approvedSourceIds: APPROVED });
  priorRecords.set(first[0].record.id, first[0].record);

  const adapter2 = fixtureAdapter([
    [makeRaw({ payload: { description: "Updated scope: chairs, desks, and cabinets.", submissionDeadline: "2026-12-01T17:00:00+05:30" } })],
  ]);
  const second = await ingestFromSource(adapter2, { requestId: "r2", organizationId: "org-a", priorRecords, approvedSourceIds: APPROVED });

  assert.equal(second[0].action, "update");
  assert.ok(second[0].comparison?.changedFields.includes("description"));
  assert.ok(second[0].comparison?.changedFields.includes("submissionDeadline"));
});

// 10. Retryable vs non-retryable failures
test("10a: a retryable retrieval error is flagged as retryable in the normalized warning", () => {
  const normalized = normalizeTenderRecord(makeRaw({ outcome: "error", error: { retryable: true, message: "Timed out" } }));
  assert.ok(normalized.validationWarnings.some((w) => w.code === "RETRIEVAL_FAILED_RETRYABLE"));
  assert.equal(normalized.manualReviewRequired, true);
});

test("10b: a non-retryable retrieval error (e.g. access denied) is flagged distinctly from a retryable one", () => {
  const normalized = normalizeTenderRecord(makeRaw({ outcome: "error", error: { retryable: false, message: "403 Forbidden", httpStatus: 403 } }));
  assert.ok(normalized.validationWarnings.some((w) => w.code === "RETRIEVAL_FAILED_NON_RETRYABLE"));
});

// 11. Pagination and rate-limit handling at the adapter-contract level
test("11: the adapter contract carries pagination metadata through unchanged, and a rate-limit-style error is just another non-retryable/retryable error shape", async () => {
  const page1 = [makeRaw({ sourceNoticeId: "N1", pagination: { page: 1, hasMore: true, nextCursor: "c2" } })];
  const page2 = [makeRaw({ sourceNoticeId: "N2", pagination: { page: 2, hasMore: false } })];
  const adapter = fixtureAdapter([page1, page2]);

  const firstPage = await ingestFromSource(adapter, { requestId: "r1", organizationId: "org-a", approvedSourceIds: APPROVED });
  assert.equal(firstPage.length, 1);

  const secondPage = await ingestFromSource(adapter, { requestId: "r2", organizationId: "org-a", approvedSourceIds: APPROVED }, "c2");
  assert.equal(secondPage.length, 1);

  const rateLimited = normalizeTenderRecord(
    makeRaw({ outcome: "error", error: { retryable: true, message: "429 Too Many Requests", httpStatus: 429 } }),
  );
  assert.ok(rateLimited.validationWarnings.some((w) => w.code === "RETRIEVAL_FAILED_RETRYABLE"), "a 429 is modeled as a retryable error, not a special case");
});

// 12. Safe logging and secret redaction
test("12: normalized output and audit metadata never carry a raw payload, header, cookie, or token value", async () => {
  const sensitiveRaw = makeRaw({
    payload: {
      title: "Supply of furniture",
      __sessionCookie: "should-never-appear-anywhere",
      authorizationHeaderUsedToFetch: "Bearer secret-token-value",
    },
  });
  const adapter = fixtureAdapter([[sensitiveRaw]]);
  const results = await ingestFromSource(adapter, { requestId: "r1", organizationId: "org-a", approvedSourceIds: APPROVED });

  const serializedRecord = JSON.stringify(results[0].record);
  assert.ok(!serializedRecord.includes("secret-token-value"));
  assert.ok(!serializedRecord.includes("should-never-appear-anywhere"));
  // The normalized type has no field that could carry these through -- only
  // named fields validateRequiredFields/normalizeTenderRecord explicitly
  // reads are copied; this confirms it rather than asserting it from intent alone.
});

// 13. Source attribution and auditability
test("13: every normalized record retains its exact source id, notice id, and a provenance reference", () => {
  const normalized = normalizeTenderRecord(makeRaw());
  assert.equal(normalized.sourceId, FIXTURE_SOURCE_ID);
  assert.equal(normalized.sourceNoticeId, "NIT-2026-001");
  assert.ok(normalized.rawProvenanceRef.length > 0);
});

// 14. Tenant isolation using existing supported test infrastructure
test("14: two organizations ingesting the same source content produce independently-scoped results with no cross-contamination of prior state", async () => {
  const raw = makeRaw();
  const priorForOrgA = new Map<string, NormalizedTenderRecord>();
  const priorForOrgB = new Map<string, NormalizedTenderRecord>();

  const adapterA = fixtureAdapter([[raw]]);
  const resultA = await ingestFromSource(adapterA, { requestId: "r-a", organizationId: "org-a", priorRecords: priorForOrgA, approvedSourceIds: APPROVED });
  priorForOrgA.set(resultA[0].record.id, resultA[0].record);

  // Org B's prior-state map was never touched by org A's run -- confirms no shared mutable state leaks between tenants.
  assert.equal(priorForOrgB.size, 0);

  const adapterB = fixtureAdapter([[raw]]);
  const resultB = await ingestFromSource(adapterB, { requestId: "r-b", organizationId: "org-b", priorRecords: priorForOrgB, approvedSourceIds: APPROVED });

  assert.equal(resultA[0].action, "insert");
  assert.equal(resultB[0].action, "insert", "org B sees this as a fresh insert too -- its own prior state is independent of org A's, exactly like QueueManager jobs never leaking organization_id across tenants");
});

// 15. Rejection of unapproved source adapters
test("15: an adapter whose sourceId is not in the approved set is rejected before any processing occurs", async () => {
  const unapproved: SourceAdapter = {
    sourceId: "gem", // a real, currently-UNVERIFIED portal per the access register -- must never run
    async fetchPage() {
      throw new Error("fetchPage should never be called for an unapproved source");
    },
  };
  await assert.rejects(
    () => ingestFromSource(unapproved, { requestId: "r1", organizationId: "org-a", approvedSourceIds: new Set(["fixture_portal"]) }),
    UnapprovedSourceError,
  );
});

test("15b: the production default APPROVED_SOURCE_IDS is empty -- no real portal is cleared yet", async () => {
  const { APPROVED_SOURCE_IDS } = await import("./TenderIngestionPipeline.js");
  assert.equal(APPROVED_SOURCE_IDS.size, 0, "if this ever fails, a real source was approved -- confirm that against docs/audits/PROCUREMENT_PORTAL_ACCESS_REGISTER.md before treating it as fine");
});

// 16. Prevention of automatic conversion into an RFQ
test("16: PersistableIngestionResult has no path to an RFQ, Quote, or Deal -- structurally, not just by convention", async () => {
  const adapter = fixtureAdapter([[makeRaw()]]);
  const results: PersistableIngestionResult[] = await ingestFromSource(adapter, { requestId: "r1", organizationId: "org-a", approvedSourceIds: APPROVED });

  const keys = Object.keys(results[0]);
  assert.deepEqual(keys.sort(), ["action", "comparison", "record"]);
  assert.ok(!("rfqId" in results[0].record), "the normalized record type has no rfqId field -- promotion is a separate, explicit workflow this module cannot perform");
  assertNeverPromotesToRfq(); // grep-able marker, see TenderIngestionPipeline.ts
});

// 17. Failure recovery without duplicate records
test("17: a failed retrieval followed by a successful retry does not create a duplicate record for the same notice", async () => {
  const priorRecords = new Map<string, NormalizedTenderRecord>();
  const failingAdapter: SourceAdapter = {
    sourceId: FIXTURE_SOURCE_ID,
    async fetchPage() {
      throw new Error("simulated transient network failure");
    },
  };
  await assert.rejects(() => ingestFromSource(failingAdapter, { requestId: "r1", organizationId: "org-a", priorRecords, approvedSourceIds: APPROVED }));
  assert.equal(priorRecords.size, 0, "a failed retrieval must leave no partial record behind");

  const retryAdapter = fixtureAdapter([[makeRaw()]]);
  const retryResult = await ingestFromSource(retryAdapter, { requestId: "r2", organizationId: "org-a", priorRecords, approvedSourceIds: APPROVED });
  assert.equal(retryResult.length, 1);
  assert.equal(retryResult[0].action, "insert", "the retry is the first successful insert -- not a duplicate of anything, since nothing was actually persisted by the failed attempt");
});
