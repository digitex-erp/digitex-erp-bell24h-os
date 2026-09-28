/**
 * AnalyticsService — campaign and organization analytics computed from real rows only.
 *
 * What the numbers mean (and do not):
 *  - "sent" = a provider ACCEPTED the message. For email (Resend/SMTP) and SMS that is all this system can
 *    know: there is no delivery-receipt webhook for them yet, so `deliveryTracking` is reported as
 *    "provider_acceptance_only" and no delivery/bounce/open/click rate is invented.
 *  - For WhatsApp, delivery status arrives via the signed Meta webhook, so `delivered` is real once that is
 *    configured; until then it is zero and the tracking field says so.
 *  - Test sends are excluded everywhere.
 */

import type pg from "pg";
import { CampaignNotFoundError } from "./CampaignService.js";
import { validateUuid } from "./validation.js";

const FINAL_OK = ["sent", "delivered"];

export type DeliveryTracking = "provider_acceptance_only" | "webhook";

const trackingFor = (channel: string): DeliveryTracking => (channel === "whatsapp" ? "webhook" : "provider_acceptance_only");

export class AnalyticsService {
  constructor(private pool: pg.Pool) {}

  async getCampaignAnalytics(organizationId: string, campaignId: string) {
    const id = validateUuid(campaignId, "campaignId");
    const c = await this.pool.query(`SELECT id, name, channel_type, status, total_recipients, audience_summary, started_at, completed_at FROM public.communication_campaigns WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
    if (c.rows.length === 0) throw new CampaignNotFoundError();
    const camp = c.rows[0] as { channel_type: string; total_recipients: number; audience_summary: unknown; started_at: string | null; completed_at: string | null; name: string; status: string };

    const [byStatus, recipients, providers, failures, timeline, attempts] = await Promise.all([
      this.pool.query(`SELECT status, COUNT(*)::int AS n FROM public.communication_messages WHERE campaign_id = $1 AND organization_id = $2 AND NOT is_test GROUP BY status`, [id, organizationId]),
      this.pool.query(`SELECT status, COUNT(*)::int AS n FROM public.communication_campaign_recipients WHERE campaign_id = $1 AND organization_id = $2 GROUP BY status`, [id, organizationId]),
      this.pool.query(
        `SELECT d.provider, COUNT(*)::int AS n FROM public.communication_deliveries d JOIN public.communication_messages m ON m.id = d.message_id
          WHERE m.campaign_id = $1 AND m.organization_id = $2 AND NOT m.is_test AND d.status = 'success' GROUP BY d.provider ORDER BY n DESC`,
        [id, organizationId],
      ),
      this.pool.query(
        `SELECT LEFT(COALESCE(error_message, 'unknown'), 120) AS reason, COUNT(*)::int AS n FROM public.communication_messages
          WHERE campaign_id = $1 AND organization_id = $2 AND NOT is_test AND status IN ('failed', 'dead_letter') GROUP BY 1 ORDER BY n DESC LIMIT 10`,
        [id, organizationId],
      ),
      this.pool.query(
        `SELECT date_trunc('hour', sent_at) AS hour, COUNT(*)::int AS n FROM public.communication_messages
          WHERE campaign_id = $1 AND organization_id = $2 AND NOT is_test AND sent_at IS NOT NULL GROUP BY 1 ORDER BY 1`,
        [id, organizationId],
      ),
      this.pool.query(
        `SELECT COUNT(*)::int AS attempts, COUNT(DISTINCT d.message_id)::int AS messages_attempted
           FROM public.communication_deliveries d JOIN public.communication_messages m ON m.id = d.message_id
          WHERE m.campaign_id = $1 AND m.organization_id = $2 AND NOT m.is_test`,
        [id, organizationId],
      ),
    ]);

    const messages: Record<string, number> = Object.fromEntries((byStatus.rows as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const recipientCounts: Record<string, number> = Object.fromEntries((recipients.rows as { status: string; n: number }[]).map((r) => [r.status, r.n]));
    const total = Object.values(messages).reduce((a, b) => a + b, 0);
    const accepted = FINAL_OK.reduce((a, s) => a + (messages[s] ?? 0), 0);
    const failed = (messages.failed ?? 0) + (messages.dead_letter ?? 0);
    const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

    return {
      campaign: { id, name: camp.name, channel: camp.channel_type, status: camp.status, totalRecipients: camp.total_recipients, startedAt: camp.started_at, completedAt: camp.completed_at },
      audience: camp.audience_summary ?? null,
      recipients: recipientCounts,
      messages,
      rates: {
        // of the messages that reached a final outcome
        acceptedPercent: pct(accepted, accepted + (messages.dead_letter ?? 0)),
        failedPercent: pct(messages.dead_letter ?? 0, accepted + (messages.dead_letter ?? 0)),
        deliveredPercent: camp.channel_type === "whatsapp" ? pct(messages.delivered ?? 0, accepted) : null,
        suppressedPercent: pct(recipientCounts.suppressed ?? 0, camp.total_recipients),
      },
      deliveryTracking: trackingFor(camp.channel_type),
      totals: { messages: total, accepted, failed, providerAttempts: attempts.rows[0].attempts, messagesAttempted: attempts.rows[0].messages_attempted },
      byProvider: providers.rows,
      topFailureReasons: failures.rows,
      sentByHour: (timeline.rows as { hour: string; n: number }[]).map((r) => ({ hour: r.hour, count: r.n })),
    };
  }

  async getOrganizationAnalytics(organizationId: string, daysInput?: number) {
    const days = Math.min(Math.max(Number.isInteger(daysInput) ? (daysInput as number) : 30, 1), 90);
    const since = `NOW() - make_interval(days => ${days})`; // days is a validated integer, not user text
    const [daily, byChannel, campaigns, failures, suppress, lists] = await Promise.all([
      this.pool.query(
        `SELECT date_trunc('day', created_at)::date AS day,
                COUNT(*) FILTER (WHERE status IN ('sent','delivered'))::int AS accepted,
                COUNT(*) FILTER (WHERE status IN ('failed','dead_letter'))::int AS failed,
                COUNT(*)::int AS total
           FROM public.communication_messages WHERE organization_id = $1 AND NOT is_test AND created_at > ${since} GROUP BY 1 ORDER BY 1`,
        [organizationId],
      ),
      this.pool.query(
        `SELECT channel_type, status, COUNT(*)::int AS n FROM public.communication_messages
          WHERE organization_id = $1 AND NOT is_test AND created_at > ${since} GROUP BY 1, 2`,
        [organizationId],
      ),
      this.pool.query(
        `SELECT c.id, c.name, c.channel_type, c.status, c.total_recipients, c.sent_count, c.failed_count, c.created_at
           FROM public.communication_campaigns c WHERE c.organization_id = $1 AND c.created_at > ${since} ORDER BY c.created_at DESC LIMIT 10`,
        [organizationId],
      ),
      this.pool.query(
        `SELECT LEFT(COALESCE(error_message, 'unknown'), 120) AS reason, COUNT(*)::int AS n FROM public.communication_messages
          WHERE organization_id = $1 AND NOT is_test AND status IN ('failed','dead_letter') AND created_at > ${since} GROUP BY 1 ORDER BY n DESC LIMIT 10`,
        [organizationId],
      ),
      this.pool.query(`SELECT channel_type, reason, COUNT(*)::int AS n FROM public.communication_suppressions WHERE organization_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [organizationId]),
      this.pool.query(`SELECT (SELECT COUNT(*)::int FROM public.communication_lists WHERE organization_id = $1) AS lists, (SELECT COUNT(*)::int FROM public.communication_segments WHERE organization_id = $1) AS segments`, [organizationId]),
    ]);
    const channels: Record<string, Record<string, number>> = {};
    for (const r of byChannel.rows as { channel_type: string; status: string; n: number }[]) (channels[r.channel_type] ??= {})[r.status] = r.n;
    return {
      days,
      daily: daily.rows,
      byChannel: channels,
      recentCampaigns: campaigns.rows,
      topFailureReasons: failures.rows,
      suppressions: suppress.rows,
      audience: lists.rows[0],
      deliveryTracking: { email: trackingFor("email"), sms: trackingFor("sms"), whatsapp: trackingFor("whatsapp") },
    };
  }
}
