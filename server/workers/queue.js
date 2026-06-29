// Shared BullMQ queue setup used by both the standalone pipeline.js script and the
// in-process worker started from server/index.js.
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const queueName = 'job-application-pipeline';

export function createConnection() {
  const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      if (times > 3) return null;
      return Math.min(times * 300, 2000);
    }
  });
  connection.on('error', (error) => {
    console.warn(`Redis connection error: ${error.message}`);
  });
  return connection;
}

export function createQueue(connection = createConnection()) {
  return new Queue(queueName, { connection });
}
