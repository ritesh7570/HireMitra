import { cleanText, createBrowserPage, extractEmail, randomDelay } from './utils.js';

export default async function scrapeJobs({ keywords, location, limit = 20 }) {
  const { browser, page } = await createBrowserPage();
  const jobs = [];

  try {
    const url = `https://wellfound.com/jobs?role=${encodeURIComponent(keywords)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay();

    const links = await page.locator('a[href*="/jobs/"]').evaluateAll((anchors, max) => {
      const seen = new Set();
      return anchors
        .map((anchor) => ({ title: anchor.textContent?.trim() || '', applyUrl: anchor.href || '' }))
        .filter((item) => {
          if (!item.applyUrl || seen.has(item.applyUrl)) return false;
          seen.add(item.applyUrl);
          return true;
        })
        .slice(0, max);
    }, limit);

    for (const link of links) {
      try {
        await page.goto(link.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await randomDelay();
        const bodyText = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
        if (/sign in|log in/i.test(bodyText) && bodyText.length < 1200) {
          console.warn(`Wellfound page requires login, skipped: ${link.applyUrl}`);
          continue;
        }

        const company = cleanText(
          await page
            .locator('[data-test*="Company"], a[href*="/company/"], h2')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => '')
        );

        jobs.push({
          title: link.title || 'Unknown',
          company: company || 'Unknown',
          location: location || 'India',
          jdText: bodyText,
          applyUrl: link.applyUrl,
          recruiterEmail: extractEmail(bodyText),
          source: 'wellfound',
          scrapedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn(`Wellfound job skipped: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`Wellfound scrape failed: ${error.message}`);
  } finally {
    await browser.close();
  }

  return jobs;
}
