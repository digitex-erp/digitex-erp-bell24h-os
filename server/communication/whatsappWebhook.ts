/**
 * Meta WhatsApp Cloud API webhook — verification, parsing and message-status ingestion.
 *
 * PORTED from the VyaparSethu site repo (`src/lib/whatsapp/webhook.ts` + its route), with the same rules:
 *   - The GET handshake and every POST are REJECTED whenever META_WHATSAPP_WEBHOOK_VERIFY_TOKEN /
 *     META_WHATSAPP_APP_SECRET are not configured. Unverified traffic is never processed.
 *   - The POST signature (X-Hub-Signature-256, HMAC-SHA256 of the RAW body) is compared in constant time.
 *
 * Additions for the Hub: verified statuses are correlated to communication_messages by
 * provider_message_id, applied monotonically (a late "sent" never downgrades "delivered"), stored in
 * communication_webhooks WITHOUT the recipient's phone number (only id / status / time / error codes),
 * and any campaign message triggers a campaign reconcile.
 *
 * STATUS: UNVERIFIED against real Meta traffic (no credentials exist for this project).
 */

import crypto from "node:crypto";
import type pg from "pg";
import { emitAuditEvent, newRequestId } from "../audit.js";
import { CampaignService } from "./CampaignService.js";

export interface NormalizedWhatsAppStatus {
  messageId: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  errors: { code?: string; title?: string; message?: string; details?: string }[];
}

type Env = Record<string, string | undefined>;

export function verifyHandshake(mode: unknown, token: unknown, challenge: unknown, env: Env = process.env): string | null {
  const expected = env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (!expected) return null; // not configured: never succeed
  if (mode !== "subscribe" || typeof token !== "string" || typeof challenge !== "string") return null;
  const a = crypto.createHash("sha256").update(token).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b) ? challenge : null;
}

export function verifySignature(rawBody: Buffer | undefined, signatureHeader: unknown, env: Env = process.env): boolean {
  const secret = env.META_WHATSAPP_APP_SECRET;
  if (!secret || !rawBody) return false; // not configured / no raw body: reject
  if (typeof signatureHeader !== "string" || !signatureHeader.startsWith("sha256=")) return false;
  const provided = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

/** Extracts delivery statuses. Never throws on malformed input. */
export function extractStatuses(payload: unknown): NormalizedWhatsAppStatus[] {
  const out: NormalizedWhatsAppStatus[] = [];
  try {
    for (const entry of (payload as { entry?: unknown[] })?.entry ?? []) {
      for (const change of (entry as { changes?: unknown[] })?.changes ?? []) {
        for (const s of ((change as { value?: { statuses?: unknown[] } })?.value?.statuses ?? []) as Record<string, any>[]) {
          if (!s?.id || !["sent", "delivered", "read", "failed"].includes(s?.status)) continue;
          out.push({
            messageId: String(s.id),
            status: s.status,
            timestamp: s.timestamp ? new Date(Number(s.timestamp) * 1000).toISOString() : new Date().toISOString(),
            errors: Array.isArray(s.errors)
              ? s.errors.map((e: any) => ({
                  code: e?.code != null ? String(e.code) : undefined,
                  title: typeof e?.title === "string" ? e.title : undefined,
                  message: typeof e?.message === "string" ? e.message : undefined,
                  details: typeof e?.error_data?.details === "string" ? e.error_data.details : undefined,
                }))
              : [],
          });
        }
      }
    }
  } catch {
    return [];
  }
  return out;
}

const RANK: Record<string, number> = { queued: 0, scheduled: 0, sending: 1, failed: 1, dead_letter: 1, sent: 2, delivered: 3 };

/**
 * Applies verified statuses. Returns how many were correlated to a known message. Throws on database
 * errors so the route can answer 5xx and Meta will retry.
 */
export async function ingestWhatsAppStatuses(pool: pg.Pool, statuses: NormalizedWhatsAppStatus[]): Promise<{ matched: number; unmatched: number }> {
  let matched = 0;
  let unmatched = 0;
  const campaigns = new CampaignService(pool);

  for (const s of statuses) {
    const found = await pool.query(
      `SELECT id, organization_id, campaign_id, is_test, status FROM public.communication_messages
        WHERE provider_message_id = $1 AND channel_type = 'whatsapp' LIMIT 1`,
      [s.messageId],
    );
    const message = found.rows[0] as { id: string; organization_id: string; campaign_id: string | null; is_test: boolean; status: string } | undefined;

    await pool.query(
      `INSERT INTO public.communication_webhooks (organization_id, provider, event_type, provider_message_id, message_id, payload, signature_verified)
       VALUES ($1, 'meta_whatsapp', $2, $3, $4, $5, true)`,
      [message?.organization_id ?? null, `whatsapp.${s.status}`, s.messageId, message?.id ?? null, JSON.stringify(s)],
    );
    if (!message) {
      unmatched++;
      continue;
    }
    matched++;

    const target = s.status === "read" || s.status === "delivered" ? "delivered" : s.status === "failed" ? "failed" : null;
    if (target && (RANK[target] > (RANK[message.status] ?? 0) || (target === "failed" && message.status === "sent"))) {
      const error = target === "failed" ? (s.errors[0] ? `${s.errors[0].code ?? ""} ${s.errors[0].title ?? s.errors[0].message ?? ""}`.trim() : "Delivery failed (Meta)") : null;
      await pool.query(
        `UPDATE public.communication_messages SET status = $1, error_message = COALESCE($2, error_message), updated_at = NOW()
          WHERE id = $3 AND organization_id = $4`,
        [target, error, message.id, message.organization_id],
      );
      emitAuditEvent({
        actor: "service:meta-webhook",
        organizationId: message.organization_id,
        action: `communication.whatsapp.${target}`,
        targetType: "communication_message",
        targetId: message.id,
        outcome: target === "delivered" ? "success" : "failure",
        requestId: newRequestId(),
        metadata: { metaStatus: s.status, errorCode: s.errors[0]?.code },
      });
    }
    if (message.campaign_id && !message.is_test) {
      await campaigns.reconcile(message.organization_id, message.campaign_id).catch(() => undefined);
    }
  }
  return { matched, unmatched };
}
