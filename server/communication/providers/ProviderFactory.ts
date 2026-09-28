/**
 * ProviderFactory — maps a provider key (communication_providers.provider) to
 * a concrete ProviderAdapter, and resolves credentials from server-side
 * secrets (process.env) by name — never from a database column.
 *
 * Adding a real (non-stub) SMS/WhatsApp/voice provider later means:
 * implement the adapter, register it here. CommunicationService and
 * CommunicationJobHandler never change. Per ARCHITECTURE_DECISIONS.md's
 * "Proposed module (unratified): Communication Hub" note, get review-gate
 * sign-off before that happens.
 */

import type { ProviderAdapter, ResolvedProviderConfig } from "../types.js";
import { ResendProvider } from "./ResendProvider.js";
import { SMTPProvider } from "./SMTPProvider.js";
import { MSG91Provider, MetaWhatsAppProvider, TwilioProvider } from "./StubProviders.js";

export class UnknownProviderError extends Error {
  constructor(provider: string) {
    super(`No provider registered for key "${provider}".`);
  }
}

export class MissingSecretError extends Error {
  constructor(secretRef: string) {
    super(`Secret "${secretRef}" is not set in the server environment.`);
  }
}

export class ProviderFactory {
  private static registry: Record<string, ProviderAdapter> = {
    resend: new ResendProvider(),
    smtp: new SMTPProvider(),
    msg91: new MSG91Provider(),
    meta_whatsapp: new MetaWhatsAppProvider(),
    twilio: new TwilioProvider(),
  };

  static getAdapter(provider: string): ProviderAdapter {
    const adapter = ProviderFactory.registry[provider];
    if (!adapter) throw new UnknownProviderError(provider);
    return adapter;
  }

  /**
   * Resolves the secret named by `credentials_secret_ref` from the server
   * environment (process.env) — the same mechanism server/ai/ProviderManager.ts
   * uses for AI provider keys. Throws rather than silently sending unauthenticated.
   */
  static resolveSecret(secretRef: string): string {
    const value = process.env[secretRef];
    if (!value) throw new MissingSecretError(secretRef);
    return value;
  }

  static buildResolvedConfig(
    provider: string,
    credentialsSecretRef: string,
    settings: Record<string, unknown>,
  ): ResolvedProviderConfig {
    return { provider, secretValue: ProviderFactory.resolveSecret(credentialsSecretRef), settings };
  }
}
