/**
 * Non-functional provider stubs — MSG91 (SMS), Meta WhatsApp Cloud API (direct).
 *
 * Per explicit instruction: "Do not implement MSG91 or WhatsApp sending yet.
 * Only foundation and provider abstraction." These exist so ProviderFactory
 * can resolve a `communication_providers.provider` value of 'msg91' or
 * 'meta_whatsapp' to *something* conforming to ProviderAdapter,
 * without pretending any of them can actually send.
 *
 * validate() returns a clean, non-throwing "invalid, this is a stub" result —
 * safe to call from anywhere. send(), status(), and healthCheck() THROW,
 * deliberately, so that anyone who mistakenly wires one of these into a real
 * send path gets a loud, unambiguous failure instead of a silently-swallowed
 * no-op or a fabricated success. This mirrors this codebase's existing
 * "PROVIDER_NOT_CONFIGURED" honest-failure convention (see
 * server/workers/handlers/MediaJobHandler.ts / PublishingJobHandler.ts).
 *
 * Provider strategy (owner decision, 2026-09-28): Email = Resend primary + SMTP
 * fallback; SMS = MSG91; WhatsApp = Meta Cloud API direct. Twilio and
 * WhatsApp-via-MSG91 are removed; Exotel and Gupshup are deferred and have no
 * code here. The real Meta (Sprint C1) and MSG91 (Sprint C2) adapters replace
 * these stubs only after the Gate D.1 criteria are met — these stubs are NOT a
 * signal that integration work has started.
 */

import type {
  AdapterHealthResult,
  AdapterSendResult,
  AdapterStatusResult,
  AdapterValidationResult,
  ChannelType,
  ProviderAdapter,
  OutboundMessage,
  ResolvedProviderConfig,
} from "../types.js";

class NotImplementedProviderError extends Error {
  constructor(provider: string, method: string) {
    super(`Provider "${provider}" is a non-functional stub — ${method}() is not implemented. Do not configure this provider for real sends.`);
  }
}

abstract class NotImplementedProvider implements ProviderAdapter {
  abstract readonly provider: string;
  abstract readonly channelType: ChannelType;

  async send(_message: OutboundMessage, _config: ResolvedProviderConfig): Promise<AdapterSendResult> {
    throw new NotImplementedProviderError(this.provider, "send");
  }

  async status(_providerMessageId: string, _config: ResolvedProviderConfig): Promise<AdapterStatusResult> {
    throw new NotImplementedProviderError(this.provider, "status");
  }

  async validate(_config: ResolvedProviderConfig): Promise<AdapterValidationResult> {
    return { valid: false, reason: `Provider "${this.provider}" is a non-functional stub — foundation only.` };
  }

  async healthCheck(_config: ResolvedProviderConfig): Promise<AdapterHealthResult> {
    throw new NotImplementedProviderError(this.provider, "healthCheck");
  }
}

export class MSG91Provider extends NotImplementedProvider {
  readonly provider = "msg91";
  readonly channelType = "sms" as const;
}

export class MetaWhatsAppProvider extends NotImplementedProvider {
  readonly provider = "meta_whatsapp";
  readonly channelType = "whatsapp" as const;
}
