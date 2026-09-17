/**
 * Bell24h-OS Enterprise Edition
 * Queue Core Types & Canonical Interfaces
 * Phase: B.5B.1 Queue Core
 */

export type JobStatus =
  | 'queued'
  | 'blocked'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'dependency_failed'
  | 'dead_letter'
  | 'cancelled';

export type JobPriority = 'critical' | 'high' | 'medium' | 'low';

export type JobType =
  | 'content'
  | 'image'
  | 'video'
  | 'voice'
  | 'publishing'
  | 'seo'
  | 'automation'
  | 'analytics'
  | 'intelligence_requirement'
  | 'match_rfq'
  | 'communication'
  | string;

export interface QueueJob<T = any> {
  id: string;
  organization_id: string;
  status: JobStatus;
  job_type: JobType;
  payload: T;
  priority: JobPriority;
  retry_count: number;
  max_retries: number;
  scheduled_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  locked_by: string | null;
  locked_at: Date | null;
  lock_expires_at: Date | null;
  heartbeat_at: Date | null;
  timeout_ms: number;
  next_run_at: Date | null;
  idempotency_key: string | null;
  dead_letter_reason: string | null;
  error_details: Record<string, any> | null;
}

export interface EnqueueJobOptions<T = any> {
  organizationId: string;
  jobType: JobType;
  payload: T;
  priority?: JobPriority;
  idempotencyKey?: string;
  scheduledAt?: Date;
  timeoutMs?: number;
  maxRetries?: number;
  dependencies?: string[];
}

export interface ClaimJobsOptions {
  workerId: string;
  supportedTypes?: JobType[];
  batchSize?: number;
  lockDurationMs?: number;
  maxConcurrentPerTenant?: number;
}

export interface CompleteJobOptions {
  jobId: string;
  workerId: string;
  result?: any;
}

export interface FailJobOptions {
  jobId: string;
  workerId: string;
  error: Error | string;
  isTerminal?: boolean;
}

export interface RetryJobOptions {
  jobId: string;
  workerId: string;
  error: Error | string;
  customDelayMs?: number;
}

export interface HeartbeatOptions {
  jobId: string;
  workerId: string;
  extendLockMs?: number;
}

export interface QueueMetrics {
  queued: number;
  blocked: number;
  running: number;
  retrying: number;
  completed: number;
  failed: number;
  dead_letter: number;
  oldest_queued_age_seconds: number | null;
}
