/** Wire types for /api/communications/* (server: server/communication/routes.ts). */

export type CommChannel = "email" | "sms" | "whatsapp";

export type MessageStatus = "queued" | "scheduled" | "sending" | "sent" | "delivered" | "failed" | "cancelled" | "dead_letter";

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type RecipientStatus = "pending" | "queued" | "sent" | "failed" | "cancelled" | "suppressed";

export interface CommTemplate {
  id: string;
  name: string;
  channel_type: string;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
  /** WhatsApp only: the Meta-approved template this maps to. Approval happens in Meta and is NOT checked here. */
  provider_template_name?: string | null;
  provider_template_language?: string;
  /** Ordered: entry 1 fills Meta's {{1}}, entry 2 fills {{2}} … */
  provider_template_variables?: string[];
  /** Derived from the message log: verified_by_send only after a provider accepted a real message that used it. */
  provider_template_status?: "not_mapped" | "unverified" | "verified_by_send";
}

export interface CommLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  /** The address for the chosen channel passes the same validation a send applies. */
  usable: boolean;
}

export interface CommCampaign {
  id: string;
  name: string;
  channel_type: CommChannel;
  template_id: string | null;
  status: CampaignStatus;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  consent_confirmed_at: string | null;
  run_count: number;
  started_at: string | null;
  completed_at: string | null;
  paused_reason: string | null;
  audience: { type: "contacts" | "list" | "segment"; id?: string } | null;
  audience_summary: CommAudienceSummary | null;
  created_at: string;
}

export interface CommCampaignDetail {
  campaign: CommCampaign;
  recipientCounts: Record<RecipientStatus, number>;
  lastTest: { id: string; status: string; recipient: string; error_message: string | null; created_at: string } | null;
  /** True only once a real test message reached sent/delivered. */
  testVerified: boolean;
  /** Email campaigns need a signed unsubscribe link; false = the server has no COMM_UNSUBSCRIBE_SECRET / COMM_PUBLIC_BASE_URL. */
  unsubscribeReady: boolean;
}

export interface CommAudienceSummary {
  requested: number;
  resolved: number;
  notFound: number;
  invalidAddress: number;
  duplicate: number;
  /** Left out because the address is on the organization's suppression list. */
  suppressed: number;
}

export interface CommRecipient {
  id: string;
  recipient: string;
  display_name: string | null;
  status: RecipientStatus;
  message_id: string | null;
  error_message: string | null;
  updated_at: string;
}

export interface CommLogRow {
  message_id: string;
  campaign_id: string | null;
  channel_type: string;
  recipient: string;
  status: MessageStatus;
  is_test: boolean;
  error_message: string | null;
  retry_count: number;
  attempts: number;
  last_provider: string | null;
  last_attempt_at: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface CommAttempt {
  attempt_number: number;
  provider: string;
  status: "attempted" | "success" | "failed";
  error_message: string | null;
  attempted_at: string;
}

export interface CommProvider {
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

export interface CommHealthResult {
  status: "healthy" | "down" | "not_implemented" | "not_configured";
  detail?: string;
  checkedAt?: string;
}

export interface CommWorkerEvidence {
  queuedJobs: number;
  oldestQueuedAt: string | null;
  runningJobs: number;
  deadLetterJobs: number;
  lastJobCompletedAt: string | null;
}

export interface CommDashboard {
  messages: { last24h: Record<string, number>; last7d: Record<string, number> };
  quota: { channel: CommChannel; used: number; limit: number }[];
  campaigns: Record<string, number>;
  scheduled: { count: number; nextAt: string | null };
  worker: CommWorkerEvidence;
  providers: { total: number; canSend: number; credentialsConfigured: number; verified: number };
}

export interface CommSchedule {
  id: string;
  name: string;
  channel_type: CommChannel;
  status: CampaignStatus;
  total_recipients: number;
  scheduled_at: string | null;
  run_count: number;
  paused_reason: string | null;
  job_status: string | null;
  job_retry_count: number | null;
  job_due_at: string | null;
  job_completed_at: string | null;
  overdue: boolean;
}

export type SuppressionReason = "unsubscribed" | "bounced" | "complained" | "manual" | "invalid";

export interface CommSuppression {
  id: string;
  channel_type: CommChannel;
  address: string;
  reason: SuppressionReason;
  source: string | null;
  note: string | null;
  created_at: string;
}

export interface CommList {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  member_count: number;
}

export interface CommListMember {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export interface SegmentCriteria {
  listIds?: string[];
  companyContains?: string;
  nameContains?: string;
  createdAfter?: string;
  createdBefore?: string;
}

export interface CommSegment {
  id: string;
  name: string;
  criteria: SegmentCriteria;
  created_at: string;
}

export interface CommSegmentPreview {
  matched: number;
  suppressed: number;
  sample: { id: string; name: string; company: string | null }[];
}

export type DeliveryTracking = "provider_acceptance_only" | "webhook";

export interface CommCampaignAnalytics {
  campaign: { id: string; name: string; channel: CommChannel; status: CampaignStatus; totalRecipients: number; startedAt: string | null; completedAt: string | null };
  audience: CommAudienceSummary | null;
  recipients: Record<string, number>;
  messages: Record<string, number>;
  rates: { acceptedPercent: number | null; failedPercent: number | null; deliveredPercent: number | null; suppressedPercent: number | null };
  deliveryTracking: DeliveryTracking;
  totals: { messages: number; accepted: number; failed: number; providerAttempts: number; messagesAttempted: number };
  byProvider: { provider: string; n: number }[];
  topFailureReasons: { reason: string; n: number }[];
  sentByHour: { hour: string; count: number }[];
}

export interface CommOrgAnalytics {
  days: number;
  daily: { day: string; accepted: number; failed: number; total: number }[];
  byChannel: Record<string, Record<string, number>>;
  recentCampaigns: { id: string; name: string; channel_type: CommChannel; status: CampaignStatus; total_recipients: number; sent_count: number; failed_count: number; created_at: string }[];
  topFailureReasons: { reason: string; n: number }[];
  suppressions: { channel_type: CommChannel; reason: SuppressionReason; n: number }[];
  audience: { lists: number; segments: number };
  deliveryTracking: Record<CommChannel, DeliveryTracking>;
}
