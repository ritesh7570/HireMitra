// Importing this module starts an in-process BullMQ Worker — but only after confirming
// Redis is actually reachable with a single quick probe. This avoids BullMQ's internal
// duplicate connections retrying (and logging) forever when Redis isn't running, which
// is the common case during local dev before anyone runs `npm run pipeline`.
import IORedis from 'ioredis';
import { Worker } from 'bullmq';
import { queueName, createConnection } from './queue.js';
import { processJob } from './processor.js';

async function isRedisReachable(url) {
  const probe = new IORedis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

async function start() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  if (!(await isRedisReachable(url))) {
    console.warn(
      `Job worker not started — Redis unreachable at ${url}. Background auto-apply ` +
        'processing is disabled until Redis is running (run `npm run pipeline` once it is).'
    );
    return null;
  }

  const connection = createConnection();
  // concurrency: 1 — each job makes 5+ sequential Gemini calls (eligibility, resume
  // tailoring, extraction, cold email, referral), and Gemini's free tier is only
  // 5 requests/minute. Running jobs in parallel was blowing through that quota instantly.
  const worker = new Worker(queueName, processJob, {
    connection,
    concurrency: 1,
    limiter: { max: 4, duration: 60000 }
  });
  worker.on('failed', (job, error) => {
    console.error(`Job ${job?.id} failed: ${error.message}`);
  });
  console.log('Job worker started (queue: job-application-pipeline).');
  return worker;
}

const workerPromise = start();
export default workerPromise;
