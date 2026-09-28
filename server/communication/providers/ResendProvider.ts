/**
 * Email provider — Resend (https://resend.com/docs/api-reference).
 *
 * RESEND_API_KEY already exists as a documented (empty) slot in .env.example —
 * this is the first thing that actually reads it, via
 * ResolvedProviderConfig.secretValue (resolved by ProviderFactory from the
 * server-side secret named by communication_providers.credentials_secret_ref,
 * never from a database column).
 *
 * Uses raw fetch, matching server/ai/GeminiProvider.ts's style — no new SDK
 * dependency added for one HTTP integration.
 *
 * validate() and healthCheck() never send a real email; they only check
 * config shape and make a read-only call. send() is the only method with a
 * side effect, and nothing in this codebase calls it automatically — no test
 * email has been sent as part of this change.
 */

import type {
  AdapterHealthResult,
  AdapterSendResult,
  AdapterStatusResult,
  AdapterValidationResult,
  ProviderAdapter,
  OutboundMessage,
  ResolvedProviderConfig,
} from "../types.js";

const RESEND_API_BASE = "https://api.resend.com";

export class ResendProvider implements ProviderAdapter {
  readonly provider = "resend";
  readonly channelType = "email" as const;

  async send(message: OutboundMessage, config: ResolvedProviderConfig): Promise<AdapterSendResult> {
    const from = (config.settings.fromAddress as string) || (config.settings.from_address as string);
    if (!from) {
      return { success: false, errorMessage: "Missing 'fromAddress' in provider config settings." };
    }
    if (!config.secretValue) {
      return { success: false, errorMessage: "Missing resolved API key secret." };
    }

    try {
      const res = await fetch(`${RESEND_API_BASE}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secretValue}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [message.recipient],
          subject: message.subject || "(no subject)",
          html: message.body,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

      if (!res.ok) {
        return {
          success: false,
          errorMessage: data.message || `Resend API returned ${res.status}`,
          raw: { status: res.status, body: data },
        };
      }

      return { success: true, providerMessageId: data.id, raw: { status: res.status } };
    } catch (err: any) {
      return { success: false, errorMessage: err?.message || "Network error calling Resend." };
    }
  }

  async status(providerMessageId: string, config: ResolvedProviderConfig): Promise<AdapterStatusResult> {
    try {
      const res = await fetch(`${RESEND_API_BASE}/emails/${encodeURIComponent(providerMessageId)}`, {
        headers: { Authorization: `Bearer ${config.secretValue}` },
      });
      if (!res.ok) return { status: "failed", raw: { httpStatus: res.status } };
      const data = (await res.json()) as { last_event?: string };
      // Resend's last_event values: 'sent' | 'delivered' | 'bounced' | 'complained' | ...
      const mapped = data.last_event === "delivered" ? "delivered" : data.last_event === "sent" ? "sent" : "failed";
      return { status: mapped, raw: data };
    } catch (err: any) {
      return { status: "failed", raw: { error: err?.message } };
    }
  }

  async validate(config: ResolvedProviderConfig): Promise<AdapterValidationResult> {
    if (!config.secretValue) return { valid: false, reason: "No API key resolved from secrets." };
    const from = (config.settings.fromAddress as string) || (config.settings.from_address as string);
    if (!from) return { valid: false, reason: "Provider config settings missing 'fromAddress'." };
    return { valid: true };
  }

  /** Read-only: lists verified domains. No message is sent. */
  async healthCheck(config: ResolvedProviderConfig): Promise<AdapterHealthResult> {
    const checkedAt = new Date().toISOString();
    if (!config.secretValue) return { healthy: false, detail: "No API key resolved.", checkedAt };
    try {
      const res = await fetch(`${RESEND_API_BASE}/domains`, {
        headers: { Authorization: `Bearer ${config.secretValue}` },
      });
      if (!res.ok) return { healthy: false, detail: `Resend API returned ${res.status}`, checkedAt };
      return { healthy: true, checkedAt };
    } catch (err: any) {
      return { healthy: false, detail: err?.message || "Network error.", checkedAt };
    }
  }
}
