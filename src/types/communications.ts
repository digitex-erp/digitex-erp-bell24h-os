/** Wire types for /api/communications/* (server: server/communication/routes.ts). */

export type CommChannel = "email" | "sms" | "whatsapp";

export type MessageStatus = "queued" | "scheduled" | "sending" | "sent" | "delivered" | "failed" | "cancelled" | "dead_letter";

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed" | "failed" | "cancelled";

export type RecipientStatus = "pending" | "queued" | "sent" | "failed" | "cancelled";

export interface CommTemplate {
  id: string;
  name: string;
  channel_type: string;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
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
  created_at: string;
}

export interface CommCampaignDetail {
  campaign: CommCampaign;
  recipientCounts: Record<RecipientStatus, number>;
  lastTest: { id: string; status: string; recipient: string; error_message: string | null; created_at: string } | null;
  /** True only once a real test message reached sent/delivered. */
  testVerified: boolean;
}

export interface CommAudienceSummary {
  requested: number;
  resolved: number;
  notFound: number;
  invalidAddress: number;
  duplicate: number;
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
