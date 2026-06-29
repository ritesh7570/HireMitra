import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanText, createBrowserPage, extractEmail, randomDelay } from './utils.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesPath = path.join(serverDir, 'data', 'company_pages.json');

async function readCompanyPages() {
  const raw = await fs.readFile(pagesPath, 'utf8').catch(() => '[]');
  return JSON.parse(raw);
}

export default async function scrapeJobs({ keywords, location, limit = 20 }) {
  const companyPages = await readCompanyPages();
  const { browser, page } = await createBrowserPage();
  const jobs = [];

  try {
    for (const companyPage of companyPages) {
      if (jobs.length >= limit) break;
      try {
        await page.goto(companyPage.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await randomDelay();

        const selector = companyPage.selector || 'a[href]';
        const links = await page.locator(selector).evaluateAll(
          (elements, args) =>
            elements
              .map((element) => {
                const anchor = element.matches('a') ? element : element.querySelector('a[href]');
                return {
                  title: element.textContent?.trim() || '',
                  applyUrl: anchor ? new URL(anchor.getAttribute('href'), args.baseUrl).href : ''
                };
              })
              .filter((item) => item.applyUrl && /job|career|opening|position/i.test(item.title + item.applyUrl))
              .slice(0, args.limit),
          { baseUrl: companyPage.url, limit: Math.max(limit - jobs.length, 1) }
        );

        for (const link of links) {
          if (jobs.length >= limit) break;
          await page.goto(link.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await randomDelay();
          const jdText = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
          if (keywords && !new RegExp(keywords.split(/\s+/).filter(Boolean).join('|'), 'i').test(jdText)) {
            continue;
          }
          jobs.push({
            title: link.title || 'Unknown',
            company: companyPage.company || 'Unknown',
            location: location || 'India',
            jdText,
            applyUrl: link.applyUrl,
            recruiterEmail: extractEmail(jdText),
            source: 'companyPages',
            scrapedAt: new Date().toISOString()
          });
        }
      } catch (error) {
        console.warn(`Company page skipped (${companyPage.company || companyPage.url}): ${error.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return jobs;
}
