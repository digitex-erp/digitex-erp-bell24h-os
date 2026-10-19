/**
 * Non-functional provider stub — MSG91 (SMS) only.
 *
 * The Meta WhatsApp Cloud API stub that used to live here has been replaced
 * by the real adapter in ./MetaWhatsAppProvider.ts (Sprint C1). MSG91 remains
 * a stub: Gate D.1 criterion 4 (whether MSG91 is actually intended for this
 * project, as distinct from an unrelated Bell24h codebase) is still an open
 * owner question, not an engineering one -- building a real adapter for it
 * now would risk the exact project-conflation the bell24h-verify skill exists
 * to prevent. Per explicit instruction: "Do not implement MSG91 ... sending
 * yet." This exists so ProviderFactory can resolve a
 * `communication_providers.provider` value of 'msg91' to *something*
 * conforming to ProviderAdapter, without pretending it can actually send.
 *
 * validate() returns a clean, non-throwing "invalid, this is a stub" result —
 * safe to call from anywhere. send(), status(), and healthCheck() THROW,
 * deliberately, so that anyone who mistakenly wires this into a real
 * send path gets a loud, unambiguous failure instead of a silently-swallowed
 * no-op or a fabricated success. This mirrors this codebase's existing
 * "PROVIDER_NOT_CONFIGURED" honest-failure convention (see
 * server/workers/handlers/MediaJobHandler.ts / PublishingJobHandler.ts).
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
