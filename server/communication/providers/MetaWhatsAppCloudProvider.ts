/**
 * WhatsApp — Meta WhatsApp Cloud API (direct; no BSP in the middle).
 *
 * PORTED from the VyaparSethu site repo's `src/lib/whatsapp/MetaWhatsAppProvider.ts` (same Graph API
 * calls: text message, template message, 10 s timeout, token never included in an error), re-shaped to
 * the Communication Hub's ProviderAdapter contract and validated like every other adapter.
 *
 * STATUS: UNVERIFIED. Nothing in this repository has ever sent a message through this adapter: no
 * Meta credential is configured for this project, and no template has been shown to be approved. The
 * site repo's own certification records "Production Tested = NO" for every WhatsApp path. It therefore
 * ships behind the normal fail-closed gates — ProviderFactory refuses to run it without an allow-listed
 * META_WHATSAPP_ACCESS_TOKEN (or COMM_META_*) secret and an operator-created communication_providers
 * row — and the admin Providers tab reports it as "unverified" until a real send has succeeded.
 *
 * Settings (communication_providers.settings, non-secret):
 *   phoneNumberId   required, digits only — the WhatsApp Business phone number ID
 *   apiVersion      optional, e.g. "v21.0" (default v21.0)
 *   templateName    optional. When set, the message is sent as an approved TEMPLATE whose body has ONE
 *                   text placeholder {{1}}, filled with the rendered message body. Required to start a
 *                   conversation outside Meta's 24-hour customer-service window.
 *   templateLanguage optional, e.g. "en" (default "en")
 * Without templateName the adapter sends a free-form text message, which Meta only delivers inside
 * the 24-hour window; outside it Meta rejects the call and that rejection is returned as a failure —
 * it is never treated as success.
 *
 * Delivery status arrives asynchronously via the webhook (server/communication/whatsappWebhook.ts).
 */

import type {
  AdapterHealthResult,
  AdapterSendResult,
  AdapterStatusResult,
  AdapterValidationResult,
  OutboundMessage,
  ProviderAdapter,
  ResolvedProviderConfig,
} from "../types.js";
import { CommunicationValidationError, validatePhoneNumber } from "../validation.js";

const DEFAULT_API_VERSION = "v21.0";
const TIMEOUT_MS = 10_000;
const PHONE_NUMBER_ID_RE = /^\d{5,30}$/;
const API_VERSION_RE = /^v\d{1,2}\.\d{1,2}$/;
const TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
// Meta limits: text body 4096 chars; a template body parameter 1024 chars and no newlines / tabs / 4+ spaces.
const MAX_TEXT_LENGTH = 4096;
const MAX_TEMPLATE_PARAM_LENGTH = 1024;

interface MetaSettings {
  phoneNumberId: string;
  apiVersion: string;
  templateName?: string;
  templateLanguage: string;
}

function parseSettings(settings: Record<string, unknown>): MetaSettings {
  const phoneNumberId = String(settings.phoneNumberId ?? "");
  if (!PHONE_NUMBER_ID_RE.test(phoneNumberId)) {
    throw new CommunicationValidationError("settings.phoneNumberId", "must be the numeric WhatsApp phone number ID");
  }
  const apiVersion = settings.apiVersion === undefined ? DEFAULT_API_VERSION : String(settings.apiVersion);
  if (!API_VERSION_RE.test(apiVersion)) throw new CommunicationValidationError("settings.apiVersion", "must look like v21.0");
  let templateName: string | undefined;
  if (settings.templateName !== undefined && settings.templateName !== "") {
    templateName = String(settings.templateName);
    if (!TEMPLATE_NAME_RE.test(templateName)) {
      throw new CommunicationValidationError("settings.templateName", "must be lowercase letters, digits and underscores");
    }
  }
  const templateLanguage = settings.templateLanguage === undefined ? "en" : String(settings.templateLanguage);
  if (!LANGUAGE_RE.test(templateLanguage)) throw new CommunicationValidationError("settings.templateLanguage", "must look like en or en_US");
  return { phoneNumberId, apiVersion, templateName, templateLanguage };
}

const graphUrl = (s: MetaSettings, path: string) => `https://graph.facebook.com/${s.apiVersion}/${s.phoneNumberId}${path}`;

export class MetaWhatsAppCloudProvider implements ProviderAdapter {
  readonly provider = "meta_whatsapp";
  readonly channelType = "whatsapp" as const;

  async send(message: OutboundMessage, config: ResolvedProviderConfig): Promise<AdapterSendResult> {
    let settings: MetaSettings;
    let to: string;
    try {
      settings = parseSettings(config.settings);
      // Meta wants the number without the leading "+".
      to = validatePhoneNumber(message.recipient).slice(1);
    } catch (err) {
      if (err instanceof CommunicationValidationError) return { success: false, errorMessage: err.message };
      throw err;
    }
    if (!config.secretValue) return { success: false, errorMessage: "Missing resolved WhatsApp access token." };

    let payload: Record<string, unknown>;
    if (settings.templateName) {
      if (message.body.length > MAX_TEMPLATE_PARAM_LENGTH || /[\n\r\t]| {4,}/.test(message.body)) {
        return {
          success: false,
          errorMessage: `Template parameter must be at most ${MAX_TEMPLATE_PARAM_LENGTH} characters with no line breaks, tabs or 4+ consecutive spaces (Meta rule).`,
        };
      }
      payload = {
        type: "template",
        template: {
          name: settings.templateName,
          language: { code: settings.templateLanguage },
          components: [{ type: "body", parameters: [{ type: "text", text: message.body }] }],
        },
      };
    } else {
      if (message.body.length > MAX_TEXT_LENGTH) {
        return { success: false, errorMessage: `Text message must be at most ${MAX_TEXT_LENGTH} characters.` };
      }
      payload = { type: "text", text: { body: message.body } };
    }

    try {
      const res = await fetch(graphUrl(settings, "/messages"), {
        method: "POST",
        headers: { Authorization: `Bearer ${config.secretValue}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to, ...payload }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { code?: number; message?: string };
      };
      if (!res.ok) {
        return {
          success: false,
          errorMessage: `Meta API ${res.status}${data.error?.code ? ` (code ${data.error.code})` : ""}: ${data.error?.message ?? "request rejected"}`,
          raw: { status: res.status, errorCode: data.error?.code },
        };
      }
      const id = data.messages?.[0]?.id;
      if (!id) {
        // A 2xx with no message id is not a confirmed send.
        return { success: false, errorMessage: "Meta API returned success without a message id.", raw: { status: res.status } };
      }
      return { success: true, providerMessageId: id, raw: { status: res.status } };
    } catch (err) {
      // Never include the token: only the error's own message.
      return { success: false, errorMessage: `Network error calling Meta WhatsApp API: ${(err as Error)?.message ?? "unknown"}` };
    }
  }

  /** Meta has no message-status GET; delivery state is pushed to the webhook. */
  async status(_providerMessageId: string, _config: ResolvedProviderConfig): Promise<AdapterStatusResult> {
    return { status: "sent", raw: { note: "WhatsApp delivery status is received via webhook, not polled." } };
  }

  async validate(config: ResolvedProviderConfig): Promise<AdapterValidationResult> {
    if (!config.secretValue) return { valid: false, reason: "No access token resolved from secrets." };
    try {
      parseSettings(config.settings);
    } catch (err) {
      return { valid: false, reason: (err as Error).message };
    }
    return { valid: true };
  }

  /** Read-only: fetches the phone number's own record. No message is sent. */
  async healthCheck(config: ResolvedProviderConfig): Promise<AdapterHealthResult> {
    const checkedAt = new Date().toISOString();
    let settings: MetaSettings;
    try {
      settings = parseSettings(config.settings);
    } catch (err) {
      return { healthy: false, detail: (err as Error).message, checkedAt };
    }
    if (!config.secretValue) return { healthy: false, detail: "No access token resolved.", checkedAt };
    try {
      const res = await fetch(`${graphUrl(settings, "")}?fields=verified_name,quality_rating`, {
        headers: { Authorization: `Bearer ${config.secretValue}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { healthy: false, detail: `Meta API returned ${res.status}`, checkedAt };
      return { healthy: true, checkedAt };
    } catch (err) {
      return { healthy: false, detail: (err as Error)?.message ?? "Network error.", checkedAt };
    }
  }
}
