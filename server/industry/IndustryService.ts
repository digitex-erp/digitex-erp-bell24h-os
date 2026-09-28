/**
 * Industry Intelligence service (Phase 2, item 3).
 *
 * WHAT THIS IS: an organization-scoped register of industries, their categories, and market SIGNALS that a person
 * records with provenance (typed in by a user, or taken from a public API / a web search — with a URL). It then
 * summarises what was recorded: counts, weekly counts per industry, and which signals are flagged as RFQ
 * opportunities.
 *
 * WHAT THIS IS NOT: nothing here collects data, scrapes, calls an external service, or predicts anything. "Trend"
 * means a DESCRIPTIVE comparison of how many signals were recorded in the latest full week versus the preceding
 * weeks; it is not a forecast and says so. (MiroFish-style concepts are limited to signal intelligence, trend
 * detection and RFQ-opportunity discovery, per the frozen architecture.)
 *
 * Every query is scoped by organization_id taken from the caller's verified session.
 */

import type pg from "pg";
import { CommunicationValidationError, assertNoControlChars, validateUuid } from "../communication/validation.js";

export const SIGNAL_TYPES = ["demand", "supply", "price", "regulation", "trend", "other"] as const;
export const SOURCE_TYPES = ["user_provided", "public_api", "web_search"] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];
export type SourceType = (typeof SOURCE_TYPES)[number];

export class IndustryTablesMissingError extends Error {
  readonly code = "industry_tables_missing";
  constructor() {
    super("Industry tables do not exist. Apply add_industry_intelligence.sql, then add_industry_signals.sql.");
  }
}
export class IndustryNotFoundError extends Error {
  constructor(what = "industry") {
    super(`${what} not found in this organization.`);
  }
}

/** Maps a Postgres "relation does not exist" error to a typed one; everything else is rethrown untouched. */
export function mapMissingRelation(err: unknown): never {
  const e = err as { code?: string; message?: string };
  if (e?.code === "42P01" || /relation "?(public\.)?industr(y|ies)[a-z_]*"? does not exist/i.test(String(e?.message))) throw new IndustryTablesMissingError();
  throw err;
}

const isUnique = (err: unknown) => (err as { code?: string })?.code === "23505";

// ---- validation (reject, never strip) -----------------------------------------------------------------------------

function text(value: unknown, field: string, { min = 1, max, multiline = false, required = true }: { min?: number; max: number; multiline?: boolean; required?: boolean }): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new CommunicationValidationError(field, "is required");
    return null;
  }
  if (typeof value !== "string") throw new CommunicationValidationError(field, "must be a string");
  const v = value.trim();
  if (v.length < min && required) throw new CommunicationValidationError(field, "is required");
  if (v.length > max) throw new CommunicationValidationError(field, `must be at most ${max} characters`);
  if (multiline) {
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(v)) throw new CommunicationValidationError(field, "contains control characters");
  } else {
    assertNoControlChars(v, field);
  }
  return v === "" ? null : v;
}

export function validateSourceUrl(value: unknown, field = "sourceUrl"): string | null {
  const v = text(value, field, { max: 500, required: false });
  if (v === null) return null;
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new CommunicationValidationError(field, "must be a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new CommunicationValidationError(field, "must be an http(s) URL");
  if (u.username || u.password) throw new CommunicationValidationError(field, "must not contain credentials");
  return u.toString();
}

export interface SignalInput {
  title: unknown;
  summary?: unknown;
  signalType: unknown;
  sourceType: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  observedAt?: unknown;
  industryId?: unknown;
  isRfqOpportunity?: unknown;
  opportunityNote?: unknown;
}

export interface ValidSignal {
  title: string;
  summary: string | null;
  signalType: SignalType;
  sourceType: SourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  observedAt: Date;
  industryId: string | null;
  isRfqOpportunity: boolean;
  opportunityNote: string | null;
}

export function validateSignal(input: SignalInput, now: Date = new Date()): ValidSignal {
  const title = text(input.title, "title", { max: 200 })!;
  const summary = text(input.summary, "summary", { max: 2000, multiline: true, required: false });
  if (!SIGNAL_TYPES.includes(input.signalType as SignalType)) throw new CommunicationValidationError("signalType", `must be one of: ${SIGNAL_TYPES.join(", ")}`);
  if (!SOURCE_TYPES.includes(input.sourceType as SourceType)) throw new CommunicationValidationError("sourceType", `must be one of: ${SOURCE_TYPES.join(", ")}`);
  const sourceType = input.sourceType as SourceType;
  const sourceName = text(input.sourceName, "sourceName", { max: 100, required: false });
  const sourceUrl = validateSourceUrl(input.sourceUrl);
  if (sourceType !== "user_provided" && !sourceUrl) {
    throw new CommunicationValidationError("sourceUrl", `is required when sourceType is "${sourceType}" so the signal can be checked`);
  }
  let observedAt = now;
  if (input.observedAt !== undefined && input.observedAt !== null && input.observedAt !== "") {
    if (typeof input.observedAt !== "string" || Number.isNaN(Date.parse(input.observedAt))) throw new CommunicationValidationError("observedAt", "must be an ISO-8601 date");
    observedAt = new Date(input.observedAt);
    if (observedAt.getTime() > now.getTime() + 24 * 3600_000) throw new CommunicationValidationError("observedAt", "must not be in the future");
    if (observedAt.getTime() < now.getTime() - 5 * 365 * 24 * 3600_000) throw new CommunicationValidationError("observedAt", "must be within the last 5 years");
  }
  const industryId = input.industryId === undefined || input.industryId === null || input.industryId === "" ? null : validateUuid(input.industryId, "industryId");
  if (input.isRfqOpportunity !== undefined && typeof input.isRfqOpportunity !== "boolean") throw new CommunicationValidationError("isRfqOpportunity", "must be a boolean");
  const isRfqOpportunity = input.isRfqOpportunity === true;
  const opportunityNote = text(input.opportunityNote, "opportunityNote", { max: 500, required: false });
  if (opportunityNote && !isRfqOpportunity) throw new CommunicationValidationError("opportunityNote", "is only allowed on a signal flagged as an RFQ opportunity");
  return { title, summary, signalType: input.signalType as SignalType, sourceType, sourceName, sourceUrl, observedAt, industryId, isRfqOpportunity, opportunityNote };
}

// ---- trend classification (pure, unit-tested) ----------------------------------------------------------------------

export type TrendDirection = "rising" | "falling" | "flat" | "insufficient_data";

/**
 * Descriptive comparison of recorded-signal counts. `weekly` is oldest→newest and its LAST entry must be the latest
 * COMPLETE week. Needs at least MIN_SIGNALS recorded in the window, otherwise "insufficient_data" (a handful of rows
 * says nothing). "rising"/"falling" require a change of at least 50% AND at least 2 signals versus the mean of the
 * preceding weeks. This is arithmetic on what was typed in; it is not a forecast.
 */
export const MIN_SIGNALS_FOR_TREND = 6;
export function classifyTrend(weekly: number[]): TrendDirection {
  if (weekly.length < 3 || weekly.reduce((a, b) => a + b, 0) < MIN_SIGNALS_FOR_TREND) return "insufficient_data";
  const last = weekly[weekly.length - 1];
  const prior = weekly.slice(Math.max(0, weekly.length - 5), weekly.length - 1);
  const mean = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (last - mean >= 2 && last >= mean * 1.5) return "rising";
  if (mean - last >= 2 && last <= mean * 0.5) return "falling";
  return "flat";
}

// ---- service -------------------------------------------------------------------------------------------------------

export class IndustryService {
  constructor(private pool: pg.Pool) {}

  async overview(organizationId: string) {
    try {
      const industries = await this.pool.query(
        `SELECT i.id, i.name, i.description, i.created_at,
                (SELECT COUNT(*)::int FROM public.industry_categories c WHERE c.industry_id = i.id AND c.organization_id = i.organization_id) AS categories,
                (SELECT COUNT(*)::int FROM public.buyer_personas b WHERE b.industry_id = i.id AND b.organization_id = i.organization_id) AS buyer_personas,
                (SELECT COUNT(*)::int FROM public.supplier_personas s WHERE s.industry_id = i.id AND s.organization_id = i.organization_id) AS supplier_personas,
                (SELECT COUNT(*)::int FROM public.industry_signals g WHERE g.industry_id = i.id AND g.organization_id = i.organization_id) AS signals,
                (SELECT COUNT(*)::int FROM public.industry_signals g WHERE g.industry_id = i.id AND g.organization_id = i.organization_id AND g.observed_at > NOW() - INTERVAL '30 days') AS signals_30d
           FROM public.industries i WHERE i.organization_id = $1 ORDER BY i.name`,
        [organizationId],
      );
      const totals = await this.pool.query(
        `SELECT COUNT(*)::int AS signals,
                COUNT(*) FILTER (WHERE observed_at > NOW() - INTERVAL '30 days')::int AS signals_30d,
                COUNT(*) FILTER (WHERE is_rfq_opportunity)::int AS opportunities,
                COUNT(*) FILTER (WHERE source_type = 'user_provided')::int AS user_provided,
                COUNT(*) FILTER (WHERE source_type = 'public_api')::int AS public_api,
                COUNT(*) FILTER (WHERE source_type = 'web_search')::int AS web_search,
                COUNT(*) FILTER (WHERE industry_id IS NULL)::int AS unassigned
           FROM public.industry_signals WHERE organization_id = $1`,
        [organizationId],
      );
      return { industries: industries.rows, summary: totals.rows[0] };
    } catch (err) {
      return mapMissingRelation(err);
    }
  }

  async createIndustry(organizationId: string, input: { name: unknown; description?: unknown }) {
    const name = text(input.name, "name", { max: 120 })!;
    const description = text(input.description, "description", { max: 1000, multiline: true, required: false });
    try {
      const r = await this.pool.query(
        `INSERT INTO public.industries (name, description, organization_id) VALUES ($1, $2, $3) RETURNING id, name, description, created_at`,
        [name, description, organizationId],
      );
      return r.rows[0];
    } catch (err) {
      if (isUnique(err)) throw new CommunicationValidationError("name", "an industry with this name already exists in this organization");
      return mapMissingRelation(err);
    }
  }

  async deleteIndustry(organizationId: string, id: string): Promise<void> {
    try {
      const r = await this.pool.query(`DELETE FROM public.industries WHERE id = $1 AND organization_id = $2 RETURNING id`, [validateUuid(id, "id"), organizationId]);
      if (r.rows.length === 0) throw new IndustryNotFoundError();
    } catch (err) {
      if (err instanceof IndustryNotFoundError) throw err;
      return mapMissingRelation(err);
    }
  }

  private async requireIndustry(organizationId: string, id: string) {
    const r = await this.pool.query(`SELECT id FROM public.industries WHERE id = $1 AND organization_id = $2`, [validateUuid(id, "industryId"), organizationId]);
    if (r.rows.length === 0) throw new IndustryNotFoundError();
  }

  async listCategories(organizationId: string, industryId: string) {
    try {
      await this.requireIndustry(organizationId, industryId);
      const r = await this.pool.query(`SELECT id, name, description, created_at FROM public.industry_categories WHERE industry_id = $1 AND organization_id = $2 ORDER BY name`, [industryId, organizationId]);
      return { categories: r.rows };
    } catch (err) {
      if (err instanceof IndustryNotFoundError) throw err;
      return mapMissingRelation(err);
    }
  }

  async createCategory(organizationId: string, industryId: string, input: { name: unknown; description?: unknown }) {
    const name = text(input.name, "name", { max: 120 })!;
    const description = text(input.description, "description", { max: 1000, multiline: true, required: false });
    try {
      await this.requireIndustry(organizationId, industryId);
      const r = await this.pool.query(
        `INSERT INTO public.industry_categories (industry_id, name, description, organization_id) VALUES ($1, $2, $3, $4) RETURNING id, name, description, created_at`,
        [industryId, name, description, organizationId],
      );
      return r.rows[0];
    } catch (err) {
      if (err instanceof IndustryNotFoundError) throw err;
      if (isUnique(err)) throw new CommunicationValidationError("name", "this industry already has a category with that name");
      return mapMissingRelation(err);
    }
  }

  async createSignal(organizationId: string, actor: string | null, input: SignalInput) {
    const s = validateSignal(input);
    try {
      if (s.industryId) await this.requireIndustry(organizationId, s.industryId);
      const r = await this.pool.query(
        `INSERT INTO public.industry_signals
           (organization_id, industry_id, title, summary, signal_type, source_type, source_name, source_url, observed_at, is_rfq_opportunity, opportunity_note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
        [organizationId, s.industryId, s.title, s.summary, s.signalType, s.sourceType, s.sourceName, s.sourceUrl, s.observedAt.toISOString(), s.isRfqOpportunity, s.opportunityNote, actor],
      );
      return r.rows[0];
    } catch (err) {
      if (err instanceof IndustryNotFoundError) throw err;
      return mapMissingRelation(err);
    }
  }

  async listSignals(
    organizationId: string,
    f: { industryId?: unknown; signalType?: unknown; sourceType?: unknown; opportunitiesOnly?: boolean; limit?: number; offset?: number },
  ) {
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
    const offset = Math.max(f.offset ?? 0, 0);
    const where = ["g.organization_id = $1"];
    const params: unknown[] = [organizationId];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace("?", `$${params.length}`));
    };
    if (f.industryId !== undefined && f.industryId !== "") add("g.industry_id = ?", validateUuid(f.industryId, "industryId"));
    if (f.signalType !== undefined && f.signalType !== "") {
      if (!SIGNAL_TYPES.includes(f.signalType as SignalType)) throw new CommunicationValidationError("signalType", `must be one of: ${SIGNAL_TYPES.join(", ")}`);
      add("g.signal_type = ?", f.signalType);
    }
    if (f.sourceType !== undefined && f.sourceType !== "") {
      if (!SOURCE_TYPES.includes(f.sourceType as SourceType)) throw new CommunicationValidationError("sourceType", `must be one of: ${SOURCE_TYPES.join(", ")}`);
      add("g.source_type = ?", f.sourceType);
    }
    if (f.opportunitiesOnly) where.push("g.is_rfq_opportunity");
    try {
      const total = await this.pool.query(`SELECT COUNT(*)::int AS n FROM public.industry_signals g WHERE ${where.join(" AND ")}`, params);
      params.push(limit, offset);
      const r = await this.pool.query(
        `SELECT g.id, g.title, g.summary, g.signal_type, g.source_type, g.source_name, g.source_url, g.observed_at, g.is_rfq_opportunity, g.opportunity_note, g.industry_id, i.name AS industry_name, g.created_at
           FROM public.industry_signals g LEFT JOIN public.industries i ON i.id = g.industry_id AND i.organization_id = g.organization_id
          WHERE ${where.join(" AND ")} ORDER BY g.observed_at DESC, g.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { signals: r.rows, total: total.rows[0].n as number, limit, offset };
    } catch (err) {
      return mapMissingRelation(err);
    }
  }

  async setOpportunity(organizationId: string, id: string, input: { isRfqOpportunity: unknown; opportunityNote?: unknown }) {
    if (typeof input.isRfqOpportunity !== "boolean") throw new CommunicationValidationError("isRfqOpportunity", "must be a boolean");
    const note = text(input.opportunityNote, "opportunityNote", { max: 500, required: false });
    if (note && !input.isRfqOpportunity) throw new CommunicationValidationError("opportunityNote", "is only allowed on a signal flagged as an RFQ opportunity");
    try {
      const r = await this.pool.query(
        `UPDATE public.industry_signals SET is_rfq_opportunity = $3, opportunity_note = $4, updated_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING *`,
        [validateUuid(id, "id"), organizationId, input.isRfqOpportunity, input.isRfqOpportunity ? note : null],
      );
      if (r.rows.length === 0) throw new IndustryNotFoundError("signal");
      return r.rows[0];
    } catch (err) {
      if (err instanceof IndustryNotFoundError) throw err;
      return mapMissingRelation(err);
    }
  }

  async deleteSignal(organizationId: string, id: string): Promise<void> {
    try {
      const r = await this.pool.query(`DELETE FROM public.industry_signals WHERE id = $1 AND organization_id = $2 RETURNING id`, [validateUuid(id, "id"), organizationId]);
      if (r.rows.length === 0) throw new IndustryNotFoundError("signal");
    } catch (err) {
      if (err instanceof IndustryNotFoundError) throw err;
      return mapMissingRelation(err);
    }
  }

  /** Weekly counts (ISO weeks, UTC) of recorded signals per industry, last `weeks` complete weeks, plus a descriptive direction. */
  async trends(organizationId: string, weeksInput: unknown = 8) {
    const weeks = weeksInput === undefined || weeksInput === "" ? 8 : Number(weeksInput);
    if (!Number.isInteger(weeks) || weeks < 3 || weeks > 26) throw new CommunicationValidationError("weeks", "must be an integer from 3 to 26");
    try {
      // Complete weeks only: the window ends at the start of the current week.
      const r = await this.pool.query(
        `WITH bounds AS (
            SELECT date_trunc('week', NOW() AT TIME ZONE 'UTC') AS this_week
         ), series AS (
            SELECT (this_week - (n || ' weeks')::interval) AS week_start FROM bounds, generate_series(1, $2::int) AS n
         ), counts AS (
            SELECT g.industry_id, date_trunc('week', g.observed_at AT TIME ZONE 'UTC') AS week_start, COUNT(*)::int AS n
              FROM public.industry_signals g, bounds
             WHERE g.organization_id = $1
               AND g.observed_at AT TIME ZONE 'UTC' >= bounds.this_week - ($2::int || ' weeks')::interval
               AND g.observed_at AT TIME ZONE 'UTC' < bounds.this_week
             GROUP BY 1, 2
         )
         SELECT i.id AS industry_id, i.name AS industry_name, s.week_start, COALESCE(c.n, 0) AS n
           FROM series s
           CROSS JOIN (SELECT id, name FROM public.industries WHERE organization_id = $1 UNION ALL SELECT NULL::uuid, '(unassigned)') i
           LEFT JOIN counts c ON c.week_start = s.week_start AND c.industry_id IS NOT DISTINCT FROM i.id
          ORDER BY i.name, s.week_start`,
        [organizationId, weeks],
      );
      const byIndustry = new Map<string, { industryId: string | null; name: string; weekly: { weekStart: string; count: number }[] }>();
      for (const row of r.rows as { industry_id: string | null; industry_name: string; week_start: Date | string; n: number }[]) {
        const key = row.industry_id ?? "unassigned";
        if (!byIndustry.has(key)) byIndustry.set(key, { industryId: row.industry_id, name: row.industry_name, weekly: [] });
        byIndustry.get(key)!.weekly.push({ weekStart: new Date(row.week_start).toISOString().slice(0, 10), count: row.n });
      }
      const trends = Array.from(byIndustry.values())
        .map((t) => ({ ...t, total: t.weekly.reduce((a, w) => a + w.count, 0), direction: classifyTrend(t.weekly.map((w) => w.count)) }))
        .filter((t) => t.total > 0 || t.industryId !== null);
      return {
        weeks,
        trends,
        note: "Descriptive counts of signals that were recorded, by week of observation. Not a forecast. 'insufficient_data' means fewer than " + MIN_SIGNALS_FOR_TREND + " signals in the window.",
      };
    } catch (err) {
      return mapMissingRelation(err);
    }
  }
}
