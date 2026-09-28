/**
 * ProviderAdminService — what the admin "Providers" tab shows and can do.
 *
 * Honesty rules (the whole point of this tab is to NOT overstate readiness):
 *  - `implementation` says whether an adapter can send at all ("stub" cannot).
 *  - `credentialsConfigured` is a real check: the secret name is allow-listed AND present in the
 *    server environment. The value is never read into a response.
 *  - `verified` is true ONLY when a real send through this provider row has succeeded
 *    (communication_deliveries has a 'success' attempt). Configuration alone is never "verified".
 *  - `healthStatus` comes from communication_providers.health_status, which is written ONLY by
 *    runHealthCheck() below after a real adapter.healthCheck() call. It is 'unknown' until then.
 *  - Provider rows are not editable here or anywhere in the API: they are operator-managed SQL
 *    (see add_communication_hub.sql, B1). This service only reads them and runs health checks.
 */

import type pg from "pg";
import { emitAuditEvent, newRequestId } from "../audit.js";
import { isAllowedSecretRef, ProviderFactory, UnknownProviderError } from "./providers/ProviderFactory.js";
import { validateUuid } from "./validation.js";

export class ProviderNotFoundError extends Error {
  constructor() {
    super("Provider not found in this organization.");
  }
}

export interface ProviderView {
  id: string;
  name: string;
  provider: string;
  channelType: string;
  priority: number;
  isActive: boolean;
  implementation: "live-capable" | "stub" | "unknown";
  credentialsRef: string;
  credentialsConfigured: boolean;
  settingsSummary: Record<string, unknown>;
  healthStatus: string;
  lastHealthCheckAt: string | null;
  verified: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

/** Only these non-secret settings keys are ever returned. */
const SETTINGS_ALLOWLIST = ["fromAddress", "from_address", "host", "port", "secure", "phoneNumberId", "apiVersion", "templateName", "templateLanguage"];

export class ProviderAdminService {
  constructor(private pool: pg.Pool) {}

  async list(organizationId: string): Promise<ProviderView[]> {
    const res = await this.pool.query(
      `SELECT p.id, p.name, p.provider, p.channel_type, p.priority, p.is_active, p.health_status,
              p.last_health_check_at, p.credentials_secret_ref, p.settings,
              (SELECT MAX(d.attempted_at) FROM public.communication_deliveries d WHERE d.provider_id = p.id AND d.status = 'success') AS last_success_at,
              (SELECT MAX(d.attempted_at) FROM public.communication_deliveries d WHERE d.provider_id = p.id AND d.status = 'failed') AS last_failure_at
         FROM public.communication_providers p
        WHERE p.organization_id = $1
        ORDER BY p.channel_type, p.priority, p.name`,
      [organizationId],
    );
    return res.rows.map((r: any) => {
      let implementation: ProviderView["implementation"] = "unknown";
      try {
        implementation = ProviderFactory.getAdapter(r.provider).isStub ? "stub" : "live-capable";
      } catch (err) {
        if (!(err instanceof UnknownProviderError)) throw err;
      }
      const settings = (r.settings ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        name: r.name,
        provider: r.provider,
        channelType: r.channel_type,
        priority: r.priority,
        isActive: r.is_active,
        implementation,
        credentialsRef: r.credentials_secret_ref,
        credentialsConfigured: isAllowedSecretRef(r.provider, r.credentials_secret_ref) && Boolean(process.env[r.credentials_secret_ref]),
        settingsSummary: Object.fromEntries(SETTINGS_ALLOWLIST.filter((k) => k in settings).map((k) => [k, settings[k]])),
        healthStatus: r.health_status ?? "unknown",
        lastHealthCheckAt: r.last_health_check_at,
        verified: r.last_success_at !== null,
        lastSuccessAt: r.last_success_at,
        lastFailureAt: r.last_failure_at,
      } satisfies ProviderView;
    });
  }

  /**
   * Runs a REAL adapter.healthCheck() with the server-side credential. Records the outcome only when a
   * check was actually attempted; "stub" and "no credentials" are reported but never written as
   * 'healthy' or 'down'.
   */
  async runHealthCheck(
    organizationId: string,
    actor: string,
    providerId: string,
  ): Promise<{ status: "healthy" | "down" | "not_implemented" | "not_configured"; detail?: string; checkedAt?: string }> {
    const id = validateUuid(providerId, "providerId");
    const found = await this.pool.query(
      `SELECT id, provider, credentials_secret_ref, settings FROM public.communication_providers WHERE id = $1 AND organization_id = $2`,
      [id, organizationId],
    );
    if (found.rows.length === 0) throw new ProviderNotFoundError();
    const row = found.rows[0] as { id: string; provider: string; credentials_secret_ref: string; settings: Record<string, unknown> };

    let adapter;
    try {
      adapter = ProviderFactory.getAdapter(row.provider);
    } catch {
      return { status: "not_implemented", detail: "No adapter is registered for this provider." };
    }
    if (adapter.isStub) return { status: "not_implemented", detail: "This provider is a non-functional stub." };

    let config;
    try {
      config = ProviderFactory.buildResolvedConfig(row.provider, row.credentials_secret_ref, row.settings ?? {});
    } catch {
      return { status: "not_configured", detail: "Credentials are not configured on the server for this provider." };
    }

    const result = await adapter.healthCheck(config);
    const status = result.healthy ? "healthy" : "down";
    await this.pool.query(
      `UPDATE public.communication_providers SET health_status = $1, last_health_check_at = NOW(), updated_at = NOW() WHERE id = $2 AND organization_id = $3`,
      [status, row.id, organizationId],
    );
    emitAuditEvent({
      actor,
      organizationId,
      action: "communication.provider.health_check",
      targetType: "communication_provider",
      targetId: row.id,
      outcome: result.healthy ? "success" : "failure",
      requestId: newRequestId(),
      metadata: { provider: row.provider, status },
    });
    return { status, detail: result.detail, checkedAt: result.checkedAt };
  }
}
