/**
 * Non-functional provider stubs — MSG91, Meta WhatsApp, Twilio.
 *
 * Per explicit instruction: "Do not implement MSG91 or WhatsApp sending yet.
 * Only foundation and provider abstraction." These exist so ProviderFactory
 * can resolve a `communication_providers.provider` value of 'msg91',
 * 'meta_whatsapp', or 'twilio' to *something* conforming to ProviderAdapter,
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
 * MSG91 in particular: this repo's own bell24h-verify skill documents MSG91
 * as belonging to a different, unrelated project. This stub exists only so
 * the registry has an entry for the name if someone configures one — it is
 * NOT a signal that MSG91 integration work has started here.
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

export class TwilioProvider extends NotImplementedProvider {
  readonly provider = "twilio";
  readonly channelType = "sms" as const;
}
