import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeAll } from '../scrapers/index.js';

const router = Router();
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scrapedJobsPath = path.join(serverDir, 'data', 'scraped_jobs.json');
const jobs = new Map();

router.post('/', async (req, res) => {
  const jobId = `scrape_${Date.now()}`;
  jobs.set(jobId, { status: 'started', counts: null, total: 0, error: '' });
  res.json({ jobId, status: 'started' });

  try {
    const keywords = req.body.keywords || process.env.SCRAPE_KEYWORDS || 'backend developer node.js';
    const location = req.body.location || process.env.SCRAPE_LOCATION || 'India';
    const limit = Number(req.body.limit || process.env.SCRAPE_LIMIT) || 20;
    const { jobs: scrapedJobs, counts } = await scrapeAll(keywords, location, limit);
    await fs.mkdir(path.dirname(scrapedJobsPath), { recursive: true });
    await fs.writeFile(scrapedJobsPath, JSON.stringify(scrapedJobs, null, 2), 'utf8');
    jobs.set(jobId, { status: 'completed', counts, total: scrapedJobs.length, error: '' });
  } catch (error) {
    jobs.set(jobId, { status: 'failed', counts: null, total: 0, error: error.message });
  }
});

router.get('/status/:jobId', (req, res) => {
  res.json(jobs.get(req.params.jobId) || { status: 'unknown', error: 'Scrape job not found.' });
});

export default router;
