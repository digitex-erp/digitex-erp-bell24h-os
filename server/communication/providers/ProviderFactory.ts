/**
 * ProviderFactory — maps a provider key (communication_providers.provider) to
 * a concrete ProviderAdapter, and resolves credentials from server-side
 * secrets (process.env) by name — never from a database column.
 *
 * SECURITY (Sprint C0 / B1): `credentials_secret_ref` comes from a database row,
 * so it is untrusted input. It is checked against a per-provider allowlist BEFORE
 * process.env is touched — a row may only name a credential that belongs to its
 * own provider, never an arbitrary environment variable (DATABASE_URL,
 * SUPABASE_SERVICE_KEY, CRON_SECRET, ...). The allowlist is one half of the fix;
 * the other half is in add_communication_hub.sql, which removes tenant write
 * access to communication_providers (otherwise a tenant could still point an
 * allowed, shared secret at a host they control).
 *
 * Approved providers (owner decision, 2026-09-28): Resend, SMTP, Meta WhatsApp
 * Cloud API, MSG91 (SMS/OTP). Twilio and WhatsApp-via-MSG91 are removed.
 * Adding a provider means: implement the adapter, register it here, add its
 * secret-name pattern to SECRET_REF_ALLOWLIST. Get review-gate sign-off first.
 */

import type { ProviderAdapter, ResolvedProviderConfig } from "../types.js";
import { ResendProvider } from "./ResendProvider.js";
import { SMTPProvider } from "./SMTPProvider.js";
import { MSG91Provider, MetaWhatsAppProvider } from "./StubProviders.js";

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

export class SecretNotAllowedError extends Error {
  constructor(provider: string) {
    // Deliberately does not echo the requested name: it is attacker-controlled
    // and this message is persisted to communication_deliveries.error_message.
    super(`credentials_secret_ref is not an allowed secret name for provider "${provider}".`);
  }
}

/**
 * Per provider: the conventional variable name, or anything under that
 * provider's own COMM_<PROVIDER>_ namespace (so an org-specific credential can
 * be added without a code change, but only inside the namespace).
 */
export const SECRET_REF_ALLOWLIST: Readonly<Record<string, RegExp>> = {
  resend: /^(?:RESEND_API_KEY|COMM_RESEND_[A-Z0-9_]{1,64})$/,
  smtp: /^(?:SMTP_PASSWORD|COMM_SMTP_[A-Z0-9_]{1,64})$/,
  meta_whatsapp: /^(?:META_WHATSAPP_ACCESS_TOKEN|COMM_META_[A-Z0-9_]{1,64})$/,
  msg91: /^(?:MSG91_AUTH_KEY|COMM_MSG91_[A-Z0-9_]{1,64})$/,
};

export function isAllowedSecretRef(provider: string, secretRef: unknown): boolean {
  if (typeof secretRef !== "string") return false;
  // Own-property check: `provider` also comes from a database row ("__proto__", "constructor", ...).
  if (!Object.prototype.hasOwnProperty.call(SECRET_REF_ALLOWLIST, provider)) return false;
  return SECRET_REF_ALLOWLIST[provider].test(secretRef);
}

export class ProviderFactory {
  private static registry: Record<string, ProviderAdapter> = {
    resend: new ResendProvider(),
    smtp: new SMTPProvider(),
    msg91: new MSG91Provider(),
    meta_whatsapp: new MetaWhatsAppProvider(),
  };

  static getAdapter(provider: string): ProviderAdapter {
    // Own-property lookup, not registry[provider]: "constructor" / "__proto__" must not resolve.
    if (!Object.prototype.hasOwnProperty.call(ProviderFactory.registry, provider)) {
      throw new UnknownProviderError(provider);
    }
    return ProviderFactory.registry[provider];
  }

  /**
   * Resolves the secret named by `credentials_secret_ref` from the server
   * environment (process.env) — the same mechanism server/ai/ProviderManager.ts
   * uses for AI provider keys. The name is allowlist-checked first; the
   * environment is only read for a name that passed. Throws rather than
   * silently sending unauthenticated.
   */
  static resolveSecret(provider: string, secretRef: string): string {
    if (!isAllowedSecretRef(provider, secretRef)) throw new SecretNotAllowedError(provider);
    const value = process.env[secretRef];
    if (!value) throw new MissingSecretError(secretRef);
    return value;
  }

  static buildResolvedConfig(
    provider: string,
    credentialsSecretRef: string,
    settings: Record<string, unknown>,
  ): ResolvedProviderConfig {
    return { provider, secretValue: ProviderFactory.resolveSecret(provider, credentialsSecretRef), settings };
  }
}
