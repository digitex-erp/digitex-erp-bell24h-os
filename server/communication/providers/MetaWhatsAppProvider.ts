/**
 * WhatsApp provider — Meta WhatsApp Cloud API
 * (https://developers.facebook.com/docs/whatsapp/cloud-api).
 *
 * Replaces the StubProviders.ts MetaWhatsAppProvider placeholder (Sprint C1,
 * per Gate D.1's naming) with a real adapter, implemented and tested with
 * mocked HTTP responses only -- no real Meta credential is used or required
 * to run this file's own test suite, and nothing in this change provisions
 * one, sends a real message, or represents Gate D.1 Decision B as approved.
 * That gate's sign-off remains the project owner's decision, separate from
 * this code existing.
 *
 * Uses raw fetch, matching ResendProvider.ts's style -- no new SDK dependency
 * added for one HTTP integration. `config.settings.phoneNumberId` is required
 * (Meta's API is scoped to a specific WhatsApp Business phone number, not a
 * single account-wide credential) and `config.settings.apiVersion` is
 * optional, defaulting to "v21.0".
 *
 * Known, honestly-stated limitations (not silently papered over):
 *   - Meta's Cloud API has no endpoint to poll a message's delivery status by
 *     ID -- delivery/read receipts are only ever reported asynchronously via
 *     a webhook callback (not yet implemented in this codebase; tracked as
 *     the next stage after this adapter). status() below returns the one
 *     fact actually knowable without a webhook -- that Meta accepted the
 *     send -- and says so explicitly in its `raw` field, rather than
 *     fabricating "delivered".
 *   - Meta's API only supports free-form text sends inside an open 24-hour
 *     customer-service window; outside that window (or for the first
 *     business-initiated message), Meta requires a pre-approved native
 *     "template" message type, which this codebase's current
 *     CommunicationTemplate abstraction does not yet model (it renders a
 *     template into a plain body string before the adapter ever sees it, the
 *     same as every other channel). This adapter therefore only implements
 *     Meta's `type: "text"` send -- a send attempted outside the 24-hour
 *     window will fail with Meta's own real error (handled below, not
 *     specially detected), which is the honest, correct behavior: this
 *     adapter must not simulate template support it doesn't have.
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
import { CommunicationValidationError, validatePhoneNumber } from "../validation.js";

const DEFAULT_API_VERSION = "v21.0";
const GRAPH_API_BASE = "https://graph.facebook.com";
const REQUEST_TIMEOUT_MS = 15_000;

/** Meta's documented error envelope: { error: { message, type, code, error_subcode, fbtrace_id } }. */
interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/** Meta's documented success envelope for a message send. */
interface MetaSendResponseBody {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string }>;
}

/** Meta error codes that mean "rate limited / throttled" (documented subset, not exhaustive). */
const RATE_LIMIT_CODES = new Set([4, 80007, 130429]);

function apiVersion(settings: Record<string, unknown>): string {
  const v = settings.apiVersion;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : DEFAULT_API_VERSION;
}

function phoneNumberId(settings: Record<string, unknown>): string | null {
  const v = settings.phoneNumberId;
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Meta's `to` field is the number without a leading '+' (country code + number only). */
function toMetaRecipient(e164Recipient: string): string {
  return e164Recipient.replace(/^\+/, "");
}

async function parseJsonSafely(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export class MetaWhatsAppProvider implements ProviderAdapter {
  readonly provider = "meta_whatsapp";
  readonly channelType = "whatsapp" as const;

  async send(message: OutboundMessage, config: ResolvedProviderConfig): Promise<AdapterSendResult> {
    if (!config.secretValue) {
      return { success: false, errorMessage: "Missing resolved access token secret." };
    }
    const phoneId = phoneNumberId(config.settings);
    if (!phoneId) {
      return { success: false, errorMessage: "Missing 'phoneNumberId' in provider config settings." };
    }

    let recipient: string;
    try {
      recipient = validatePhoneNumber(message.recipient);
    } catch (err: any) {
      if (err instanceof CommunicationValidationError) return { success: false, errorMessage: err.message };
      throw err;
    }
    if (!message.body || message.body.trim().length === 0) {
      return { success: false, errorMessage: "Message body is required." };
    }

    const url = `${GRAPH_API_BASE}/${apiVersion(config.settings)}/${encodeURIComponent(phoneId)}/messages`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secretValue}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: toMetaRecipient(recipient),
          type: "text",
          text: { body: message.body },
        }),
        signal: controller.signal,
      });

      const data = (await parseJsonSafely(res)) as MetaSendResponseBody & MetaErrorBody;

      if (!res.ok) {
        const code = data.error?.code;
        const errorMessage = data.error?.message || `Meta API returned ${res.status}`;
        return {
          success: false,
          errorMessage: RATE_LIMIT_CODES.has(code ?? -1) ? `Rate limited by Meta: ${errorMessage}` : errorMessage,
          raw: { status: res.status, body: data },
        };
      }

      const providerMessageId = data.messages?.[0]?.id;
      if (!providerMessageId) {
        // A 200 with no message id is not a success this codebase trusts --
        // same "reject empty/malformed success" discipline as the AI router.
        return {
          success: false,
          errorMessage: "Meta API returned 200 with no message id in the response.",
          raw: { status: res.status, body: data },
        };
      }

      return { success: true, providerMessageId, raw: { status: res.status } };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return { success: false, errorMessage: `Meta API request timed out after ${REQUEST_TIMEOUT_MS}ms.` };
      }
      return { success: false, errorMessage: err?.message || "Network error calling Meta WhatsApp Cloud API." };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Meta's Cloud API has no "get message status by id" endpoint -- delivery
   * and read receipts only ever arrive via webhook. This never claims more
   * than what's actually true: send() having returned a providerMessageId
   * means Meta accepted the message, nothing more. See the file header.
   */
  async status(providerMessageId: string, _config: ResolvedProviderConfig): Promise<AdapterStatusResult> {
    return {
      status: "sent",
      raw: {
        note: "WhatsApp Cloud API does not support polling message status by id; delivery/read status is only reported via webhook callbacks (not yet implemented).",
        providerMessageId,
      },
    };
  }

  async validate(config: ResolvedProviderConfig): Promise<AdapterValidationResult> {
    if (!config.secretValue) return { valid: false, reason: "No access token resolved from secrets." };
    const phoneId = phoneNumberId(config.settings);
    if (!phoneId) return { valid: false, reason: "Provider config settings missing 'phoneNumberId'." };
    return { valid: true };
  }

  /** Read-only: fetches the phone number's own metadata. No message is sent. */
  async healthCheck(config: ResolvedProviderConfig): Promise<AdapterHealthResult> {
    const checkedAt = new Date().toISOString();
    if (!config.secretValue) return { healthy: false, detail: "No access token resolved.", checkedAt };
    const phoneId = phoneNumberId(config.settings);
    if (!phoneId) return { healthy: false, detail: "Missing 'phoneNumberId' in provider config settings.", checkedAt };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const url = `${GRAPH_API_BASE}/${apiVersion(config.settings)}/${encodeURIComponent(phoneId)}?fields=verified_name,display_phone_number`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${config.secretValue}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await parseJsonSafely(res)) as MetaErrorBody;
        return { healthy: false, detail: data.error?.message || `Meta API returned ${res.status}`, checkedAt };
      }
      return { healthy: true, checkedAt };
    } catch (err: any) {
      if (err?.name === "AbortError") return { healthy: false, detail: "Health check timed out.", checkedAt };
      return { healthy: false, detail: err?.message || "Network error.", checkedAt };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
