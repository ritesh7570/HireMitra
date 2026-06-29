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

export default router;
