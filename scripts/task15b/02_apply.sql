-- Task 15B, step 2 of 2: WRITES. Run only after 01_preview_counts.sql, against
-- the same database, and only if its "will be marked failed" counts match what
-- you expect. Runs in one transaction; the final SELECT shows what changed.
-- Idempotent: marked rows are terminal, so a second run changes 0 rows.
--
-- Reason recorded where the table has a column for it:
--   'Task 15 - simulated handler removed, job was never genuinely processed.'
-- publishing_queue has no reason column and no schema change is made, so the
-- reason is only recorded on the matching job_queue rows.
-- Never uses row removal or schema changes, never touches a completed, failed
-- or cancelled row, and never touches a row that is not linked to an
-- image/video/publishing/social job_queue row.

BEGIN;

CREATE TEMP TABLE _t15b_result (target text, n bigint) ON COMMIT DROP;

WITH u AS (
  UPDATE public.image_jobs ij
  SET status = 'failed',
      error_message = 'Task 15 - simulated handler removed, job was never genuinely processed.'
  WHERE ij.status NOT IN ('completed','failed','cancelled')
    AND EXISTS (SELECT 1 FROM public.job_queue q
                WHERE q.job_type = 'image' AND q.organization_id = ij.organization_id
                  AND q.payload->>'job_id' = ij.id::text)
  RETURNING 1)
INSERT INTO _t15b_result SELECT 'image_jobs', count(*) FROM u;

WITH u AS (
  UPDATE public.video_jobs vj
  SET status = 'failed',
      error_message = 'Task 15 - simulated handler removed, job was never genuinely processed.'
  WHERE vj.status NOT IN ('completed','failed','cancelled')
    AND EXISTS (SELECT 1 FROM public.job_queue q
                WHERE q.job_type = 'video' AND q.organization_id = vj.organization_id
                  AND q.payload->>'job_id' = vj.id::text)
  RETURNING 1)
INSERT INTO _t15b_result SELECT 'video_jobs', count(*) FROM u;

WITH u AS (
  UPDATE public.publishing_queue pq
  SET status = 'failed'
  WHERE pq.status NOT IN ('published','failed','cancelled')
    AND EXISTS (SELECT 1 FROM public.job_queue q
                WHERE q.job_type IN ('publishing','social') AND q.organization_id = pq.organization_id
                  AND q.payload->>'queue_id' = pq.id::text)
  RETURNING 1)
INSERT INTO _t15b_result SELECT 'publishing_queue', count(*) FROM u;

-- Queue rows last: the domain updates above match through these rows.
WITH u AS (
  UPDATE public.job_queue
  SET status = 'dead_letter',
      dead_letter_reason = 'Task 15 - simulated handler removed, job was never genuinely processed.',
      error_details = jsonb_build_object(
        'message', 'Task 15 - simulated handler removed, job was never genuinely processed.',
        'code', 'NOT_IMPLEMENTED',
        'failed_at', now()),
      locked_by = NULL, locked_at = NULL, lock_expires_at = NULL,
      updated_at = NOW()
  WHERE job_type IN ('image','video','publishing','social')
    AND status NOT IN ('completed','failed','dead_letter','cancelled','dependency_failed')
  RETURNING 1)
INSERT INTO _t15b_result SELECT 'job_queue (-> dead_letter)', count(*) FROM u;

SELECT target, n AS rows_marked_failed FROM _t15b_result ORDER BY target;

COMMIT;
