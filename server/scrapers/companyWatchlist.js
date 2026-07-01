// Scraper for the user-defined company watchlist (server/data/target_companies.json).
// Each entry specifies a careers page URL and an optional CSS selector for job cards.
// If no selector is given, falls back to dumping all links whose text looks like a
// job title and letting Gemini extract structured job data. Priority controls how often
// each company is scraped: 1 = every run, 2 = every 2 runs (>12h), 3 = weekly (>6 days).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBrowserPage, randomDelay } from './utils.js';
import { createAiClientFromEnv } from '../services/applicationProcessor.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const companiesPath = path.join(serverDir, 'data', 'target_companies.json');

const JOB_TITLE_PATTERN = /engineer|developer|sde|intern|analyst|designer|manager|scientist|architect|devops|backend|frontend|fullstack|full.stack/i;

// Hours between scrapes per priority level.
const PRIORITY_HOURS = { 1: 0, 2: 12, 3: 144 };

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

function isDue(company) {
  if (!company.lastScrapedAt) return true;
  const minHours = PRIORITY_HOURS[company.priority] ?? 0;
  const hoursSince = (Date.now() - new Date(company.lastScrapedAt).getTime()) / (1000 * 60 * 60);
  return hoursSince >= minHours;
}

async function scrapeWithSelector(page, company) {
  const cards = await page.locator(company.selector).all().catch(() => []);
  const jobs = [];
  for (const card of cards.slice(0, 30)) {
    try {
      const title = (await card.innerText({ timeout: 3000 })).trim().split('\n')[0].trim();
      if (!title || !JOB_TITLE_PATTERN.test(title)) continue;
      const link = await card.locator('a').first().getAttribute('href').catch(() => null);
      const applyUrl = link
        ? link.startsWith('http')
          ? link
          : new URL(link, company.careersUrl).href
        : company.careersUrl;
      jobs.push({
        title,
        company: company.name,
        location: 'India',
        jdText: title,
        applyUrl,
        recruiterEmail: null,
        source: 'companyWatchlist',
        scrapedAt: new Date().toISOString()
      });
    } catch {
      // best-effort per card
    }
  }
  return jobs;
}

async function scrapeWithAi(page, company) {
  const allLinks = await page.locator('a').all().catch(() => []);
  const candidates = [];
  for (const link of allLinks.slice(0, 200)) {
    try {
      const text = (await link.innerText({ timeout: 1000 })).trim();
      const href = await link.getAttribute('href').catch(() => null);
      if (text && JOB_TITLE_PATTERN.test(text) && href) {
        candidates.push({ text, href });
      }
    } catch {
      // skip
    }
  }
  if (!candidates.length) return [];

  const aiClient = createAiClientFromEnv();
  const prompt = `You are extracting job listings from a company careers page.
Here are link texts and hrefs found on the page for "${company.name}" (${company.careersUrl}):

${candidates.slice(0, 60).map((c) => `- "${c.text}" → ${c.href}`).join('\n')}

Return a JSON array of job objects. Each object must have:
- title (string)
- location (string, or "India" if unknown)
- applyUrl (string — full absolute URL; resolve relative hrefs against "${company.careersUrl}")

Only include actual job openings. Return [] if nothing looks like a job listing.
Respond ONLY with the JSON array, no explanation.`;

  try {
    const result = await aiClient.generateJson(prompt, 'company watchlist extraction');
    if (!Array.isArray(result)) return [];
    return result.slice(0, 20).map((item) => ({
      title: String(item.title || '').trim(),
      company: company.name,
      location: String(item.location || 'India').trim(),
      jdText: String(item.title || '').trim(),
      applyUrl: String(item.applyUrl || company.careersUrl).trim(),
      recruiterEmail: null,
      source: 'companyWatchlist',
      scrapedAt: new Date().toISOString()
    })).filter((j) => j.title && j.applyUrl);
  } catch {
    return [];
  }
}

async function scrapeCompany(company) {
  let browser;
  try {
    const { browser: b, page } = await createBrowserPage();
    browser = b;
    await page.goto(company.careersUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1000, 2000);

    const jobs = company.selector
      ? await scrapeWithSelector(page, company)
      : await scrapeWithAi(page, company);

    return jobs;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// Main export — same signature as other scrapers so scrapeAll() can include it.
// Also accepts a `companyId` option to scrape just one company (used by test-scrape route).
export default async function scrapeCompanyWatchlist({ companyId } = {}) {
  const companies = await readCompanies();
  const targets = companyId
    ? companies.filter((c) => c.id === companyId)
    : companies.filter(isDue);

  if (!targets.length) return [];

  const allJobs = [];
  const updatedCompanies = [...companies];

  for (const company of targets) {
    try {
      console.log(`[watchlist] Scraping ${company.name}...`);
      const jobs = await scrapeCompany(company);
      allJobs.push(...jobs);
      console.log(`[watchlist] ${company.name}: ${jobs.length} jobs found`);

      const idx = updatedCompanies.findIndex((c) => c.id === company.id);
      if (idx !== -1) {
        updatedCompanies[idx] = { ...updatedCompanies[idx], lastScrapedAt: new Date().toISOString() };
      }
    } catch (error) {
      console.warn(`[watchlist] ${company.name} failed: ${error.message}`);
    }
  }

  await writeCompanies(updatedCompanies);
  return allJobs;
}
