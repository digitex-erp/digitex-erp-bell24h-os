/**
 * Suppression lists: addresses that must never be contacted on a channel.
 *
 * Enforcement points (each independent, so no single one is load-bearing):
 *   1. CampaignService.createCampaign  — suppressed addresses never enter an audience.
 *   2. CommunicationService.sendMessage — a direct or test send to a suppressed address is refused (422).
 *   3. CommunicationJobHandler          — checked again immediately before the provider call, so an
 *                                         unsubscribe that arrives after a message was queued is honoured.
 *
 * Adding is low-risk (it only prevents sends). REMOVING re-enables contacting someone who opted out, so the
 * route requires ADMIN and is audited.
 */

import type pg from "pg";
import { emitAuditEvent, newRequestId } from "../audit.js";
import type { ChannelType } from "./types.js";
import {
  CommunicationValidationError,
  validateChannel,
  validateEmailAddress,
  validatePhoneNumber,
  validateUuid,
} from "./validation.js";

export const SUPPRESSION_REASONS = ["unsubscribed", "bounced", "complained", "manual", "invalid"] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export class SuppressedRecipientError extends Error {
  readonly code = "recipient_suppressed";
  constructor(public readonly reason: string) {
    super(`Recipient is on this organization's suppression list (${reason}); nothing was sent.`);
  }
}

export class SuppressionNotFoundError extends Error {
  constructor() {
    super("Suppression not found in this organization.");
  }
}

/** Canonical form used for storage AND comparison: emails lower-cased, phones in E.164. Throws on invalid input. */
export function normalizeAddress(channel: ChannelType, address: unknown): string {
  return channel === "email" ? validateEmailAddress(address, "address").toLowerCase() : validatePhoneNumber(address, "address");
}

type Queryable = Pick<pg.Pool, "query">;

/** The suppression reason for this address, or null. Never throws on a malformed address: it cannot match. */
export async function findSuppression(db: Queryable, organizationId: string, channel: ChannelType, address: string): Promise<string | null> {
  let normalized: string;
  try {
    normalized = normalizeAddress(channel, address);
  } catch {
    return null;
  }
  const r = await db.query(
    `SELECT reason FROM public.communication_suppressions WHERE organization_id = $1 AND channel_type = $2 AND address = $3`,
    [organizationId, channel, normalized],
  );
  return r.rows[0]?.reason ?? null;
}

export async function assertNotSuppressed(db: Queryable, organizationId: string, channel: ChannelType, address: string): Promise<void> {
  const reason = await findSuppression(db, organizationId, channel, address);
  if (reason) throw new SuppressedRecipientError(reason);
}

export interface SuppressionRow {
  id: string;
  channel_type: ChannelType;
  address: string;
  reason: SuppressionReason;
  source: string | null;
  note: string | null;
  created_at: string;
}

const MAX_BULK = 1000;

export class SuppressionService {
  constructor(private pool: pg.Pool) {}

  async list(organizationId: string, opts: { channelType?: unknown; q?: unknown; reason?: unknown; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const params: unknown[] = [organizationId];
    let where = "organization_id = $1";
    if (opts.channelType !== undefined) {
      params.push(validateChannel(opts.channelType));
      where += ` AND channel_type = $${params.length}`;
    }
    if (opts.reason !== undefined) {
      if (typeof opts.reason !== "string" || !(SUPPRESSION_REASONS as readonly string[]).includes(opts.reason)) {
        throw new CommunicationValidationError("reason", `must be one of: ${SUPPRESSION_REASONS.join(", ")}`);
      }
      params.push(opts.reason);
      where += ` AND reason = $${params.length}`;
    }
    if (typeof opts.q === "string" && opts.q.trim() !== "") {
      params.push(`%${opts.q.trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where += ` AND address ILIKE $${params.length}`;
    }
    const total = await this.pool.query(`SELECT COUNT(*)::int AS n FROM public.communication_suppressions WHERE ${where}`, params);
    params.push(limit, offset);
    const rows = await this.pool.query(
      `SELECT id, channel_type, address, reason, source, note, created_at FROM public.communication_suppressions
        WHERE ${where} ORDER BY created_at DESC, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { suppressions: rows.rows as SuppressionRow[], total: total.rows[0].n as number, limit, offset };
  }

  /**
   * Adds addresses (idempotent: an address already suppressed is left exactly as it was — its original reason
   * is kept). Invalid addresses are reported, not silently dropped, and do not abort the valid ones.
   */
  async add(
    organizationId: string,
    actor: string | null,
    input: { channelType: unknown; addresses: unknown; reason?: unknown; note?: unknown; source?: string },
  ) {
    const channel = validateChannel(input.channelType);
    if (!Array.isArray(input.addresses) || input.addresses.length === 0) throw new CommunicationValidationError("addresses", "must be a non-empty array");
    if (input.addresses.length > MAX_BULK) throw new CommunicationValidationError("addresses", `must contain at most ${MAX_BULK} items`);
    const reason = input.reason === undefined ? "manual" : input.reason;
    if (typeof reason !== "string" || !(SUPPRESSION_REASONS as readonly string[]).includes(reason)) {
      throw new CommunicationValidationError("reason", `must be one of: ${SUPPRESSION_REASONS.join(", ")}`);
    }
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
      if (typeof input.note !== "string" || input.note.length > 500) throw new CommunicationValidationError("note", "must be a string of at most 500 characters");
      note = input.note;
    }

    const valid: string[] = [];
    const invalid: string[] = [];
    for (const a of input.addresses) {
      try {
        const n = normalizeAddress(channel, a);
        if (!valid.includes(n)) valid.push(n);
      } catch {
        invalid.push(typeof a === "string" ? a.slice(0, 60).replace(/[\u0000-\u001F\u007F]/g, "?") : String(a).slice(0, 20));
      }
    }
    let added = 0;
    if (valid.length > 0) {
      const r = await this.pool.query(
        `INSERT INTO public.communication_suppressions (organization_id, channel_type, address, reason, source, note, created_by)
         SELECT $1, $2, a, $3, $4, $5, $6 FROM unnest($7::text[]) AS a
         ON CONFLICT (organization_id, channel_type, address) DO NOTHING
         RETURNING id`,
        [organizationId, channel, reason, input.source ?? "operator", note, actor, valid],
      );
      added = r.rows.length;
    }
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.suppression.added",
      targetType: "communication_suppression",
      targetId: "bulk",
      outcome: "success",
      requestId: newRequestId(),
      // counts and reason only: the addresses themselves are personal data and stay out of the audit stream
      metadata: { channel, reason, added, alreadySuppressed: valid.length - added, invalid: invalid.length },
    });
    return { added, alreadySuppressed: valid.length - added, invalid };
  }

  /** Adds ONE address from a public unsubscribe link. Idempotent; never overwrites an existing reason. */
  async addFromUnsubscribe(organizationId: string, channel: ChannelType, address: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO public.communication_suppressions (organization_id, channel_type, address, reason, source)
       VALUES ($1, $2, $3, 'unsubscribed', 'unsubscribe_link') ON CONFLICT (organization_id, channel_type, address) DO NOTHING`,
      [organizationId, channel, normalizeAddress(channel, address)],
    );
    emitAuditEvent({
      actor: "public:unsubscribe_link",
      organizationId,
      action: "communication.suppression.added",
      targetType: "communication_suppression",
      targetId: "unsubscribe_link",
      outcome: "success",
      requestId: newRequestId(),
      metadata: { channel, reason: "unsubscribed" },
    });
  }

  async remove(organizationId: string, actor: string | null, id: string): Promise<void> {
    const r = await this.pool.query(
      `DELETE FROM public.communication_suppressions WHERE id = $1 AND organization_id = $2 RETURNING channel_type, reason`,
      [validateUuid(id, "id"), organizationId],
    );
    if (r.rows.length === 0) throw new SuppressionNotFoundError();
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.suppression.removed",
      targetType: "communication_suppression",
      targetId: id,
      outcome: "success",
      requestId: newRequestId(),
      metadata: { channel: r.rows[0].channel_type, previousReason: r.rows[0].reason },
    });
  }
}
