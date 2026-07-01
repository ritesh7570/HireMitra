import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeAll } from '../scrapers/index.js';
import { createQueue } from '../workers/queue.js';
import { ScrapeRun, scrapeHub, listScrapeRuns } from '../services/scrapeReporter.js';

const router = Router();
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scrapedJobsPath = path.join(serverDir, 'data', 'scraped_jobs.json');
const jobs = new Map();

// One queue instance for the process lifetime (mirrors workers/jobWorker.js's pattern) —
// creating a fresh Queue/connection per request would leak Redis connections.
const queue = createQueue();

router.post('/', async (req, res) => {
  const jobId = `scrape_${Date.now()}`;
  jobs.set(jobId, { status: 'started', counts: null, total: 0, error: '', enqueued: 0 });
  res.json({ jobId, status: 'started' });

  try {
    const keywords = req.body.keywords || process.env.SCRAPE_KEYWORDS || 'backend developer node.js';
    const location = req.body.location || process.env.SCRAPE_LOCATION || 'India';
    const limit = Number(req.body.limit || process.env.SCRAPE_LIMIT) || 20;
    const run = new ScrapeRun();
    const { jobs: scrapedJobs, counts } = await scrapeAll({ keywords, location, limit, reporter: run });
    await fs.mkdir(path.dirname(scrapedJobsPath), { recursive: true });
    await fs.writeFile(scrapedJobsPath, JSON.stringify(scrapedJobs, null, 2), 'utf8');

    // This is the fix: previously scraped jobs were only ever written to disk — the
    // BullMQ worker never saw them, so "Run full pipeline now" silently did nothing
    // beyond scraping. Enqueueing here makes it actually trigger the full
    // eligibility -> tailor -> email/apply/notify pipeline per job.
    for (const [index, scrapedJob] of scrapedJobs.entries()) {
      // companyWatchlist jobs get priority 1 (highest in BullMQ — lower = first).
      // All other sources get priority 10 so watchlist jobs always drain first.
      const priority = scrapedJob.source === 'companyWatchlist' ? 1 : 10;
      await queue.add(`scrape-${jobId}-${index + 1}`, scrapedJob, {
        priority,
        removeOnComplete: true,
        removeOnFail: true
      });
    }

    jobs.set(jobId, { status: 'completed', counts, total: scrapedJobs.length, error: '', enqueued: scrapedJobs.length });
  } catch (error) {
    jobs.set(jobId, { status: 'failed', counts: null, total: 0, error: error.message, enqueued: 0 });
  }
});

const SSE_EVENTS = ['source-started', 'source-progress', 'source-done', 'source-error', 'source-skipped', 'run-complete'];

// Must be registered before GET /status/:jobId — otherwise Express would match
// "/status/stream" as that route with jobId="stream" instead of reaching this one.
// Subscribes to the shared scrapeHub (not a specific run), so a client that connects
// before a scrape starts still sees that run's events once it begins.
router.get('/status/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.write('retry: 3000\n\n');

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const listeners = SSE_EVENTS.map((event) => {
    const handler = (payload) => send(event, payload);
    scrapeHub.on(event, handler);
    return [event, handler];
  });

  // Keeps intermediary proxies/load balancers from timing out an idle connection.
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    for (const [event, handler] of listeners) scrapeHub.off(event, handler);
  });
});

router.get('/status/:jobId', (req, res) => {
  res.json(jobs.get(req.params.jobId) || { status: 'unknown', error: 'Scrape job not found.' });
});

router.get('/runs', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    res.json({ runs: await listScrapeRuns(limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
