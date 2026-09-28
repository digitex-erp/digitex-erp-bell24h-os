/**
 * AudienceService — contact lists, segments, and resolving either into the set of contacts a campaign
 * will target.
 *
 * "Leads" are the organization's own `contacts` rows (there is no separate leads table). Lists are named
 * membership sets over those contacts. A segment is SAVED CRITERIA — a small, strictly validated JSON
 * document — that is re-evaluated when a campaign is created. Criteria are only ever bound as query
 * PARAMETERS to a fixed SQL shape; they never become SQL text.
 *
 * Resolution never widens the audience beyond the caller's organization, never includes soft-deleted
 * contacts, and only returns contacts that have a non-empty address for the campaign's channel. Suppression is
 * applied by the caller (CampaignService) so the exclusion count can be reported.
 */

import type pg from "pg";
import type { ChannelType } from "./types.js";
import { CommunicationValidationError, validateChannel, validateUuid, validateUuidList } from "./validation.js";

export class AudienceNotFoundError extends Error {
  constructor(what: "list" | "segment") {
    super(`${what === "list" ? "List" : "Segment"} not found in this organization.`);
  }
}

export interface SegmentCriteria {
  /** Contacts that are members of ANY of these lists. */
  listIds?: string[];
  companyContains?: string;
  nameContains?: string;
  createdAfter?: string;
  createdBefore?: string;
}

const CRITERIA_KEYS = ["listIds", "companyContains", "nameContains", "createdAfter", "createdBefore"] as const;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > 100) {
    throw new CommunicationValidationError(field, "must be a non-empty string of at most 100 characters");
  }
  if (/[\u0000-\u001F\u007F]/.test(value)) throw new CommunicationValidationError(field, "contains control characters");
  return value.trim();
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new CommunicationValidationError(field, "must be an ISO-8601 date");
  return new Date(value).toISOString();
}

/** Validates and normalizes criteria. Unknown keys are rejected (a typo must not silently widen the audience). */
export function validateCriteria(raw: unknown): SegmentCriteria {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new CommunicationValidationError("criteria", "must be an object");
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(src)) {
    if (!(CRITERIA_KEYS as readonly string[]).includes(k)) throw new CommunicationValidationError("criteria", `unknown key "${k.slice(0, 30)}"`);
  }
  const out: SegmentCriteria = {};
  if (src.listIds !== undefined) out.listIds = validateUuidList(src.listIds, "criteria.listIds", 20);
  if (src.companyContains !== undefined) out.companyContains = text(src.companyContains, "criteria.companyContains");
  if (src.nameContains !== undefined) out.nameContains = text(src.nameContains, "criteria.nameContains");
  if (src.createdAfter !== undefined) out.createdAfter = isoDate(src.createdAfter, "criteria.createdAfter");
  if (src.createdBefore !== undefined) out.createdBefore = isoDate(src.createdBefore, "criteria.createdBefore");
  if (Object.keys(out).length === 0) {
    throw new CommunicationValidationError("criteria", "must contain at least one condition (an empty segment would match every contact)");
  }
  return out;
}

const validateName = (value: unknown, field = "name"): string => {
  if (typeof value !== "string") throw new CommunicationValidationError(field, "must be a string");
  const v = value.trim();
  if (v === "" || v.length > 200) throw new CommunicationValidationError(field, "is required (max 200 characters)");
  if (/[\u0000-\u001F\u007F]/.test(v)) throw new CommunicationValidationError(field, "contains control characters");
  return v;
};

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "23505";

const MAX_AUDIENCE = () => {
  const n = Number(process.env.COMM_CAMPAIGN_MAX_RECIPIENTS);
  return Number.isInteger(n) && n > 0 ? n : 5000;
};

export class AudienceService {
  constructor(private pool: pg.Pool) {}

  // ---- lists -----------------------------------------------------------------------------------

  async createList(organizationId: string, actor: string, input: { name: unknown; description?: unknown }) {
    const name = validateName(input.name);
    let description: string | null = null;
    if (input.description !== undefined && input.description !== null) {
      if (typeof input.description !== "string" || input.description.length > 500) throw new CommunicationValidationError("description", "must be at most 500 characters");
      description = input.description;
    }
    try {
      const r = await this.pool.query(
        `INSERT INTO public.communication_lists (organization_id, name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [organizationId, name, description, actor],
      );
      return r.rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw new CommunicationValidationError("name", "a list with this name already exists");
      throw e;
    }
  }

  async listLists(organizationId: string) {
    const r = await this.pool.query(
      `SELECT l.id, l.name, l.description, l.created_at,
              (SELECT COUNT(*)::int FROM public.communication_list_members m WHERE m.list_id = l.id) AS member_count
         FROM public.communication_lists l WHERE l.organization_id = $1 ORDER BY l.created_at DESC, l.id`,
      [organizationId],
    );
    return { lists: r.rows };
  }

  private async requireList(organizationId: string, listId: string): Promise<void> {
    const r = await this.pool.query(`SELECT 1 FROM public.communication_lists WHERE id = $1 AND organization_id = $2`, [validateUuid(listId, "listId"), organizationId]);
    if (r.rows.length === 0) throw new AudienceNotFoundError("list");
  }

  async deleteList(organizationId: string, listId: string): Promise<void> {
    const r = await this.pool.query(`DELETE FROM public.communication_lists WHERE id = $1 AND organization_id = $2 RETURNING id`, [validateUuid(listId, "listId"), organizationId]);
    if (r.rows.length === 0) throw new AudienceNotFoundError("list");
  }

  async addMembers(organizationId: string, listId: string, contactIds: unknown) {
    await this.requireList(organizationId, listId);
    const ids = validateUuidList(contactIds, "contactIds", MAX_AUDIENCE());
    // Only THIS organization's live contacts can be added: foreign or deleted ids are reported, never inserted.
    const r = await this.pool.query(
      `INSERT INTO public.communication_list_members (list_id, contact_id, organization_id)
       SELECT $1, c.id, $2 FROM public.contacts c WHERE c.organization_id = $2 AND c.deleted_at IS NULL AND c.id = ANY($3::uuid[])
       ON CONFLICT (list_id, contact_id) DO NOTHING RETURNING contact_id`,
      [listId, organizationId, ids],
    );
    const existing = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM public.contacts c WHERE c.organization_id = $1 AND c.deleted_at IS NULL AND c.id = ANY($2::uuid[])`,
      [organizationId, ids],
    );
    const valid = existing.rows[0].n as number;
    return { added: r.rows.length, alreadyMembers: valid - r.rows.length, notFound: ids.length - valid };
  }

  async removeMembers(organizationId: string, listId: string, contactIds: unknown) {
    await this.requireList(organizationId, listId);
    const ids = validateUuidList(contactIds, "contactIds", MAX_AUDIENCE());
    const r = await this.pool.query(
      `DELETE FROM public.communication_list_members WHERE list_id = $1 AND organization_id = $2 AND contact_id = ANY($3::uuid[]) RETURNING contact_id`,
      [listId, organizationId, ids],
    );
    return { removed: r.rows.length };
  }

  async listMembers(organizationId: string, listId: string, opts: { limit?: number; offset?: number } = {}) {
    await this.requireList(organizationId, listId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const r = await this.pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, co.name AS company
         FROM public.communication_list_members m
         JOIN public.contacts c ON c.id = m.contact_id AND c.organization_id = $2 AND c.deleted_at IS NULL
         LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE m.list_id = $1 AND m.organization_id = $2
        ORDER BY m.added_at DESC, c.id LIMIT $3 OFFSET $4`,
      [listId, organizationId, limit, offset],
    );
    return { members: r.rows, limit, offset };
  }

  // ---- segments --------------------------------------------------------------------------------

  async createSegment(organizationId: string, actor: string, input: { name: unknown; criteria: unknown }) {
    const name = validateName(input.name);
    const criteria = validateCriteria(input.criteria);
    // Every list a segment refers to must belong to this organization (a foreign id is a validation error).
    if (criteria.listIds) await this.assertListsOwned(organizationId, criteria.listIds);
    try {
      const r = await this.pool.query(
        `INSERT INTO public.communication_segments (organization_id, name, criteria, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
        [organizationId, name, JSON.stringify(criteria), actor],
      );
      return r.rows[0];
    } catch (e) {
      if (isUniqueViolation(e)) throw new CommunicationValidationError("name", "a segment with this name already exists");
      throw e;
    }
  }

  async listSegments(organizationId: string) {
    const r = await this.pool.query(`SELECT id, name, criteria, created_at FROM public.communication_segments WHERE organization_id = $1 ORDER BY created_at DESC, id`, [organizationId]);
    return { segments: r.rows };
  }

  async deleteSegment(organizationId: string, segmentId: string): Promise<void> {
    const r = await this.pool.query(`DELETE FROM public.communication_segments WHERE id = $1 AND organization_id = $2 RETURNING id`, [validateUuid(segmentId, "segmentId"), organizationId]);
    if (r.rows.length === 0) throw new AudienceNotFoundError("segment");
  }

  private async assertListsOwned(organizationId: string, listIds: string[]) {
    const r = await this.pool.query(`SELECT COUNT(*)::int AS n FROM public.communication_lists WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [organizationId, listIds]);
    if ((r.rows[0].n as number) !== listIds.length) throw new CommunicationValidationError("criteria.listIds", "contains a list that does not exist in this organization");
  }

  /** Contact ids matching the criteria that have a non-empty address on `channel` (suppression is applied by the caller). */
  async resolveCriteria(organizationId: string, channelInput: unknown, criteriaInput: unknown): Promise<string[]> {
    const channel = validateChannel(channelInput);
    const criteria = validateCriteria(criteriaInput);
    if (criteria.listIds) await this.assertListsOwned(organizationId, criteria.listIds);
    // Column from a fixed two-value mapping, never from input.
    const col = channel === "email" ? "c.email" : "c.phone";
    const params: unknown[] = [organizationId];
    const where: string[] = [`c.organization_id = $1`, `c.deleted_at IS NULL`, `${col} IS NOT NULL`, `${col} <> ''`];
    if (criteria.listIds) {
      params.push(criteria.listIds);
      where.push(`EXISTS (SELECT 1 FROM public.communication_list_members m WHERE m.contact_id = c.id AND m.organization_id = $1 AND m.list_id = ANY($${params.length}::uuid[]))`);
    }
    if (criteria.companyContains) {
      params.push(`%${escapeLike(criteria.companyContains)}%`);
      where.push(`co.name ILIKE $${params.length}`);
    }
    if (criteria.nameContains) {
      params.push(`%${escapeLike(criteria.nameContains)}%`);
      where.push(`(c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length})`);
    }
    if (criteria.createdAfter) {
      params.push(criteria.createdAfter);
      where.push(`c.created_at >= $${params.length}`);
    }
    if (criteria.createdBefore) {
      params.push(criteria.createdBefore);
      where.push(`c.created_at <= $${params.length}`);
    }
    params.push(MAX_AUDIENCE() + 1);
    const r = await this.pool.query(
      `SELECT c.id FROM public.contacts c LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC, c.id LIMIT $${params.length}`,
      params,
    );
    if (r.rows.length > MAX_AUDIENCE()) {
      throw new CommunicationValidationError("criteria", `matches more than ${MAX_AUDIENCE()} contacts; narrow the segment`);
    }
    return r.rows.map((x: { id: string }) => x.id);
  }

  async resolveSegment(organizationId: string, channel: unknown, segmentId: string): Promise<string[]> {
    const r = await this.pool.query(`SELECT criteria FROM public.communication_segments WHERE id = $1 AND organization_id = $2`, [validateUuid(segmentId, "segmentId"), organizationId]);
    if (r.rows.length === 0) throw new AudienceNotFoundError("segment");
    return this.resolveCriteria(organizationId, channel, r.rows[0].criteria);
  }

  async resolveList(organizationId: string, channelInput: unknown, listId: string): Promise<string[]> {
    const channel = validateChannel(channelInput);
    await this.requireList(organizationId, listId);
    const col = channel === "email" ? "c.email" : "c.phone";
    const r = await this.pool.query(
      `SELECT c.id FROM public.communication_list_members m
         JOIN public.contacts c ON c.id = m.contact_id AND c.organization_id = $2 AND c.deleted_at IS NULL
        WHERE m.list_id = $1 AND m.organization_id = $2 AND ${col} IS NOT NULL AND ${col} <> ''
        ORDER BY m.added_at, c.id LIMIT $3`,
      [listId, organizationId, MAX_AUDIENCE() + 1],
    );
    if (r.rows.length > MAX_AUDIENCE()) throw new CommunicationValidationError("listId", `has more than ${MAX_AUDIENCE()} contacts for this channel`);
    return r.rows.map((x: { id: string }) => x.id);
  }

  /** Read-only preview: how many contacts the criteria match, how many of those are suppressed, and a small sample. */
  async previewSegment(organizationId: string, channelInput: unknown, criteriaInput: unknown) {
    const channel = validateChannel(channelInput) as ChannelType;
    const ids = await this.resolveCriteria(organizationId, channel, criteriaInput);
    if (ids.length === 0) return { matched: 0, suppressed: 0, sample: [] };
    const col = channel === "email" ? "email" : "phone";
    const rows = await this.pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.${col} AS address, co.name AS company
         FROM public.contacts c LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE c.organization_id = $1 AND c.id = ANY($2::uuid[]) ORDER BY c.created_at DESC, c.id`,
      [organizationId, ids],
    );
    // One set-based query: addresses are compared in their normalized form (emails lower-cased, phones trimmed).
    const norm = channel === "email" ? "lower(btrim(c.email))" : "btrim(c.phone)";
    const sup = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM public.contacts c
        WHERE c.organization_id = $1 AND c.id = ANY($2::uuid[])
          AND EXISTS (SELECT 1 FROM public.communication_suppressions s
                       WHERE s.organization_id = $1 AND s.channel_type = $3 AND s.address = ${norm})`,
      [organizationId, ids, channel],
    );
    const suppressed = sup.rows[0].n as number;
    return {
      matched: ids.length,
      suppressed,
      sample: (rows.rows as any[]).slice(0, 5).map((r) => ({ id: r.id, name: [r.first_name, r.last_name].filter(Boolean).join(" ") || r.address, company: r.company })),
    };
  }
}
