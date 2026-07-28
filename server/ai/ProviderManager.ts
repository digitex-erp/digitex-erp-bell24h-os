/**
 * Server-side provider credential resolution.
 *
 * SECURITY CONTRACT
 * Credentials are read ONLY from the server process environment. This module must
 * never read `public.ai_providers` (or any other tenant-readable table), because
 * those rows are selectable by any authenticated organization member and would
 * place provider keys within reach of the browser.
 *
 * See SECURITY_BASELINE.md — "Provider keys ... belong in server/runtime secret
 * storage. Never store provider keys in ordinary tenant-readable records."
 *
 * This file must never be imported from `src/` (client code).
 */

export type ServerProviderName = "gemini";

export interface ProviderCredential {
  provider: ServerProviderName;
  apiKey: string;
}

/** Thrown when a provider credential is not configured in the server environment. */
export class ProviderCredentialError extends Error {
  readonly code = "provider_credentials_unavailable";
  constructor(provider: ServerProviderName, envVar: string) {
    super(`Credentials for provider "${provider}" are not configured (missing ${envVar}).`);
    this.name = "ProviderCredentialError";
  }
}

const ENV_VAR_BY_PROVIDER: Record<ServerProviderName, string> = {
  gemini: "GEMINI_API_KEY",
};

/**
 * Resolve a provider credential from the server environment.
 * Fails closed: throws rather than returning a partially configured credential.
 */
export function getCredential(provider: ServerProviderName): ProviderCredential {
  const envVar = ENV_VAR_BY_PROVIDER[provider];
  const apiKey = process.env[envVar];

  if (!apiKey || apiKey.trim().length === 0) {
    throw new ProviderCredentialError(provider, envVar);
  }

  return { provider, apiKey };
}

/** Non-throwing configuration probe, for diagnostics. Never returns the value. */
export function isProviderConfigured(provider: ServerProviderName): boolean {
  const envVar = ENV_VAR_BY_PROVIDER[provider];
  const value = process.env[envVar];
  return !!value && value.trim().length > 0;
}
