/**
 * CampaignService — the Communication Hub campaign flow (Sprint CH-02):
 *
 *   Select leads -> Create campaign -> Send test -> Schedule -> Execute
 *
 * Design rules (each one exists because the alternative would be a mock or an unsafe default):
 *
 *  - NOTHING here talks to a provider. Every message goes through CommunicationService.sendMessage(),
 *    so validation, per-organization quotas, idempotency keys and the job_queue/worker/provider
 *    path are exactly those of a single send. A campaign is a controlled way of creating many
 *    normal messages, not a second sending path.
 *
 *  - A campaign cannot be scheduled or executed until a TEST message (a real send to one operator-
 *    chosen address) has been observed at status 'sent' or 'delivered'. With no configured, working
 *    provider that never happens, so the flow fails closed instead of pretending.
 *
 *  - The operator must attest that recipients have consented / there is a lawful basis
 *    (consent_confirmed_by/at). contacts carries no consent field, so the system cannot know.
 *
 *  - Execution runs in the worker (CommunicationJobHandler -> runBatch), in bounded batches, so a
 *    large audience never runs inside an HTTP request and a crash is repaired by replay: every
 *    per-recipient message uses a deterministic idempotency key (camp:<campaign>:<recipient>).
 *
 *  - Status is derived from real message outcomes (reconcile), never set optimistically. A message
 *    that failed but can still be retried by job_queue is NOT terminal; only dead_letter is.
 */

import type pg from "pg";
import { QueueManager } from "../queue/QueueManager.js";
import { emitAuditEvent, newRequestId } from "../audit.js";
import { CommunicationService, QuotaExceededError } from "./CommunicationService.js";
import { AudienceService } from "./AudienceService.js";
import { SuppressedRecipientError } from "./SuppressionService.js";
import { buildUnsubscribeUrl, getUnsubscribeConfig } from "./unsubscribe.js";
import type { ChannelType, CommunicationMessage } from "./types.js";
import {
  CommunicationValidationError,
  validateCampaignName,
  validateChannel,
  validateEmailAddress,
  validatePhoneNumber,
  validateRecipient,
  validateScheduledAt,
  validateUuid,
  validateUuidList,
  validateVariables,
} from "./validation.js";

export class CampaignNotFoundError extends Error {
  constructor() {
    super("Campaign not found in this organization.");
  }
}

export class CampaignStateError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CampaignRow {
  id: string;
  organization_id: string;
  name: string;
  channel_type: ChannelType;
  template_id: string | null;
  status: "draft" | "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled";
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  variables: Record<string, unknown>;
  consent_confirmed_by: string | null;
  consent_confirmed_at: string | null;
  last_test_message_id: string | null;
  run_count: number;
  started_at: string | null;
  completed_at: string | null;
  paused_reason: string | null;
  audience: { type: "contacts" | "list" | "segment"; id?: string } | null;
  audience_summary: CampaignAudienceSummary | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignAudienceSummary {
  requested: number;
  resolved: number;
  notFound: number;
  invalidAddress: number;
  duplicate: number;
  /** Excluded because the address is on the organization's suppression list. */
  suppressed: number;
}

export interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  /** True when the address for the requested channel passes the same validation a send would apply. */
  usable: boolean;
}

export interface CampaignDetail {
  campaign: CampaignRow;
  recipientCounts: Record<string, number>;
  lastTest: { id: string; status: string; recipient: string; error_message: string | null; created_at: string } | null;
  /** True only when a real test message has reached 'sent' / 'delivered'. Scheduling and execution require it. */
  testVerified: boolean;
  /** Email campaigns need a signed unsubscribe link; false means COMM_UNSUBSCRIBE_SECRET / COMM_PUBLIC_BASE_URL are not set. */
  unsubscribeReady: boolean;
}

export interface CreateCampaignInput {
  organizationId: string;
  createdBy: string;
  name: unknown;
  channelType: unknown;
  templateId: unknown;
  /** Exactly ONE of contactIds / listId / segmentId selects the audience. */
  contactIds?: unknown;
  listId?: unknown;
  segmentId?: unknown;
  variables?: unknown;
  consentConfirmed: unknown;
}

export interface CreateCampaignResult {
  campaign: CampaignRow;
  audience: CampaignAudienceSummary;
}

const MAX_RECIPIENTS = () => {
  const n = Number(process.env.COMM_CAMPAIGN_MAX_RECIPIENTS);
  return Number.isInteger(n) && n > 0 ? n : 5000;
};
const BATCH_SIZE = () => {
  const n = Number(process.env.COMM_CAMPAIGN_BATCH_SIZE);
  return Number.isInteger(n) && n > 0 && n <= 1000 ? n : 100;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function contactAddress(channel: ChannelType, c: { email: string | null; phone: string | null }): string | null {
  return channel === "email" ? c.email : c.phone;
}

/** Returns the validated address, or null when the stored value is unusable for this channel. */
function usableAddress(channel: ChannelType, raw: string | null): string | null {
  if (!raw) return null;
  try {
    return channel === "email" ? validateEmailAddress(raw.trim()) : validatePhoneNumber(raw.trim());
  } catch {
    return null;
  }
}

export class CampaignService {
  private pool: pg.Pool;
  private queue: QueueManager;
  private comms: CommunicationService;
  private audience: AudienceService;

  constructor(pool: pg.Pool) {
    this.pool = pool;
    this.queue = QueueManager.getInstance(pool);
    this.comms = new CommunicationService(pool);
    this.audience = new AudienceService(pool);
  }

  /**
   * The variables that make an email campaign message legal to send: the recipient's signed one-click
   * unsubscribe link. Throws when the link cannot be built — email campaigns fail closed without it.
   */
  private unsubscribeVariables(campaign: Pick<CampaignRow, "organization_id" | "channel_type">, address: string): Record<string, string> {
    if (campaign.channel_type !== "email") return {};
    const cfg = getUnsubscribeConfig();
    if (!cfg) {
      throw new CampaignStateError(
        "unsubscribe_not_configured",
        "Email campaigns need a one-click unsubscribe link: set COMM_UNSUBSCRIBE_SECRET (16+ characters) and COMM_PUBLIC_BASE_URL on the server.",
      );
    }
    return { unsubscribe_url: buildUnsubscribeUrl(cfg, { organizationId: campaign.organization_id, channel: "email", address: address.toLowerCase() }) };
  }

  // ---------------------------------------------------------------------------------------------
  // 1. Select leads
  // ---------------------------------------------------------------------------------------------

  /**
   * "Leads" are the organization's own `contacts` rows that have an address for the channel. There is
   * no `leads` table in this schema; `contacts` (with `companies`) is the only person-level source.
   */
  async listLeads(
    organizationId: string,
    opts: { channelType: unknown; q?: unknown; limit?: number; offset?: number },
  ): Promise<{ leads: LeadRow[]; limit: number; offset: number }> {
    const channel = validateChannel(opts.channelType);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    // The column comes from a fixed two-value mapping, never from input.
    const col = channel === "email" ? "c.email" : "c.phone";

    const params: unknown[] = [organizationId];
    let search = "";
    if (typeof opts.q === "string" && opts.q.trim() !== "") {
      params.push(`%${escapeLike(opts.q.trim().slice(0, 100))}%`);
      search = `AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.email ILIKE $2 OR co.name ILIKE $2)`;
    }
    params.push(limit, offset);
    const res = await this.pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, co.name AS company
         FROM public.contacts c
         LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE c.organization_id = $1 AND c.deleted_at IS NULL
          AND ${col} IS NOT NULL AND ${col} <> ''
          ${search}
        ORDER BY c.created_at DESC, c.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const leads = (res.rows as Omit<LeadRow, "usable">[]).map((r) => ({
      ...r,
      usable: usableAddress(channel, contactAddress(channel, r)) !== null,
    }));
    return { leads, limit, offset };
  }

  // ---------------------------------------------------------------------------------------------
  // 2. Create campaign (draft)
  // ---------------------------------------------------------------------------------------------

  async createCampaign(input: CreateCampaignInput): Promise<CreateCampaignResult> {
    const requestId = newRequestId();
    const organizationId = input.organizationId;
    const name = validateCampaignName(input.name);
    const channelType = validateChannel(input.channelType);
    const templateId = validateUuid(input.templateId, "templateId");
    const provided = [input.contactIds !== undefined, input.listId !== undefined, input.segmentId !== undefined].filter(Boolean).length;
    if (provided !== 1) {
      throw new CommunicationValidationError("audience", "provide exactly one of contactIds, listId or segmentId");
    }
    let audienceRef: NonNullable<CampaignRow["audience"]> = { type: "contacts" };
    let contactIds: string[];
    if (input.listId !== undefined) {
      const listId = validateUuid(input.listId, "listId");
      contactIds = await this.audience.resolveList(organizationId, channelType, listId);
      audienceRef = { type: "list", id: listId };
    } else if (input.segmentId !== undefined) {
      const segmentId = validateUuid(input.segmentId, "segmentId");
      contactIds = await this.audience.resolveSegment(organizationId, channelType, segmentId);
      audienceRef = { type: "segment", id: segmentId };
    } else {
      contactIds = validateUuidList(input.contactIds, "contactIds", MAX_RECIPIENTS());
    }
    if (contactIds.length === 0) {
      throw new CommunicationValidationError(audienceRef.type === "contacts" ? "contactIds" : audienceRef.type === "list" ? "listId" : "segmentId", `no contact has a usable ${channelType} address`);
    }
    const variables = validateVariables(input.variables);
    if (input.consentConfirmed !== true) {
      throw new CommunicationValidationError(
        "consentConfirmed",
        "must be true: confirm that every recipient has opted in or there is another lawful basis to contact them",
      );
    }

    const tpl = await this.pool.query(
      `SELECT id, channel_type, body FROM public.communication_templates WHERE id = $1 AND organization_id = $2 AND is_active = true`,
      [templateId, organizationId],
    );
    if (tpl.rows.length === 0) throw new CommunicationValidationError("templateId", "template not found or inactive for this organization");
    if (tpl.rows[0].channel_type !== channelType) {
      throw new CommunicationValidationError("templateId", `template is for channel "${tpl.rows[0].channel_type}", not "${channelType}"`);
    }

    if (channelType === "email" && !/\{\{\s*unsubscribe_url\s*\}\}/.test(String(tpl.rows[0].body))) {
      throw new CommunicationValidationError(
        "templateId",
        "email campaign templates must include the {{unsubscribe_url}} placeholder (every campaign email carries a one-click unsubscribe link)",
      );
    }

    const found = await this.pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, co.name AS company
         FROM public.contacts c
         LEFT JOIN public.companies co ON co.id = c.company_id
        WHERE c.organization_id = $1 AND c.deleted_at IS NULL AND c.id = ANY($2::uuid[])`,
      [organizationId, contactIds],
    );

    const seen = new Set<string>();
    const rows: { contactId: string; recipient: string; displayName: string; variables: string }[] = [];
    let invalidAddress = 0;
    let duplicate = 0;
    for (const c of found.rows as Omit<LeadRow, "usable">[]) {
      const addr = usableAddress(channelType, contactAddress(channelType, c));
      if (!addr) {
        invalidAddress++;
        continue;
      }
      const dedupeKey = channelType === "email" ? addr.toLowerCase() : addr;
      if (seen.has(dedupeKey)) {
        duplicate++;
        continue;
      }
      seen.add(dedupeKey);
      const displayName = [c.first_name, c.last_name].filter(Boolean).join(" ") || addr;
      rows.push({
        contactId: c.id,
        recipient: addr,
        displayName,
        variables: JSON.stringify({ first_name: c.first_name ?? "", last_name: c.last_name ?? "", company: c.company ?? "" }),
      });
    }
    // Suppressed addresses never enter the audience (checked again at send time for later suppressions).
    let suppressed = 0;
    if (rows.length > 0) {
      const sup = await this.pool.query(
        `SELECT address FROM public.communication_suppressions WHERE organization_id = $1 AND channel_type = $2 AND address = ANY($3::text[])`,
        [organizationId, channelType, rows.map((r) => (channelType === "email" ? r.recipient.toLowerCase() : r.recipient))],
      );
      const blocked = new Set((sup.rows as { address: string }[]).map((r) => r.address));
      for (let i = rows.length - 1; i >= 0; i--) {
        if (blocked.has(channelType === "email" ? rows[i].recipient.toLowerCase() : rows[i].recipient)) {
          rows.splice(i, 1);
          suppressed++;
        }
      }
    }
    const audience: CampaignAudienceSummary = {
      requested: contactIds.length,
      resolved: rows.length,
      notFound: contactIds.length - found.rows.length,
      invalidAddress,
      duplicate,
      suppressed,
    };
    if (rows.length === 0) {
      throw new CommunicationValidationError(
        "audience",
        suppressed > 0
          ? `every matching lead is suppressed or has no valid ${channelType} address (${suppressed} suppressed)`
          : `none of the selected leads has a valid ${channelType} address`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const created = await client.query(
        `INSERT INTO public.communication_campaigns
           (organization_id, name, channel_type, template_id, status, total_recipients, variables,
            consent_confirmed_by, consent_confirmed_at, created_by, audience, audience_summary)
         VALUES ($1,$2,$3,$4,'draft',$5,$6,$7,NOW(),$7,$8,$9) RETURNING *`,
        [organizationId, name, channelType, templateId, rows.length, JSON.stringify(variables), input.createdBy, JSON.stringify(audienceRef), JSON.stringify(audience)],
      );
      const campaign = created.rows[0] as CampaignRow;
      await client.query(
        `INSERT INTO public.communication_campaign_recipients
           (organization_id, campaign_id, contact_id, recipient, display_name, variables)
         SELECT $1, $2, t.contact_id, t.recipient, t.display_name, t.variables::jsonb
           FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[]) AS t(contact_id, recipient, display_name, variables)`,
        [
          organizationId,
          campaign.id,
          rows.map((r) => r.contactId),
          rows.map((r) => r.recipient),
          rows.map((r) => r.displayName),
          rows.map((r) => r.variables),
        ],
      );
      await client.query("COMMIT");

      emitAuditEvent({
        actor: input.createdBy,
        organizationId,
        action: "communication.campaign.created",
        targetType: "communication_campaign",
        targetId: campaign.id,
        outcome: "success",
        requestId,
        metadata: { channelType, ...audience, audienceType: audienceRef.type, consentAttested: true },
      });
      return { campaign, audience };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------------------------

  private async requireCampaign(organizationId: string, campaignId: string): Promise<CampaignRow> {
    const id = validateUuid(campaignId, "campaignId");
    const res = await this.pool.query(`SELECT * FROM public.communication_campaigns WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
    if (res.rows.length === 0) throw new CampaignNotFoundError();
    return res.rows[0] as CampaignRow;
  }

  async listCampaigns(
    organizationId: string,
    opts: { status?: unknown; limit?: number; offset?: number } = {},
  ): Promise<{ campaigns: CampaignRow[]; limit: number; offset: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const params: unknown[] = [organizationId];
    let where = "organization_id = $1";
    if (opts.status !== undefined) {
      const allowed = ["draft", "scheduled", "running", "paused", "completed", "failed", "cancelled"];
      if (typeof opts.status !== "string" || !allowed.includes(opts.status)) {
        throw new CommunicationValidationError("status", `must be one of: ${allowed.join(", ")}`);
      }
      params.push(opts.status);
      where += ` AND status = $${params.length}`;
    }
    params.push(limit, offset);
    const res = await this.pool.query(
      `SELECT * FROM public.communication_campaigns WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { campaigns: res.rows as CampaignRow[], limit, offset };
  }

  async getCampaign(organizationId: string, campaignId: string): Promise<CampaignDetail> {
    const campaign = await this.requireCampaign(organizationId, campaignId);
    const counts = await this.pool.query(
      `SELECT status, COUNT(*)::int AS n FROM public.communication_campaign_recipients WHERE campaign_id = $1 GROUP BY status`,
      [campaign.id],
    );
    const recipientCounts: Record<string, number> = { pending: 0, queued: 0, sent: 0, failed: 0, cancelled: 0, suppressed: 0 };
    for (const r of counts.rows as { status: string; n: number }[]) recipientCounts[r.status] = r.n;

    let lastTest: CampaignDetail["lastTest"] = null;
    if (campaign.last_test_message_id) {
      const t = await this.pool.query(
        `SELECT id, status, recipient, error_message, created_at FROM public.communication_messages WHERE id = $1 AND organization_id = $2`,
        [campaign.last_test_message_id, organizationId],
      );
      lastTest = (t.rows[0] as CampaignDetail["lastTest"]) ?? null;
    }
    return {
      campaign,
      recipientCounts,
      lastTest,
      testVerified: lastTest !== null && ["sent", "delivered"].includes(lastTest.status),
      unsubscribeReady: campaign.channel_type !== "email" || getUnsubscribeConfig() !== null,
    };
  }

  async listRecipients(
    organizationId: string,
    campaignId: string,
    opts: { status?: unknown; limit?: number; offset?: number } = {},
  ) {
    const campaign = await this.requireCampaign(organizationId, campaignId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const params: unknown[] = [campaign.id, organizationId];
    let where = "campaign_id = $1 AND organization_id = $2";
    if (opts.status !== undefined) {
      const allowed = ["pending", "queued", "sent", "failed", "cancelled", "suppressed"];
      if (typeof opts.status !== "string" || !allowed.includes(opts.status)) {
        throw new CommunicationValidationError("status", `must be one of: ${allowed.join(", ")}`);
      }
      params.push(opts.status);
      where += ` AND status = $${params.length}`;
    }
    params.push(limit, offset);
    const res = await this.pool.query(
      `SELECT id, contact_id, recipient, display_name, status, message_id, error_message, updated_at
         FROM public.communication_campaign_recipients WHERE ${where}
        ORDER BY created_at, id LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { recipients: res.rows, limit, offset };
  }

  // ---------------------------------------------------------------------------------------------
  // 3. Send test
  // ---------------------------------------------------------------------------------------------

  /**
   * A REAL send to one address the operator names. It goes through the normal pipeline (quota, queue,
   * worker, provider); this method only enqueues it. Whether it worked is learned later, from the
   * message status — see CampaignDetail.testVerified.
   */
  async sendTest(
    organizationId: string,
    actor: string,
    campaignId: string,
    testRecipient: unknown,
    idempotencyKey: string,
  ): Promise<CommunicationMessage & { deduplicated: boolean }> {
    const campaign = await this.requireCampaign(organizationId, campaignId);
    if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
      throw new CampaignStateError("invalid_state", `A test cannot be sent while the campaign is "${campaign.status}".`);
    }
    const recipient = validateRecipient(campaign.channel_type, testRecipient);
    if (!campaign.template_id) throw new CampaignStateError("no_template", "Campaign has no template.");

    const message = await this.comms.sendMessage({
      organizationId,
      channelType: campaign.channel_type,
      recipient,
      templateId: campaign.template_id,
      campaignId: campaign.id,
      variables: {
        ...campaign.variables,
        first_name: "Test",
        last_name: "Recipient",
        company: "Test Company",
        ...this.unsubscribeVariables(campaign, recipient),
      } as Record<string, unknown>,
      createdBy: actor,
      idempotencyKey,
      isTest: true,
    });

    if (!message.deduplicated) {
      await this.pool.query(
        `UPDATE public.communication_campaigns SET last_test_message_id = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
        [message.id, campaign.id, organizationId],
      );
    }
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.campaign.test_sent",
      targetType: "communication_campaign",
      targetId: campaign.id,
      outcome: "success",
      requestId: newRequestId(),
      metadata: { messageId: message.id, deduplicated: message.deduplicated },
    });
    return message;
  }

  // ---------------------------------------------------------------------------------------------
  // 4/5. Schedule and execute
  // ---------------------------------------------------------------------------------------------

  /** Gate shared by schedule and execute. Throws unless the campaign is safe to send. */
  private async assertRunnable(campaign: CampaignRow): Promise<void> {
    if (!campaign.consent_confirmed_at) {
      throw new CampaignStateError("consent_missing", "Recipient consent / lawful basis has not been confirmed for this campaign.");
    }
    if (campaign.total_recipients < 1) throw new CampaignStateError("no_recipients", "Campaign has no recipients.");
    if (campaign.channel_type === "email" && !getUnsubscribeConfig()) {
      throw new CampaignStateError(
        "unsubscribe_not_configured",
        "Email campaigns need a one-click unsubscribe link: set COMM_UNSUBSCRIBE_SECRET (16+ characters) and COMM_PUBLIC_BASE_URL on the server.",
      );
    }
    const detail = await this.getCampaign(campaign.organization_id, campaign.id);
    if (!detail.testVerified) {
      throw new CampaignStateError(
        "test_not_verified",
        detail.lastTest
          ? `The last test message is "${detail.lastTest.status}", not sent. Fix the provider/configuration and send another test before scheduling or executing.`
          : "Send a test message and wait for it to be sent before scheduling or executing.",
      );
    }
  }

  private runKey(campaignId: string, run: number) {
    return `camp-run:${campaignId}:${run}`;
  }

  /** Cancels the campaign's not-yet-started run job (the one enqueued by the most recent schedule/execute). */
  private async cancelPendingRunJob(campaign: CampaignRow): Promise<void> {
    if (campaign.run_count < 1) return;
    await this.pool.query(
      `UPDATE public.job_queue SET status = 'cancelled', updated_at = NOW()
        WHERE organization_id = $1 AND idempotency_key = $2 AND status IN ('queued', 'blocked')`,
      [campaign.organization_id, this.runKey(campaign.id, campaign.run_count)],
    );
  }

  async schedule(organizationId: string, actor: string, campaignId: string, scheduledAtRaw: unknown): Promise<CampaignRow> {
    const campaign = await this.requireCampaign(organizationId, campaignId);
    if (!["draft", "scheduled"].includes(campaign.status)) {
      throw new CampaignStateError("invalid_state", `A "${campaign.status}" campaign cannot be scheduled.`);
    }
    const scheduledAt = validateScheduledAt(scheduledAtRaw);
    await this.assertRunnable(campaign);
    await this.cancelPendingRunJob(campaign);

    const run = campaign.run_count + 1;
    await this.queue.enqueueJob({
      organizationId,
      jobType: "communication",
      payload: { campaignId: campaign.id, run },
      priority: "medium",
      scheduledAt,
      idempotencyKey: this.runKey(campaign.id, run),
    });
    const upd = await this.pool.query(
      `UPDATE public.communication_campaigns
          SET status = 'scheduled', scheduled_at = $1, run_count = $2, paused_reason = NULL, updated_at = NOW()
        WHERE id = $3 AND organization_id = $4 RETURNING *`,
      [scheduledAt, run, campaign.id, organizationId],
    );
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.campaign.scheduled",
      targetType: "communication_campaign",
      targetId: campaign.id,
      outcome: "success",
      requestId: newRequestId(),
      metadata: { scheduledAt: scheduledAt.toISOString(), run },
    });
    return upd.rows[0] as CampaignRow;
  }

  /** Starts (or resumes, after a quota pause) execution now. The work itself happens in the worker. */
  async execute(organizationId: string, actor: string, campaignId: string): Promise<CampaignRow> {
    const campaign = await this.requireCampaign(organizationId, campaignId);
    if (!["draft", "scheduled", "paused"].includes(campaign.status)) {
      throw new CampaignStateError("invalid_state", `A "${campaign.status}" campaign cannot be executed.`);
    }
    await this.assertRunnable(campaign);
    await this.cancelPendingRunJob(campaign);

    const run = campaign.run_count + 1;
    await this.queue.enqueueJob({
      organizationId,
      jobType: "communication",
      payload: { campaignId: campaign.id, run },
      priority: "high",
      idempotencyKey: this.runKey(campaign.id, run),
    });
    const upd = await this.pool.query(
      `UPDATE public.communication_campaigns
          SET status = 'running', run_count = $1, paused_reason = NULL, started_at = COALESCE(started_at, NOW()), updated_at = NOW()
        WHERE id = $2 AND organization_id = $3 RETURNING *`,
      [run, campaign.id, organizationId],
    );
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.campaign.execute_requested",
      targetType: "communication_campaign",
      targetId: campaign.id,
      outcome: "success",
      requestId: newRequestId(),
      metadata: { run },
    });
    return upd.rows[0] as CampaignRow;
  }

  async cancel(organizationId: string, actor: string, campaignId: string): Promise<CampaignRow> {
    const campaign = await this.requireCampaign(organizationId, campaignId);
    if (["completed", "failed", "cancelled"].includes(campaign.status)) {
      throw new CampaignStateError("invalid_state", `A "${campaign.status}" campaign cannot be cancelled.`);
    }
    await this.cancelPendingRunJob(campaign);
    // Stop what has not been sent yet: pending recipients, and non-test messages still waiting in the queue.
    await this.pool.query(
      `UPDATE public.communication_campaign_recipients SET status = 'cancelled', updated_at = NOW()
        WHERE campaign_id = $1 AND organization_id = $2 AND status = 'pending'`,
      [campaign.id, organizationId],
    );
    await this.pool.query(
      `UPDATE public.job_queue SET status = 'cancelled', updated_at = NOW()
        WHERE organization_id = $2 AND status IN ('queued', 'blocked')
          AND id IN (SELECT job_id FROM public.communication_messages
                      WHERE campaign_id = $1 AND organization_id = $2 AND NOT is_test AND status IN ('queued', 'scheduled') AND job_id IS NOT NULL)`,
      [campaign.id, organizationId],
    );
    await this.pool.query(
      `UPDATE public.communication_messages SET status = 'cancelled', updated_at = NOW()
        WHERE campaign_id = $1 AND organization_id = $2 AND NOT is_test AND status IN ('queued', 'scheduled')`,
      [campaign.id, organizationId],
    );
    await this.syncRecipientsFromMessages(organizationId, campaign.id);
    const upd = await this.pool.query(
      `UPDATE public.communication_campaigns SET status = 'cancelled', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [campaign.id, organizationId],
    );
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.campaign.cancelled",
      targetType: "communication_campaign",
      targetId: campaign.id,
      outcome: "success",
      requestId: newRequestId(),
    });
    return upd.rows[0] as CampaignRow;
  }

  // ---------------------------------------------------------------------------------------------
  // Worker side: expand a campaign into messages, one bounded batch per job
  // ---------------------------------------------------------------------------------------------

  /**
   * Called by CommunicationJobHandler for a job whose payload is { campaignId, run }.
   * Returns a summary; throws only for unexpected (retryable) errors — a replay is safe because
   * every message carries the deterministic key camp:<campaign>:<recipient>.
   */
  async runBatch(organizationId: string, campaignId: string, run: number): Promise<Record<string, unknown>> {
    const requestId = newRequestId();
    let campaign: CampaignRow;
    try {
      campaign = await this.requireCampaign(organizationId, campaignId);
    } catch (err) {
      if (err instanceof CampaignNotFoundError) return { skipped: true, reason: "campaign_not_found" };
      throw err;
    }
    if (!["scheduled", "running"].includes(campaign.status)) return { skipped: true, reason: `campaign_${campaign.status}` };
    // A job for an older run (rescheduled / replaced) must not execute.
    if (run !== campaign.run_count) return { skipped: true, reason: "superseded_run" };

    if (campaign.status === "scheduled") {
      await this.pool.query(
        `UPDATE public.communication_campaigns SET status = 'running', started_at = COALESCE(started_at, NOW()), updated_at = NOW()
          WHERE id = $1 AND organization_id = $2`,
        [campaign.id, organizationId],
      );
    }
    if (!campaign.template_id) throw new Error("Campaign has no template.");

    const batch = await this.pool.query(
      `SELECT id, recipient, variables FROM public.communication_campaign_recipients
        WHERE campaign_id = $1 AND organization_id = $2 AND status = 'pending'
        ORDER BY created_at, id LIMIT $3`,
      [campaign.id, organizationId, BATCH_SIZE()],
    );

    let queued = 0;
    let failed = 0;
    let suppressedNow = 0;
    let pausedForQuota = false;
    if (campaign.channel_type === "email" && !getUnsubscribeConfig()) {
      // Configuration was removed after scheduling: stop (resumable) rather than send email with no opt-out.
      await this.pool.query(
        `UPDATE public.communication_campaigns SET status = 'paused', paused_reason = 'unsubscribe_not_configured', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [campaign.id, organizationId],
      );
      emitAuditEvent({
        actor: "service:worker",
        organizationId,
        action: "communication.campaign.paused",
        targetType: "communication_campaign",
        targetId: campaign.id,
        outcome: "failure",
        requestId,
        metadata: { reason: "unsubscribe_not_configured", queued: 0, failed: 0 },
      });
      return { queued: 0, failed: 0, paused: "unsubscribe_not_configured" };
    }
    for (const r of batch.rows as { id: string; recipient: string; variables: Record<string, unknown> }[]) {
      try {
        const msg = await this.comms.sendMessage({
          organizationId,
          channelType: campaign.channel_type,
          recipient: r.recipient,
          templateId: campaign.template_id,
          campaignId: campaign.id,
          variables: { ...campaign.variables, ...r.variables, ...this.unsubscribeVariables(campaign, r.recipient) },
          createdBy: campaign.created_by ?? undefined,
          idempotencyKey: `camp:${campaign.id}:${r.id}`,
        });
        await this.pool.query(
          `UPDATE public.communication_campaign_recipients SET status = 'queued', message_id = $1, error_message = NULL, updated_at = NOW() WHERE id = $2`,
          [msg.id, r.id],
        );
        queued++;
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          pausedForQuota = true;
          break;
        }
        if (err instanceof SuppressedRecipientError) {
          // Suppressed AFTER the campaign was created (e.g. they just unsubscribed): skip, never send.
          await this.pool.query(
            `UPDATE public.communication_campaign_recipients SET status = 'suppressed', error_message = $1, updated_at = NOW() WHERE id = $2`,
            [err.message.slice(0, 500), r.id],
          );
          suppressedNow++;
          continue;
        }
        if (err instanceof CommunicationValidationError) {
          // This recipient can never be sent (e.g. the template renders an invalid subject for them).
          await this.pool.query(
            `UPDATE public.communication_campaign_recipients SET status = 'failed', error_message = $1, updated_at = NOW() WHERE id = $2`,
            [err.message.slice(0, 500), r.id],
          );
          failed++;
          continue;
        }
        throw err;
      }
    }

    if (pausedForQuota) {
      await this.pool.query(
        `UPDATE public.communication_campaigns SET status = 'paused', paused_reason = 'quota', updated_at = NOW() WHERE id = $1 AND organization_id = $2`,
        [campaign.id, organizationId],
      );
      emitAuditEvent({
        actor: "service:worker",
        organizationId,
        action: "communication.campaign.paused",
        targetType: "communication_campaign",
        targetId: campaign.id,
        outcome: "failure",
        requestId,
        metadata: { reason: "quota", queued, failed },
      });
      await this.reconcile(organizationId, campaign.id);
      return { queued, failed, paused: "quota" };
    }

    const remaining = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM public.communication_campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`,
      [campaign.id],
    );
    if ((remaining.rows[0].n as number) > 0) {
      // More audience left: chain the next batch as a new run so this job stays short and bounded.
      const nextRun = campaign.run_count + 1;
      await this.queue.enqueueJob({
        organizationId,
        jobType: "communication",
        payload: { campaignId: campaign.id, run: nextRun },
        priority: "medium",
        idempotencyKey: this.runKey(campaign.id, nextRun),
      });
      await this.pool.query(`UPDATE public.communication_campaigns SET run_count = $1, updated_at = NOW() WHERE id = $2 AND organization_id = $3`, [
        nextRun,
        campaign.id,
        organizationId,
      ]);
    }
    await this.reconcile(organizationId, campaign.id);
    emitAuditEvent({
      actor: "service:worker",
      organizationId,
      action: "communication.campaign.batch_completed",
      targetType: "communication_campaign",
      targetId: campaign.id,
      outcome: "success",
      requestId,
      metadata: { queued, failed, suppressed: suppressedNow, remaining: remaining.rows[0].n },
    });
    return { queued, failed, suppressed: suppressedNow, remaining: remaining.rows[0].n };
  }

  // ---------------------------------------------------------------------------------------------
  // Reconcile: derive recipient/campaign state from real message outcomes
  // ---------------------------------------------------------------------------------------------

  private async syncRecipientsFromMessages(organizationId: string, campaignId: string): Promise<void> {
    await this.pool.query(
      `UPDATE public.communication_campaign_recipients r
          SET status = CASE m.status
                         WHEN 'sent' THEN 'sent'
                         WHEN 'delivered' THEN 'sent'
                         WHEN 'dead_letter' THEN 'failed'
                         WHEN 'cancelled' THEN CASE WHEN m.error_message LIKE 'suppressed:%' THEN 'suppressed' ELSE 'cancelled' END
                         ELSE r.status END,
              error_message = CASE WHEN m.status = 'dead_letter' OR m.error_message LIKE 'suppressed:%' THEN LEFT(m.error_message, 500) ELSE r.error_message END,
              updated_at = NOW()
         FROM public.communication_messages m
        WHERE r.message_id = m.id AND r.campaign_id = $1 AND r.organization_id = $2 AND r.status IN ('queued')`,
      [campaignId, organizationId],
    );
  }

  /**
   * Refreshes counters and, when nothing is pending or in flight, closes a running campaign as
   * 'completed' (or 'failed' if not a single recipient succeeded). Safe to call repeatedly; called by
   * the worker after every campaign message finishes and at the end of every batch.
   */
  async reconcile(organizationId: string, campaignId: string): Promise<void> {
    await this.syncRecipientsFromMessages(organizationId, campaignId);
    const c = await this.pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
              COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
              COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM public.communication_campaign_recipients WHERE campaign_id = $1 AND organization_id = $2`,
      [campaignId, organizationId],
    );
    const { pending, queued, sent, failed } = c.rows[0] as { pending: number; queued: number; sent: number; failed: number };
    await this.pool.query(
      `UPDATE public.communication_campaigns SET sent_count = $1, failed_count = $2, updated_at = NOW() WHERE id = $3 AND organization_id = $4`,
      [sent, failed, campaignId, organizationId],
    );
    if (pending === 0 && queued === 0) {
      const finalStatus = sent === 0 && failed > 0 ? "failed" : "completed";
      const done = await this.pool.query(
        `UPDATE public.communication_campaigns SET status = $1, completed_at = NOW(), updated_at = NOW()
          WHERE id = $2 AND organization_id = $3 AND status = 'running' RETURNING id`,
        [finalStatus, campaignId, organizationId],
      );
      if (done.rows.length > 0) {
        emitAuditEvent({
          actor: "service:worker",
          organizationId,
          action: `communication.campaign.${finalStatus}`,
          targetType: "communication_campaign",
          targetId: campaignId,
          outcome: finalStatus === "completed" ? "success" : "failure",
          requestId: newRequestId(),
          metadata: { sent, failed },
        });
      }
    }
  }
}
