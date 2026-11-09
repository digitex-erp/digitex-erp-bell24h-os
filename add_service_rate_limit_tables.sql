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

-- TASK 13C correction: the paragraph this replaces originally claimed "No
-- RLS needed... no anon/authenticated grant touches either table" -- that
-- claim was wrong, and contradicted this exact repository's own, already-
-- merged evidence. harden_ai_providers_credentials.sql (PR #6) documents,
-- as the confirmed reason IT needed a REVOKE despite no explicit GRANT
-- appearing anywhere in this repo's tracked SQL: "Supabase applies its own
-- platform-level default privileges (ALTER DEFAULT PRIVILEGES ... GRANT ALL
-- ON TABLES TO anon, authenticated, service_role) to every new table in the
-- public schema automatically." These two new tables are new tables in the
-- public schema. The same platform default applies to them, for the same
-- reason it applied to ai_providers before PR #6's fix -- not because any
-- grant is explicit in this file, but because none needs to be for Supabase
-- to add one automatically.
--
-- Unlike ai_providers, neither table here has ANY legitimate PostgREST
-- consumer at all -- no browser code path reads or writes either one; both
-- are written and read exclusively by server-side code via the pooled
-- connection (getPool()), the same access path QueueManager/WorkerRegistry
-- already use. So the fix is simpler than PR #6's: REVOKE everything from
-- anon/authenticated and grant nothing back (PR #6 had to grant back a
-- restricted column set to authenticated because ai_providers genuinely has
-- browser-authenticated readers/writers; these tables do not).
DO $$
DECLARE
    r TEXT;
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['service_rate_limit_windows', 'service_concurrency_slots']
    LOOP
        FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
        LOOP
            EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
        END LOOP;
    END LOOP;
END $$;

-- Defense in depth, independent of the REVOKE above: enable RLS on both
-- tables with zero policies defined. Postgres denies ALL access by default
-- once RLS is enabled and no policy grants anything -- so even if a future
-- change re-grants a table privilege to anon/authenticated without
-- re-reading this comment, RLS is a second, independent barrier that would
-- still have to be separately and deliberately opened before either role
-- could read or write a row. This does not replace the REVOKE above (per
-- this task's own instruction: enabling RLS alone, while leaving incorrect
-- table-level grants in place, would not be sufficient -- a role with a
-- genuine table privilege and a permissive-by-default or missing RLS
-- configuration could still reach these rows; the REVOKE is the primary
-- control, RLS is the secondary one).
ALTER TABLE service_rate_limit_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_concurrency_slots ENABLE ROW LEVEL SECURITY;
