import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scrapedJobsPath = path.join(serverDir, 'data', 'scraped_jobs.json');

router.get('/', async (req, res) => {
  try {
    const raw = await fs.readFile(scrapedJobsPath, 'utf8').catch(() => '[]');
    res.json({ items: JSON.parse(raw) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete a single job from scraped_jobs.json by its applyUrl (the natural unique key).
router.delete('/', async (req, res) => {
  try {
    const { applyUrl } = req.body;
    if (!applyUrl) return res.status(400).json({ error: 'applyUrl is required.' });
    const raw = await fs.readFile(scrapedJobsPath, 'utf8').catch(() => '[]');
    const jobs = JSON.parse(raw);
    const filtered = jobs.filter((j) => j.applyUrl !== applyUrl);
    if (filtered.length === jobs.length) return res.status(404).json({ error: 'Job not found.' });
    await fs.writeFile(scrapedJobsPath, JSON.stringify(filtered, null, 2), 'utf8');
    res.json({ ok: true, remaining: filtered.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
