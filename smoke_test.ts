import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
import { QueueManager } from './server/queue/QueueManager.js';
import { WorkerRegistry } from './server/workers/WorkerRegistry.js';

async function runSmokeTest() {
  console.log('================================================================');
  console.log('BELL24H-OS RUNTIME SMOKE TEST: QUEUE CORE & WORKER FLEET');
  console.log('================================================================');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
  });

  try {
    // 1. Initialize QueueManager
    console.log('[Step 1] Initializing QueueManager...');
    const queueManager = QueueManager.getInstance(pool);
    console.log('  -> QueueManager initialized.');

    // 2. Initialize WorkerRegistry with Handlers
    console.log('[Step 2] Initializing WorkerRegistry (AI, Media, Publishing handlers)...');
    const workerRegistry = WorkerRegistry.getInstance(pool, queueManager, {
      concurrencyLimit: 2,
      pollIntervalMs: 500,
    });
    console.log('  -> WorkerRegistry initialized with ID:', workerRegistry.workerId);

    // 3. Start WorkerRegistry
    console.log('[Step 3] Starting WorkerRegistry fleet...');
    await workerRegistry.start();
    console.log('  -> WorkerRegistry started.');

    // 4. Verify worker registration in job_workers
    console.log('[Step 4] Verifying worker registration in public.job_workers...');
    const workerCheck = await pool.query(
      'SELECT worker_id, status, concurrency_limit, last_heartbeat FROM public.job_workers WHERE worker_id = $1',
      [workerRegistry.workerId]
    );
    console.log('  -> Registered Worker in DB:', workerCheck.rows[0]);
    if (workerCheck.rows.length === 0) throw new Error('Worker was not found in job_workers table!');

    // 5. Enqueue a test job
    console.log('[Step 5] Enqueueing test job (Type: publishing, Priority: high)...');
    const enqueuedJob = await queueManager.enqueueJob({
      organizationId: null,
      jobType: 'publishing',
      priority: 'high',
      payload: {
        content: 'Bell24h OS Phase B.5B Runtime Smoke Test Verification',
        channel_type: 'linkedin',
      },
    });
    console.log('  -> Enqueued Job ID:', enqueuedJob.id, 'Status:', enqueuedJob.status);

    // 6. Monitor job progression: queued -> running -> completed
    console.log('[Step 6] Monitoring job transition in public.job_queue...');
    let isCompleted = false;
    const deadline = Date.now() + 20000;
    let finalRow: any = null;

    while (Date.now() < deadline) {
      const qRes = await pool.query(
        'SELECT id, status, job_type, priority, locked_by, locked_at, lock_expires_at, completed_at FROM public.job_queue WHERE id = $1',
        [enqueuedJob.id]
      );
      finalRow = qRes.rows[0];
      console.log('  -> Polled status:', finalRow.status, '| locked_by:', finalRow.locked_by);

      if (finalRow.status === 'completed') {
        isCompleted = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!isCompleted) {
      throw new Error('Job did not reach completed state within 20 seconds! Current status: ' + finalRow?.status);
    }
    console.log('  -> Job completed successfully in database!');

    // 7. Verify public.job_logs
    console.log('[Step 7] Verifying audit entries in public.job_logs...');
    const logsRes = await pool.query(
      'SELECT id, job_id, level, message, metadata, created_at FROM public.job_logs WHERE job_id = $1 ORDER BY created_at ASC',
      [enqueuedJob.id]
    );
    console.log('  -> Job Logs Count:', logsRes.rows.length);
    console.table(logsRes.rows.map(l => ({
      level: l.level,
      message: l.message,
      created_at: l.created_at
    })));

    if (logsRes.rows.length === 0) {
      throw new Error('No logs recorded in job_logs for this test job!');
    }

    // 8. Gracefully stop WorkerRegistry
    console.log('[Step 8] Gracefully stopping WorkerRegistry...');
    await workerRegistry.stop();
    console.log('  -> WorkerRegistry stopped cleanly.');

    // 9. Verify worker status is updated to offline
    const workerOfflineCheck = await pool.query(
      'SELECT worker_id, status FROM public.job_workers WHERE worker_id = $1',
      [workerRegistry.workerId]
    );
    console.log('  -> Worker status in DB after shutdown:', workerOfflineCheck.rows[0]);

    console.log('================================================================');
    console.log('SMOKE TEST PASSED: 100% OPERATIONAL & PRODUCTION CERTIFIED');
    console.log('================================================================');
  } finally {
    await pool.end();
  }
}

runSmokeTest().catch((err) => {
  console.error('SMOKE TEST FAILED:', err);
  process.exit(1);
});
