-- Task 15B, step 1 of 2: READ-ONLY preview. Changes nothing.
-- Run this first, in the SQL editor of the database that serves the live app,
-- and keep the output. 02_apply.sql marks exactly the rows counted under
-- "will be marked failed".
--
-- "Stuck" = still in a non-terminal state, on a job type that the removed
-- simulated handlers used to "complete" (image, video, publishing, social),
-- and now nothing ever will. Rows already completed/failed/cancelled are
-- never selected. Domain rows are matched only through a job_queue row that
-- points at them (payload.job_id for image/video, payload.queue_id for
-- publishing), so unlinked rows are listed separately and left alone.

WITH
stuck_queue AS (
  SELECT status, job_type FROM public.job_queue
  WHERE job_type IN ('image','video','publishing','social')
    AND status NOT IN ('completed','failed','dead_letter','cancelled','dependency_failed')
),
stuck_image AS (
  SELECT ij.id FROM public.image_jobs ij
  WHERE ij.status NOT IN ('completed','failed','cancelled')
    AND EXISTS (SELECT 1 FROM public.job_queue q
                WHERE q.job_type = 'image' AND q.organization_id = ij.organization_id
                  AND q.payload->>'job_id' = ij.id::text)
),
stuck_video AS (
  SELECT vj.id FROM public.video_jobs vj
  WHERE vj.status NOT IN ('completed','failed','cancelled')
    AND EXISTS (SELECT 1 FROM public.job_queue q
                WHERE q.job_type = 'video' AND q.organization_id = vj.organization_id
                  AND q.payload->>'job_id' = vj.id::text)
),
stuck_publishing AS (
  SELECT pq.id FROM public.publishing_queue pq
  WHERE pq.status NOT IN ('published','failed','cancelled')
    AND EXISTS (SELECT 1 FROM public.job_queue q
                WHERE q.job_type IN ('publishing','social') AND q.organization_id = pq.organization_id
                  AND q.payload->>'queue_id' = pq.id::text)
)
SELECT 'will be marked failed' AS kind, 'job_queue (-> dead_letter), ' || job_type || ' / ' || status AS target, count(*) AS n
  FROM stuck_queue GROUP BY job_type, status
UNION ALL SELECT 'will be marked failed', 'image_jobs', count(*) FROM stuck_image
UNION ALL SELECT 'will be marked failed', 'video_jobs', count(*) FROM stuck_video
UNION ALL SELECT 'will be marked failed', 'publishing_queue', count(*) FROM stuck_publishing
UNION ALL SELECT 'NOT touched: non-terminal, no queue link', 'image_jobs', count(*)
  FROM public.image_jobs ij WHERE ij.status NOT IN ('completed','failed','cancelled')
   AND ij.id NOT IN (SELECT id FROM stuck_image)
UNION ALL SELECT 'NOT touched: non-terminal, no queue link', 'video_jobs', count(*)
  FROM public.video_jobs vj WHERE vj.status NOT IN ('completed','failed','cancelled')
   AND vj.id NOT IN (SELECT id FROM stuck_video)
UNION ALL SELECT 'NOT touched: non-terminal, no queue link', 'publishing_queue', count(*)
  FROM public.publishing_queue pq WHERE pq.status NOT IN ('published','failed','cancelled')
   AND pq.id NOT IN (SELECT id FROM stuck_publishing)
UNION ALL SELECT 'NOT touched: already completed by old simulated handler (review separately)', 'job_queue', count(*)
  FROM public.job_queue WHERE status = 'completed' AND job_type IN ('image','video','publishing','social')
ORDER BY 1, 2;
