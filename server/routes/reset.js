import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getApplicationModel } from '../services/applicationStore.js';

const router = Router();
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scrapedJobsPath = path.join(serverDir, 'data', 'scraped_jobs.json');

router.delete('/', async (req, res) => {
  try {
    const scope = req.body.scope || 'applications';
    const result = { applicationsDeleted: 0, jobsCleared: false };

    if (scope === 'applications' || scope === 'all') {
      const Application = await getApplicationModel({
        mongoUri: process.env.MONGO_URI,
        mongoDbName: process.env.MONGO_DB_NAME
      });
      const deleted = await Application.deleteMany({});
      result.applicationsDeleted = deleted.deletedCount;
    }

    if (scope === 'jobs' || scope === 'all') {
      await fs.writeFile(scrapedJobsPath, '[]', 'utf8');
      result.jobsCleared = true;
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
