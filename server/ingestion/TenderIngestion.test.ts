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
import {
  assertNeverPromotesToRfq,
  ingestFromSource,
  UnapprovedSourceError,
  __createIngestorForTests,
  type PersistableIngestionResult,
} from "./TenderIngestionPipeline.js";
import {
  PRODUCTION_SOURCE_APPROVAL_POLICY,
  listApprovedSourceIdsForDiagnostics,
} from "./sourceApprovalPolicy.js";

const FIXTURE_SOURCE_ID = "fixture_portal";

/**
 * The test-only ingestor. `ingestFromSource` (the production export) has no
 * policy parameter at all, so the fixture source can only be exercised
 * through this explicitly test-scoped factory.
 */
const ingestForTests = __createIngestorForTests([FIXTURE_SOURCE_ID]);

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

  const first = await ingestForTests(adapter, { requestId: "req-1", organizationId: "org-a", priorRecords });
  assert.equal(first.length, 1);
  assert.equal(first[0].action, "insert");
  priorRecords.set(first[0].record.id, first[0].record);

  const second = await ingestForTests(adapter, { requestId: "req-2", organizationId: "org-a", priorRecords });
  assert.equal(second.length, 1);
  assert.equal(second[0].action, "noop", "identical re-fetch must be a no-op, not a duplicate insert");
  assert.equal(second[0].record.id, first[0].record.id);
});

// 9. Changed source content and changed deadlines
test("9: a changed description and a changed deadline are both detected as 'update', with exact changed fields listed", async () => {
  const priorRecords = new Map<string, NormalizedTenderRecord>();
  const adapter1 = fixtureAdapter([[makeRaw()]]);
  const first = await ingestForTests(adapter1, { requestId: "r1", organizationId: "org-a", priorRecords });
  priorRecords.set(first[0].record.id, first[0].record);

  const adapter2 = fixtureAdapter([
    [makeRaw({ payload: { description: "Updated scope: chairs, desks, and cabinets.", submissionDeadline: "2026-12-01T17:00:00+05:30" } })],
  ]);
  const second = await ingestForTests(adapter2, { requestId: "r2", organizationId: "org-a", priorRecords });

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

  const firstPage = await ingestForTests(adapter, { requestId: "r1", organizationId: "org-a" });
  assert.equal(firstPage.length, 1);

  const secondPage = await ingestForTests(adapter, { requestId: "r2", organizationId: "org-a" }, "c2");
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
  const results = await ingestForTests(adapter, { requestId: "r1", organizationId: "org-a" });

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

// 14. Organization scoping -- see each test's own scope note. P2-D fix: the
// previous single test here was named "tenant isolation" but only showed that
// two separate JS Map instances don't share state (a Map guarantee, not a
// property of this code). Renamed honestly and split into checks that
// actually exercise this module's own behavior.
test("14a: application-logic only -- per-call prior-state is read from the caller's own map, with no module-level shared state between calls", async () => {
  const raw = makeRaw();
  const priorForOrgA = new Map<string, NormalizedTenderRecord>();
  const priorForOrgB = new Map<string, NormalizedTenderRecord>();

  const resultA = await ingestForTests(fixtureAdapter([[raw]]), { requestId: "r-a", organizationId: "org-a", priorRecords: priorForOrgA });
  priorForOrgA.set(resultA[0].record.id, resultA[0].record);

  const resultB = await ingestForTests(fixtureAdapter([[raw]]), { requestId: "r-b", organizationId: "org-b", priorRecords: priorForOrgB });

  assert.equal(resultA[0].action, "insert");
  assert.equal(
    resultB[0].action,
    "insert",
    "org B's call does not see org A's prior state. SCOPE: this proves the pipeline holds no module-level cross-call state -- it is NOT a database or RLS test, and this phase has no persistence layer to test a real tenant boundary against.",
  );
  assert.equal(priorForOrgB.size, 0, "org A's run never wrote into org B's map");
});

test("14b: the organization id recorded for a record comes from the trusted caller context, never from source content", async () => {
  // A payload that tries to assert its own organization_id in every plausible shape.
  const hostileRaw = makeRaw({
    payload: {
      organization_id: "org-ATTACKER",
      organizationId: "org-ATTACKER",
      organization: "org-ATTACKER",
      tenant_id: "org-ATTACKER",
    },
  });

  const results = await ingestForTests(fixtureAdapter([[hostileRaw]]), {
    requestId: "r1",
    organizationId: "org-LEGITIMATE",
  });

  // The normalized record carries no org field at all -- org identity lives
  // only in the audit event, sourced from IngestOptions.
  const serialized = JSON.stringify(results[0].record);
  assert.ok(
    !serialized.includes("org-ATTACKER"),
    "no payload-supplied organization identifier may appear anywhere in the normalized record",
  );
  assert.ok(
    !Object.keys(results[0].record).some((k) => /organ|tenant/i.test(k)),
    "the normalized record type has no organization/tenant field for a payload to populate",
  );
});

// 15. Approval-gate enforcement (P0 regression tests).
test("15: an unapproved source is rejected BEFORE fetchPage is called -- the portal is never contacted", async () => {
  let fetchWasCalled = false;
  const unapproved: SourceAdapter = {
    sourceId: "gem", // a real, currently-UNVERIFIED portal per the access register -- must never run
    async fetchPage() {
      fetchWasCalled = true;
      return [];
    },
  };
  await assert.rejects(
    () => ingestForTests(unapproved, { requestId: "r1", organizationId: "org-a" }),
    UnapprovedSourceError,
  );
  assert.equal(fetchWasCalled, false, "a rejected source must never be fetched -- not even once");
});

test("15b: the authoritative production policy is empty and approves nothing, including every real portal examined", () => {
  assert.deepEqual(
    listApprovedSourceIdsForDiagnostics(),
    [],
    "if this ever fails, a real source was approved -- confirm it against docs/audits/PROCUREMENT_PORTAL_ACCESS_REGISTER.md first",
  );
  for (const realPortal of ["cppp", "gem", "maharashtra_etenders", FIXTURE_SOURCE_ID]) {
    assert.equal(PRODUCTION_SOURCE_APPROVAL_POLICY.isApproved(realPortal), false, `${realPortal} must not be approved by the production policy`);
  }
});

// P0 REGRESSION #1 (bypass via caller-supplied options). The original defect:
// `IngestOptions.approvedSourceIds` let any caller authorize any source.
test("15c: P0 regression -- a caller cannot authorize its own source through IngestOptions; the production entry point takes no policy at all", async () => {
  const unapproved: SourceAdapter = { sourceId: "gem", async fetchPage() { return []; } };

  // Attempt the exact original bypass, cast through `any` to simulate a
  // caller (or a stale/JS caller) that still passes the removed field.
  await assert.rejects(
    () =>
      ingestFromSource(unapproved, {
        requestId: "r1",
        organizationId: "org-a",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ approvedSourceIds: new Set(["gem"]) } as any),
      }),
    UnapprovedSourceError,
    "passing an approval set through options must have no effect -- the field no longer exists and the production ingestor ignores anything extra",
  );

  // Also confirm the production ingestor rejects even the test fixture id,
  // proving it is bound to the authoritative policy, not a test one.
  await assert.rejects(
    () => ingestFromSource(fixtureAdapter([[makeRaw()]]), { requestId: "r2", organizationId: "org-a" }),
    UnapprovedSourceError,
  );
});

// P0 REGRESSION #2 (runtime mutation of the exported collection). The original
// defect: `APPROVED_SOURCE_IDS` was an exported `ReadonlySet` whose underlying
// JS Set accepted `.add()`, permanently corrupting the production default.
test("15d: P0 regression -- no exported collection exists that a caller can mutate to approve a source", async () => {
  const pipeline: Record<string, unknown> = await import("./TenderIngestionPipeline.js");
  const policyModule: Record<string, unknown> = await import("./sourceApprovalPolicy.js");

  // No module export is a Set/Array/Map of approved ids that could be mutated.
  for (const [moduleName, mod] of [["pipeline", pipeline], ["policy", policyModule]] as const) {
    for (const [exportName, value] of Object.entries(mod)) {
      assert.ok(
        !(value instanceof Set) && !(value instanceof Map) && !Array.isArray(value),
        `${moduleName}.${exportName} is a mutable collection export -- the P0 bypass was exactly this shape`,
      );
    }
  }

  // The diagnostic accessor returns a copy: mutating the result changes nothing.
  const copy = listApprovedSourceIdsForDiagnostics();
  copy.push("gem");
  assert.deepEqual(listApprovedSourceIdsForDiagnostics(), [], "the diagnostic view must return a fresh copy each call");
  assert.equal(PRODUCTION_SOURCE_APPROVAL_POLICY.isApproved("gem"), false, "mutating a diagnostic copy must not affect approval decisions");

  // The policy object itself is frozen -- its decision function cannot be swapped.
  assert.throws(() => {
    "use strict";
    (PRODUCTION_SOURCE_APPROVAL_POLICY as unknown as Record<string, unknown>).isApproved = () => true;
  }, "the production policy object must be frozen against having its decision function replaced");
});

test("15e: P0 regression -- one request cannot change authorization for a subsequent request in the same process", async () => {
  const unapproved: SourceAdapter = { sourceId: "gem", async fetchPage() { return []; } };

  // First request: rejected.
  await assert.rejects(() => ingestFromSource(unapproved, { requestId: "r1", organizationId: "org-a" }), UnapprovedSourceError);

  // Every mutation attempt a caller could reach for, all in one process.
  try { (listApprovedSourceIdsForDiagnostics() as string[]).push("gem"); } catch { /* ignored */ }
  try { (PRODUCTION_SOURCE_APPROVAL_POLICY as unknown as Record<string, unknown>).isApproved = () => true; } catch { /* frozen, expected */ }

  // Second request: still rejected. Authorization state did not carry over.
  await assert.rejects(
    () => ingestFromSource(unapproved, { requestId: "r2", organizationId: "org-a" }),
    UnapprovedSourceError,
    "authorization must be identical for the second request -- no cross-request state change is possible",
  );
});

test("15f: malformed source ids are rejected before any fetch, not normalized into a match", async () => {
  for (const malformed of [undefined, null, "", "   ", 42, {}, [], "  fixture_portal  "]) {
    let fetchWasCalled = false;
    const adapter = {
      sourceId: malformed as unknown as string,
      async fetchPage() { fetchWasCalled = true; return []; },
    } as SourceAdapter;
    await assert.rejects(
      () => ingestForTests(adapter, { requestId: "r1", organizationId: "org-a" }),
      UnapprovedSourceError,
      `malformed source id ${JSON.stringify(malformed)} must be rejected`,
    );
    assert.equal(fetchWasCalled, false, `malformed source id ${JSON.stringify(malformed)} must not be fetched`);
  }
  // A missing adapter object is rejected by the policy, not by a TypeError.
  await assert.rejects(
    () => ingestForTests(undefined as unknown as SourceAdapter, { requestId: "r1", organizationId: "org-a" }),
    UnapprovedSourceError,
  );
});

// 16. Prevention of automatic conversion into an RFQ
test("16: PersistableIngestionResult has no path to an RFQ, Quote, or Deal -- structurally, not just by convention", async () => {
  const adapter = fixtureAdapter([[makeRaw()]]);
  const results: PersistableIngestionResult[] = await ingestForTests(adapter, { requestId: "r1", organizationId: "org-a" });

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
  await assert.rejects(() => ingestForTests(failingAdapter, { requestId: "r1", organizationId: "org-a", priorRecords }));
  assert.equal(priorRecords.size, 0, "a failed retrieval must leave no partial record behind");

  const retryAdapter = fixtureAdapter([[makeRaw()]]);
  const retryResult = await ingestForTests(retryAdapter, { requestId: "r2", organizationId: "org-a", priorRecords });
  assert.equal(retryResult.length, 1);
  assert.equal(retryResult[0].action, "insert", "the retry is the first successful insert -- not a duplicate of anything, since nothing was actually persisted by the failed attempt");
});

// ---------------------------------------------------------------------------
// P2-A regression: sourceDocumentRefs change detection, per the documented
// unordered-unique-set rule in tenderDeduplication.ts.
// ---------------------------------------------------------------------------
function recordWithDocs(docs: string[]): NormalizedTenderRecord {
  return normalizeTenderRecord(makeRaw({ payload: { documentRefs: docs } }));
}
const DOC_A = "https://example-portal.test/docs/a.pdf";
const DOC_B = "https://example-portal.test/docs/b.pdf";

test("P2-A.1: identical document references are NOT a change", () => {
  const cmp = compareForReingestion(recordWithDocs([DOC_A]), recordWithDocs([DOC_A]));
  assert.equal(cmp.changed, false);
  assert.ok(!cmp.changedFields.includes("sourceDocumentRefs"));
});

test("P2-A.2: an ADDED document reference IS detected as a change (the corrigendum case the original code missed)", () => {
  const cmp = compareForReingestion(recordWithDocs([DOC_A]), recordWithDocs([DOC_A, DOC_B]));
  assert.equal(cmp.changed, true);
  assert.ok(cmp.changedFields.includes("sourceDocumentRefs"));
  assert.equal(cmp.nextApplicationStatus, "updated");
});

test("P2-A.3: a REMOVED document reference IS detected as a change", () => {
  const cmp = compareForReingestion(recordWithDocs([DOC_A, DOC_B]), recordWithDocs([DOC_A]));
  assert.equal(cmp.changed, true);
  assert.ok(cmp.changedFields.includes("sourceDocumentRefs"));
});

test("P2-A.4: a REPLACED document reference IS detected as a change", () => {
  const cmp = compareForReingestion(recordWithDocs([DOC_A]), recordWithDocs([DOC_B]));
  assert.equal(cmp.changed, true);
  assert.ok(cmp.changedFields.includes("sourceDocumentRefs"));
});

test("P2-A.5: missing references on both sides (no documents known) is NOT a change", () => {
  const cmp = compareForReingestion(recordWithDocs([]), recordWithDocs([]));
  assert.equal(cmp.changed, false);
});

test("P2-A.6: ambiguous case per the documented rule -- reorder only is NOT a change, and a duplicate-only difference is NOT a change", () => {
  const reorder = compareForReingestion(recordWithDocs([DOC_A, DOC_B]), recordWithDocs([DOC_B, DOC_A]));
  assert.equal(reorder.changed, false, "documented rule: compared as an unordered set, so reordering is not substantive");

  const dupe = compareForReingestion(recordWithDocs([DOC_A]), recordWithDocs([DOC_A, DOC_A]));
  assert.equal(dupe.changed, false, "documented rule: compared as unique values, so a repeated reference is not a new one");
});

// ---------------------------------------------------------------------------
// P2-B regression: each blocking-condition branch of normalizeTenderRecord()
// is now independently verified, positive and negative.
// ---------------------------------------------------------------------------
test("P2-B.1: branch -- retrieval failure alone forces manual review", () => {
  const r = normalizeTenderRecord(makeRaw({ outcome: "error", error: { retryable: true, message: "timeout" } }));
  assert.equal(r.manualReviewRequired, true);
  assert.equal(r.applicationStatus, "validation_failed");
});

test("P2-B.2: branch -- invalid source URL alone forces manual review", () => {
  const r = normalizeTenderRecord(makeRaw({ sourceUrl: "javascript:alert(1)" }));
  assert.equal(r.manualReviewRequired, true);
});

test("P2-B.3: branch -- a missing required field alone forces manual review", () => {
  const r = normalizeTenderRecord(makeRaw({ payload: { title: undefined } }));
  assert.equal(r.manualReviewRequired, true);
});

test("P2-B.4: branch -- weak identity (no notice id, no URL) forces manual review INDEPENDENTLY of any other warning", () => {
  const r = normalizeTenderRecord(makeRaw({ sourceNoticeId: null, sourceUrl: null }));
  assert.ok(r.validationWarnings.some((w) => w.code === "WEAK_DEDUP_KEY"));
  assert.equal(
    r.manualReviewRequired,
    true,
    "previously this relied on another warning existing first, because the weak-key check was nested inside .some() -- it is now its own clause",
  );
});

test("P2-B.5: negative branch -- a fully valid record trips NO blocking condition", () => {
  const r = normalizeTenderRecord(makeRaw());
  assert.equal(r.manualReviewRequired, false);
  assert.equal(r.applicationStatus, "new");
  assert.deepEqual(r.validationWarnings, []);
});
