import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'bullmq';
import { createQueue, createConnection, queueName } from './workers/queue.js';
import { processJob } from './workers/processor.js';
import { scrapeAll } from './scrapers/index.js';
import { disconnectApplicationStore } from './services/applicationStore.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const scrapedJobsPath = path.join(serverDir, 'data', 'scraped_jobs.json');
const cacheMaxAgeMs = 6 * 60 * 60 * 1000;

async function fileExistsFresh(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return Date.now() - stat.mtimeMs < cacheMaxAgeMs;
  } catch {
    return false;
  }
}

async function loadJobs({ fresh }) {
  if (!fresh && (await fileExistsFresh(scrapedJobsPath))) {
    const raw = await fs.readFile(scrapedJobsPath, 'utf8');
    return JSON.parse(raw);
  }

  const keywords = process.env.SCRAPE_KEYWORDS || 'backend developer node.js';
  const location = process.env.SCRAPE_LOCATION || 'India';
  const limit = Number(process.env.SCRAPE_LIMIT) || 10;
  const { jobs, counts } = await scrapeAll(keywords, location, limit);
  await fs.mkdir(path.dirname(scrapedJobsPath), { recursive: true });
  await fs.writeFile(scrapedJobsPath, JSON.stringify(jobs, null, 2), 'utf8');
  console.log(
    `Scraped ${counts.naukri || 0} jobs from Naukri, ${counts.wellfound || 0} from Wellfound, ` +
      `${counts.linkedin || 0} from LinkedIn, ${counts.indeed || 0} from Indeed, ` +
      `${counts.internshala || 0} from Internshala, ${counts.companyPages || 0} from company pages`
  );
  return jobs;
}

async function waitForQueue(worker, expectedCount) {
  const results = [];
  return new Promise((resolve) => {
    worker.on('completed', (job, result) => {
      results.push({ id: job.id, ...result });
      if (results.length === expectedCount) resolve(results);
    });
    worker.on('failed', (job, error) => {
      results.push({
        id: job?.id,
        company: job?.data?.company || 'Unknown',
        role: job?.data?.title || 'Unknown',
        status: 'failed',
        score: 0,
        emailSent: false,
        error: error.message
      });
      if (results.length === expectedCount) resolve(results);
    });
  });
}

function printSummary(results) {
  const rows = results.map((result) => ({
    Company: result.company,
    Role: result.role,
    Score: result.score,
    Status: result.status,
    Email: result.emailSent ? 'sent' : 'skipped'
  }));
  console.table(rows);
}

async function main() {
  const fresh = process.argv.includes('--fresh');
  const scrapeOnly = process.argv.includes('--scrape-only');
  const jobs = await loadJobs({ fresh: fresh || scrapeOnly });

  if (!jobs.length) {
    console.log('No jobs found for pipeline processing.');
    return;
  }

  if (scrapeOnly) {
    console.log(`Scrape-only complete. Saved ${jobs.length} jobs to ${scrapedJobsPath}`);
    return;
  }

  const connection = createConnection();
  const queue = createQueue(connection);
  await queue.drain(true);

  // See workers/jobWorker.js for why this stays at concurrency 1 — Gemini's free tier
  // is 5 requests/minute and each job makes 5+ sequential calls.
  const worker = new Worker(queueName, processJob, {
    connection,
    concurrency: 1,
    limiter: { max: 4, duration: 60000 }
  });

  const resultsPromise = waitForQueue(worker, jobs.length);

  for (const [index, job] of jobs.entries()) {
    await queue.add(`job-${index + 1}`, job, {
      removeOnComplete: true,
      removeOnFail: true
    });
  }

  const results = await resultsPromise;
  printSummary(results);

  await worker.close();
  await queue.close();
  await connection.quit();
  await disconnectApplicationStore();
}

await main().catch((error) => {
  console.error(`Pipeline failed: ${error.message}`);
  process.exitCode = 1;
});
