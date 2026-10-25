/**
 * Public tender ingestion — provider-agnostic types.
 *
 * MOCK-FIRST FOUNDATION (2026-10-25): no live portal is called anywhere in
 * this module. Every adapter implementing SourceAdapter in this phase reads
 * from a deterministic fixture, never a real network request. This file
 * intentionally does not assume every source exposes a JSON API -- a future
 * adapter may wrap an official API, an authorized bulk-download file, or any
 * other explicitly-approved retrieval method; SourceAdapter only commits to
 * "produces this shape," not "calls this kind of endpoint."
 *
 * Modeled after an existing, already-proven VyaparSethu pattern
 * (ExternalLead: source, rawText, nullable extracted fields, status,
 * nullable rfqId, processedAt — read-only, verified against
 * prisma/schema.prisma in the related repository this session), not
 * invented from scratch. See docs/project/TENDER_INGESTION_PROPOSED_SCHEMA.md
 * (NOT APPLIED) for how a future persistent table would mirror it.
 */

/** The source's own stated status for a notice, as published -- never inferred by this application. */
export type SourceTenderStatus = "published" | "updated" | "closed" | "cancelled" | "withdrawn" | "unknown";

/**
 * This application's own assessment of a record, kept explicitly separate
 * from SourceTenderStatus. A deadline being in the past does NOT by itself
 * mean `expired` -- that requires knowing the deadline's timezone and the
 * record's freshness, which is a business rule (see normalizeTenderRecord's
 * own comments), not an automatic inference from today's date.
 */
export type IngestionApplicationStatus = "new" | "updated" | "unchanged" | "validation_failed" | "needs_review";

export interface ValidationWarning {
  field: string;
  code: string;
  message: string;
}

/** Pagination metadata an adapter MAY report; absent when the source has no concept of pages. */
export interface SourcePaginationInfo {
  page: number;
  hasMore: boolean;
  nextCursor?: string | null;
}

export interface SourceRetrievalError {
  /** Whether a retry is expected to help (e.g. a transient timeout) vs. not (e.g. a 403/permission denial). */
  retryable: boolean;
  message: string;
  /** HTTP status if the retrieval method is HTTP-based; null for non-HTTP sources (e.g. a downloaded file). */
  httpStatus?: number | null;
}

/**
 * One raw retrieval result from a permitted source, before any validation or
 * normalization. `rawPayload` is deliberately `unknown` -- this type makes no
 * assumption about whether the source returns JSON, HTML, or a file
 * reference; that parsing is the adapter's own responsibility, not this
 * contract's.
 */
export interface SourceRetrievalResult {
  sourceId: string;
  /** null when the source provides no stable per-notice identifier -- callers must not invent one. */
  sourceNoticeId: string | null;
  sourceUrl: string | null;
  /** When THIS fetch happened, not when the source published/updated the notice. */
  retrievedAt: string;
  sourcePublishedAt: string | null;
  sourceUpdatedAt: string | null;
  rawPayload: unknown;
  outcome: "ok" | "error";
  error?: SourceRetrievalError;
  pagination?: SourcePaginationInfo;
}

/**
 * Provider-agnostic contract every future source adapter must implement.
 * `fetchPage` returns a batch, not a single record, so pagination is a
 * first-class concern from the start rather than retrofitted later.
 *
 * This phase ships exactly one implementation: a deterministic
 * fixture-backed adapter for tests (see TenderTypes.test.ts /
 * tenderValidation.test.ts). No implementation of this interface in this
 * phase makes a real network call.
 */
export interface SourceAdapter {
  readonly sourceId: string;
  fetchPage(cursor?: string | null): Promise<SourceRetrievalResult[]>;
}

/**
 * The validated, normalized representation. Every field a source may omit
 * is nullable here -- normalizeTenderRecord() must never invent a value for
 * a field the source didn't actually provide.
 */
export interface NormalizedTenderRecord {
  /** Deterministic dedup key -- see computeDedupKey(). Stable across re-ingestion of the same notice. */
  id: string;
  sourceId: string;
  sourceNoticeId: string | null;
  sourceUrl: string | null;

  title: string | null;
  description: string | null;
  procuringAuthority: string | null;
  department: string | null;
  category: string | null;

  publicationDate: string | null;
  submissionDeadline: string | null;
  submissionDeadlineTimezone: string | null;

  /** The source's own stated status -- see SourceTenderStatus's own doc comment. */
  sourceStatus: SourceTenderStatus;
  /** This application's own status -- see IngestionApplicationStatus's own doc comment. */
  applicationStatus: IngestionApplicationStatus;

  location: string | null;
  /** Null when the source does not explicitly state a currency -- never assumed to be INR or any other default. */
  currency: string | null;
  estimatedValue: number | null;

  sourceDocumentRefs: string[];

  retrievedAt: string;
  sourceUpdatedAt: string | null;

  /**
   * A safe reference to the raw retrieval, not the raw payload itself --
   * e.g. a content hash. Keeping the full raw payload out of the normalized
   * record avoids ever accidentally surfacing untrusted/unredacted source
   * content to a consumer that only expects normalized fields.
   */
  rawProvenanceRef: string;

  validationWarnings: ValidationWarning[];

  /** Null whenever extraction was purely structural (e.g. a named JSON field) -- never present without a real AI step. */
  extractionConfidence: number | null;
  manualReviewRequired: boolean;
}
