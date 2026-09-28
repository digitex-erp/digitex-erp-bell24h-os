/**
 * Communication Hub — shared types.
 *
 * Scope: schema + provider abstraction slice. API routes and admin UI are
 * deliberately out of scope for this pass (see COMMUNICATION_HUB_IMPLEMENTATION_REPORT.md).
 *
 * Provider-agnostic by construction: nothing here names a specific vendor.
 * server/communication/providers/ProviderFactory.ts is the only place that
 * maps a provider string (e.g. "resend", "smtp") to a concrete adapter.
 */

export type ChannelType = "email" | "sms" | "whatsapp" | "voice" | "push";

export type MessageStatus =
  | "queued"
  | "scheduled"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "cancelled"
  | "dead_letter";

export type CampaignStatus = "draft" | "scheduled" | "running" | "completed" | "failed" | "cancelled";

export type LogEvent =
  | "queued"
  | "scheduled"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "retried"
  | "dead_lettered"
  | "cancelled";

export type DeliveryStatus = "attempted" | "success" | "failed";

export interface CommunicationProvider {
  id: string;
  organization_id: string;
  name: string;
  provider: string;
  channel_type: ChannelType;
  credentials_secret_ref: string;
  priority: number;
  settings: Record<string, unknown>;
  is_active: boolean;
  health_status: "unknown" | "healthy" | "degraded" | "down";
  last_health_check_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationTemplate {
  id: string;
  organization_id: string;
  name: string;
  channel_type: ChannelType;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationMessage {
  id: string;
  organization_id: string;
  channel_type: ChannelType;
  provider_id: string | null;
  template_id: string | null;
  campaign_id: string | null;
  job_id: string | null;
  recipient: string;
  subject: string | null;
  body: string | null;
  variables_used: Record<string, unknown>;
  /** WhatsApp only: the Meta template reference actually handed to the provider for this message. */
  provider_template?: { name: string; language: string; parameters: string[] } | null;
  status: MessageStatus;
  provider_message_id: string | null;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
  is_test?: boolean;
  scheduled_at: string | null;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationDelivery {
  id: string;
  organization_id: string;
  message_id: string;
  provider_id: string | null;
  provider: string;
  attempt_number: number;
  status: DeliveryStatus;
  provider_message_id: string | null;
  error_message: string | null;
  raw_response: unknown;
  attempted_at: string;
  created_at: string;
}

export interface CommunicationWebhook {
  id: string;
  organization_id: string;
  provider: string;
  event_type: string;
  provider_message_id: string | null;
  message_id: string | null;
  payload: unknown;
  signature_verified: boolean;
  received_at: string;
  created_at: string;
}

/** Input to CommunicationService.sendMessage() / sendBulkMessages(). */
export interface SendMessageInput {
  organizationId: string;
  channelType: ChannelType;
  templateId?: string;
  campaignId?: string;
  recipient: string;
  /** Only used when templateId is not supplied. */
  subject?: string;
  body?: string;
  variables?: Record<string, unknown>;
  createdBy?: string;
  /** Caller-supplied key; the same (organizationId, idempotencyKey) always maps to one message. */
  idempotencyKey?: string;
  /** Test sends are real sends to one operator-chosen address; they never count toward campaign totals. */
  isTest?: boolean;
}

export interface ScheduleMessageInput extends SendMessageInput {
  scheduledAt: Date;
}

// ---------------------------------------------------------------------------
// ProviderAdapter contract — the ONLY interface CommunicationService and
// CommunicationJobHandler depend on. A new provider is added by implementing
// this interface and registering it in ProviderFactory; nothing else in the
// service layer changes. Do not hardcode a provider's API inside
// CommunicationService.
// ---------------------------------------------------------------------------

export interface OutboundMessage {
  /** WhatsApp only: send as this approved Meta TEMPLATE (overrides the provider-level default template). */
  template?: { name: string; language: string; parameters: string[] };
  recipient: string;
  subject?: string;
  body: string;
  variables?: Record<string, unknown>;
  /** Stable per-message key. Passed to providers that support idempotent sends so a worker
   *  re-run after a crash cannot deliver a second copy (Resend: Idempotency-Key header). */
  idempotencyKey?: string;
  /** Campaign email only: the signed one-click unsubscribe link, sent as List-Unsubscribe headers (RFC 8058). */
  unsubscribeUrl?: string;
}

/** Non-secret settings resolved from communication_providers.settings, plus
 *  the resolved secret value (never persisted — resolved at call time from
 *  Bell24h-OS server-side secrets, see ProviderFactory.resolveSecret()). */
export interface ResolvedProviderConfig {
  provider: string;
  secretValue: string;
  settings: Record<string, unknown>;
}

export interface AdapterSendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
  /** Raw provider response, stored in communication_deliveries.raw_response — never logged with secrets in it. */
  raw?: unknown;
}

export interface AdapterStatusResult {
  status: MessageStatus;
  raw?: unknown;
}

export interface AdapterValidationResult {
  valid: boolean;
  reason?: string;
}

export interface AdapterHealthResult {
  healthy: boolean;
  detail?: string;
  checkedAt: string;
}

export interface ProviderAdapter {
  /** Registry key, must match communication_providers.provider. */
  readonly provider: string;
  readonly channelType: ChannelType;
  /** True for a placeholder that cannot send. Real adapters leave this undefined. */
  readonly isStub?: boolean;

  send(message: OutboundMessage, config: ResolvedProviderConfig): Promise<AdapterSendResult>;
  status(providerMessageId: string, config: ResolvedProviderConfig): Promise<AdapterStatusResult>;
  validate(config: ResolvedProviderConfig): Promise<AdapterValidationResult>;
  healthCheck(config: ResolvedProviderConfig): Promise<AdapterHealthResult>;
}
