-- Shared-state rate limiting and concurrency control for server-to-service
-- callers of /api/v1/ai/text (and any future route behind requireServiceAuth).
--
-- Why this table exists at all: Bell24h-OS runs as a Vercel serverless
-- function (api/index.ts). Vercel caches one Express app instance per warm
-- function instance, not per request, but under load it runs MULTIPLE
-- concurrent warm instances, each with its own isolated process memory. An
-- in-memory counter (the existing server/middleware/rateLimit.ts, which
-- documents this exact limitation in its own header comment) only limits
-- requests landing on the SAME instance -- under horizontal scale-out, a
-- caller could receive up to N times the intended limit, where N is the
-- number of concurrently warm instances. Postgres (via the existing
-- getPool() connection already used by QueueManager/WorkerRegistry) is the
-- only shared-state mechanism already present in this codebase; no Redis or
-- other paid service exists or is introduced here.
--
-- Two independent concerns, two tables:
--   1. service_rate_limit_windows -- fixed-window request-count limiting
--      ("how many requests in the last N ms").
--   2. service_concurrency_slots -- in-flight request-count limiting ("how
--      many requests from this caller are being processed right now").
-- A caller can be under its rate-window limit while still having too many
-- requests genuinely in flight at once (e.g. a burst submitted all at
-- once before the window's limit is reached) -- the two tables answer
-- different questions and neither substitutes for the other.
--
-- "identity_key" is the authenticated SERVICE caller's own identity
-- (serviceCaller.system, e.g. "vyaparsethu") -- never a client-supplied
-- header, and never a per-VyaparSethu-customer organization_id, because
-- requireServiceAuth.ts deliberately does not resolve one (see its own
-- header comment, Decision B: "no tenant-mapping table ... no
-- organization_id is ever derived from this credential"). This isolates
-- different authenticated SERVICE callers from each other (forward-
-- compatible for a future second trusted caller); it cannot isolate
-- individual VyaparSethu end customers from each other, because no such
-- identity exists at this authentication layer today.

CREATE TABLE IF NOT EXISTS service_rate_limit_windows (
  limiter_name   TEXT NOT NULL,
  identity_key   TEXT NOT NULL,
  window_start   BIGINT NOT NULL, -- epoch ms, floored to the window boundary
  request_count  INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (limiter_name, identity_key, window_start)
);

-- Supports the cleanup query (delete this caller's own prior, now-expired
-- windows) without a full table scan. No cross-caller index needed since
-- every query is already scoped to (limiter_name, identity_key).
CREATE INDEX IF NOT EXISTS idx_service_rate_limit_windows_lookup
  ON service_rate_limit_windows (limiter_name, identity_key, window_start);

CREATE TABLE IF NOT EXISTS service_concurrency_slots (
  limiter_name   TEXT NOT NULL,
  identity_key   TEXT NOT NULL,
  active_count   INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (limiter_name, identity_key)
);

-- No RLS needed on either table: both are written and read exclusively by
-- server-side code via the pooled service-role-equivalent connection
-- (getPool()), the same access path QueueManager/WorkerRegistry already
-- use -- never through PostgREST, never with an end-user's own token. No
-- browser code path, no anon/authenticated grant, touches either table.
