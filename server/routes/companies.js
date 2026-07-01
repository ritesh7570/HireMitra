import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import scrapeCompanyWatchlist from '../scrapers/companyWatchlist.js';

const router = Router();
const companiesPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'data',
  'target_companies.json'
);

async function readCompanies() {
  try {
    return JSON.parse(await fs.readFile(companiesPath, 'utf8'));
  } catch {
    return [];
  }
}

async function writeCompanies(companies) {
  await fs.writeFile(companiesPath, JSON.stringify(companies, null, 2), 'utf8');
}

function makeId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
}

router.get('/', async (req, res) => {
  try {
    res.json({ companies: await readCompanies() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, careersUrl, selector = '', priority = 1, tags = [] } = req.body;
    if (!name || !careersUrl) return res.status(400).json({ error: 'name and careersUrl are required.' });

    const companies = await readCompanies();
    const entry = { id: makeId(name), name, careersUrl, selector, priority, lastScrapedAt: null, tags };
    companies.push(entry);
    await writeCompanies(companies);
    res.status(201).json({ company: entry });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const companies = await readCompanies();
    const idx = companies.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Company not found.' });

    const { name, careersUrl, selector, priority, tags } = req.body;
    companies[idx] = {
      ...companies[idx],
      ...(name !== undefined && { name }),
      ...(careersUrl !== undefined && { careersUrl }),
      ...(selector !== undefined && { selector }),
      ...(priority !== undefined && { priority }),
      ...(tags !== undefined && { tags })
    };
    await writeCompanies(companies);
    res.json({ company: companies[idx] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const companies = await readCompanies();
    const filtered = companies.filter((c) => c.id !== req.params.id);
    if (filtered.length === companies.length) return res.status(404).json({ error: 'Company not found.' });
    await writeCompanies(filtered);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Runs the watchlist scraper for just this one company and returns a preview — no
// permanent queue enqueue, just shows what would be found.
router.post('/:id/test-scrape', async (req, res) => {
  try {
    const companies = await readCompanies();
    const company = companies.find((c) => c.id === req.params.id);
    if (!company) return res.status(404).json({ error: 'Company not found.' });

    const jobs = await scrapeCompanyWatchlist({ companyId: company.id });
    res.json({ jobs, count: jobs.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
