/**
 * Deterministic validation and normalization for public tender ingestion.
 *
 * Every function here is pure (no I/O, no Date.now()-based "current time"
 * side effects beyond what's passed in) and testable without a database or
 * network connection. Nothing here invents a missing value -- a field the
 * source didn't provide stays null, with a ValidationWarning recorded where
 * that absence matters (e.g. a missing deadline), not silently defaulted.
 */
import { createHash } from "crypto";
import type {
  NormalizedTenderRecord,
  SourceRetrievalResult,
  SourceTenderStatus,
  ValidationWarning,
} from "./TenderTypes.js";

/**
 * Required-field validation. A record missing title AND sourceUrl AND every
 * document reference has nothing a reviewer could act on -- flagged, not
 * silently dropped, so it's visible in the pipeline's output rather than
 * disappearing.
 */
export function validateRequiredFields(raw: SourceRetrievalResult): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const payload = (raw.rawPayload ?? {}) as Record<string, unknown>;

  if (!payload.title || typeof payload.title !== "string" || payload.title.trim().length === 0) {
    warnings.push({ field: "title", code: "MISSING_REQUIRED", message: "Source record has no title." });
  }
  if (!raw.sourceUrl && !raw.sourceNoticeId) {
    warnings.push({
      field: "sourceUrl",
      code: "NO_STABLE_IDENTITY",
      message: "Source provided neither a notice identifier nor a URL -- deduplication will use a weaker fallback key.",
    });
  }
  return warnings;
}

/**
 * Parses a date string the source provided, without inventing a timezone it
 * didn't state. If the source gives an unambiguous ISO-8601 string with an
 * explicit offset or "Z", that offset is trusted. If the string has no
 * timezone marker at all, the parsed ISO instant is still returned (as
 * UTC, since that's what Date's own parsing does for a bare date), but the
 * returned `timezone` is explicitly `null` and a warning is recorded -- the
 * caller must not treat an unmarked date as confidently UTC.
 */
export function parseDateWithTimezone(
  value: string | null | undefined,
  fieldName: string,
): { iso: string | null; timezone: string | null; warnings: ValidationWarning[] } {
  if (!value || value.trim().length === 0) {
    return { iso: null, timezone: null, warnings: [] };
  }

  const hasExplicitOffset = /([+-]\d{2}:?\d{2}|Z)$/i.test(value.trim());
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return {
      iso: null,
      timezone: null,
      warnings: [{ field: fieldName, code: "UNPARSEABLE_DATE", message: `Could not parse "${value}" as a date.` }],
    };
  }

  if (!hasExplicitOffset) {
    return {
      iso: parsed.toISOString(),
      timezone: null,
      warnings: [
        {
          field: fieldName,
          code: "TIMEZONE_UNSTATED",
          message: `Source did not state a timezone for "${value}" -- parsed value may not be reliably comparable to other records.`,
        },
      ],
    };
  }

  return { iso: parsed.toISOString(), timezone: "source-stated-offset", warnings: [] };
}

/**
 * Preserves whatever currency the source actually stated. Never invents a
 * default currency and never converts between currencies (no exchange
 * rate is ever applied here, by design -- that would be inventing a value).
 */
export function normalizeCurrencyAndValue(
  currency: string | null | undefined,
  value: number | string | null | undefined,
): { currency: string | null; estimatedValue: number | null; warnings: ValidationWarning[] } {
  const warnings: ValidationWarning[] = [];

  let estimatedValue: number | null = null;
  if (value !== null && value !== undefined && value !== "") {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
      estimatedValue = numeric;
    } else {
      warnings.push({ field: "estimatedValue", code: "UNPARSEABLE_VALUE", message: `Could not parse "${value}" as a number.` });
    }
  }

  const normalizedCurrency = currency && currency.trim().length > 0 ? currency.trim().toUpperCase() : null;
  if (estimatedValue !== null && !normalizedCurrency) {
    warnings.push({
      field: "currency",
      code: "VALUE_WITHOUT_CURRENCY",
      message: "An estimated value was provided without a stated currency -- never assumed to be any particular currency.",
    });
  }

  return { currency: normalizedCurrency, estimatedValue, warnings };
}

/** Validates a source URL's shape without fetching it. Rejects obviously-unsafe schemes. */
export function validateSourceUrl(url: string | null | undefined): { ok: boolean; warnings: ValidationWarning[] } {
  if (!url) return { ok: true, warnings: [] };
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return {
        ok: false,
        warnings: [{ field: "sourceUrl", code: "UNSAFE_SCHEME", message: `Rejected non-http(s) URL scheme: ${parsed.protocol}` }],
      };
    }
    return { ok: true, warnings: [] };
  } catch {
    return { ok: false, warnings: [{ field: "sourceUrl", code: "INVALID_URL", message: `"${url}" is not a valid URL.` }] };
  }
}

/** Maps whatever status string a source uses onto the fixed SourceTenderStatus set. Unrecognized values become "unknown", never silently dropped. */
export function mapSourceStatus(rawStatus: string | null | undefined): { status: SourceTenderStatus; warnings: ValidationWarning[] } {
  if (!rawStatus) return { status: "unknown", warnings: [] };
  const normalized = rawStatus.trim().toLowerCase();
  const known: Record<string, SourceTenderStatus> = {
    published: "published",
    active: "published",
    open: "published",
    updated: "updated",
    amended: "updated",
    corrigendum: "updated",
    closed: "closed",
    close: "closed",
    cancelled: "cancelled",
    canceled: "cancelled",
    withdrawn: "withdrawn",
    retracted: "withdrawn",
  };
  const mapped = known[normalized];
  if (mapped) return { status: mapped, warnings: [] };
  return {
    status: "unknown",
    warnings: [{ field: "sourceStatus", code: "UNRECOGNIZED_STATUS", message: `Source status "${rawStatus}" is not in the known mapping -- recorded as "unknown", not guessed.` }],
  };
}

/**
 * Deterministic dedup key. Prefers (sourceId, sourceNoticeId) -- the
 * strongest signal. Falls back to (sourceId, normalized sourceUrl) when no
 * notice id exists. As a last resort, when neither exists, falls back to
 * (sourceId, title, publicationDate) -- explicitly the WEAKEST key, and the
 * caller is expected to treat records colliding only on this fallback as
 * requiring manual review (never auto-merged on title similarity alone,
 * per this phase's explicit instruction).
 */
export function computeDedupKey(input: {
  sourceId: string;
  sourceNoticeId: string | null;
  sourceUrl: string | null;
  title: string | null;
  publicationDate: string | null;
}): { key: string; strength: "strong" | "medium" | "weak" } {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

  if (input.sourceNoticeId) {
    return { key: hash(`${input.sourceId}::${input.sourceNoticeId}`), strength: "strong" };
  }
  if (input.sourceUrl) {
    let normalizedUrl = input.sourceUrl;
    try {
      const u = new URL(input.sourceUrl);
      u.hash = "";
      normalizedUrl = u.toString();
    } catch {
      // leave as-is; validateSourceUrl() is responsible for flagging invalid URLs separately
    }
    return { key: hash(`${input.sourceId}::${normalizedUrl}`), strength: "medium" };
  }
  return {
    key: hash(`${input.sourceId}::${input.title ?? ""}::${input.publicationDate ?? ""}`),
    strength: "weak",
  };
}

/** Content hash used as the safe provenance reference -- never the raw payload itself. */
export function hashRawPayload(rawPayload: unknown): string {
  return createHash("sha256").update(JSON.stringify(rawPayload ?? null)).digest("hex");
}

/**
 * Full validate + normalize pipeline for one raw retrieval result.
 * Never throws for malformed source data -- always returns a record, with
 * validationWarnings describing what was wrong, and manualReviewRequired
 * set when warnings are severe enough that the record should not silently
 * become a visible opportunity.
 */
export function normalizeTenderRecord(raw: SourceRetrievalResult): NormalizedTenderRecord {
  const warnings: ValidationWarning[] = [];

  if (raw.outcome === "error") {
    warnings.push({
      field: "retrieval",
      code: raw.error?.retryable ? "RETRIEVAL_FAILED_RETRYABLE" : "RETRIEVAL_FAILED_NON_RETRYABLE",
      message: raw.error?.message ?? "Retrieval failed with no further detail.",
    });
  }

  warnings.push(...validateRequiredFields(raw));

  const payload = (raw.rawPayload ?? {}) as Record<string, unknown>;
  const title = typeof payload.title === "string" ? payload.title : null;
  const description = typeof payload.description === "string" ? payload.description : null;
  const procuringAuthority = typeof payload.procuringAuthority === "string" ? payload.procuringAuthority : null;
  const department = typeof payload.department === "string" ? payload.department : null;
  const category = typeof payload.category === "string" ? payload.category : null;
  const location = typeof payload.location === "string" ? payload.location : null;

  const sourceDocumentRefs: string[] = [];
  if (Array.isArray(payload.documentRefs)) {
    for (const ref of payload.documentRefs) {
      if (typeof ref === "string") {
        const check = validateSourceUrl(ref);
        if (check.ok) sourceDocumentRefs.push(ref);
        else warnings.push(...check.warnings);
      }
    }
  }

  const urlCheck = validateSourceUrl(raw.sourceUrl);
  warnings.push(...urlCheck.warnings);

  const publicationDateResult = parseDateWithTimezone(raw.sourcePublishedAt, "publicationDate");
  warnings.push(...publicationDateResult.warnings);

  const deadlineRaw = typeof payload.submissionDeadline === "string" ? payload.submissionDeadline : null;
  const deadlineResult = parseDateWithTimezone(deadlineRaw, "submissionDeadline");
  warnings.push(...deadlineResult.warnings);
  if (!deadlineRaw) {
    warnings.push({ field: "submissionDeadline", code: "MISSING_DEADLINE", message: "Source did not provide a submission deadline." });
  }

  const currencyResult = normalizeCurrencyAndValue(
    typeof payload.currency === "string" ? payload.currency : null,
    (payload.estimatedValue as number | string | null | undefined) ?? null,
  );
  warnings.push(...currencyResult.warnings);

  const statusResult = mapSourceStatus(typeof payload.status === "string" ? payload.status : null);
  warnings.push(...statusResult.warnings);

  const dedup = computeDedupKey({
    sourceId: raw.sourceId,
    sourceNoticeId: raw.sourceNoticeId,
    sourceUrl: urlCheck.ok ? raw.sourceUrl : null,
    title,
    publicationDate: publicationDateResult.iso,
  });
  if (dedup.strength === "weak") {
    warnings.push({
      field: "dedupKey",
      code: "WEAK_DEDUP_KEY",
      message: "No notice id or URL available -- deduplication relies on title+publicationDate only. Do not auto-merge on this basis alone.",
    });
  }

  // Independent-review P2 fix: `dedup.strength === "weak"` used to live
  // INSIDE the warnings.some() callback, where it was only evaluated once
  // per existing warning -- if `warnings` were ever empty while dedup
  // strength was weak, .some() on an empty array returns false unconditionally
  // and this clause would silently fail to fire. Hoisted to its own
  // independent clause so it can never depend on warnings already being
  // non-empty.
  const hasBlockingError =
    raw.outcome === "error" ||
    !urlCheck.ok ||
    dedup.strength === "weak" ||
    warnings.some((w) => w.code === "MISSING_REQUIRED" || w.code === "UNPARSEABLE_DATE");

  return {
    id: dedup.key,
    sourceId: raw.sourceId,
    sourceNoticeId: raw.sourceNoticeId,
    sourceUrl: urlCheck.ok ? raw.sourceUrl : null,
    title,
    description,
    procuringAuthority,
    department,
    category,
    publicationDate: publicationDateResult.iso,
    submissionDeadline: deadlineResult.iso,
    submissionDeadlineTimezone: deadlineResult.timezone,
    sourceStatus: statusResult.status,
    applicationStatus: hasBlockingError ? "validation_failed" : "new",
    location,
    currency: currencyResult.currency,
    estimatedValue: currencyResult.estimatedValue,
    sourceDocumentRefs,
    retrievedAt: raw.retrievedAt,
    sourceUpdatedAt: raw.sourceUpdatedAt,
    rawProvenanceRef: hashRawPayload(raw.rawPayload),
    validationWarnings: warnings,
    extractionConfidence: null,
    manualReviewRequired: hasBlockingError,
  };
}
