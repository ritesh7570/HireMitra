import { cleanText, createBrowserPage, extractEmail, randomDelay } from './utils.js';

export default async function scrapeJobs({ keywords, location, limit = 20 }) {
  const { browser, page } = await createBrowserPage();
  const jobs = [];

  try {
    const url = `https://www.naukri.com/jobs-listings?k=${encodeURIComponent(keywords)}&l=${encodeURIComponent(location)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay();

    const cards = await page.locator('a.title, a[class*="title"]').evaluateAll((links, max) =>
      links.slice(0, max).map((link) => ({
        title: link.textContent?.trim() || '',
        applyUrl: link.href || ''
      })),
      limit
    );

    for (const card of cards) {
      if (!card.applyUrl || jobs.length >= limit) continue;
      try {
        await page.goto(card.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await randomDelay();
        const bodyText = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
        const company = cleanText(
          await page
            .locator('a[href*="company"], div[class*="company"], span[class*="company"]')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => '')
        );
        const locationText = cleanText(
          await page
            .locator('span[class*="location"], div[class*="location"]')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => location)
        );

        jobs.push({
          title: card.title || 'Unknown',
          company: company || 'Unknown',
          location: locationText || location,
          jdText: bodyText,
          applyUrl: card.applyUrl,
          recruiterEmail: extractEmail(bodyText),
          source: 'naukri',
          scrapedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn(`Naukri job skipped: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`Naukri scrape failed: ${error.message}`);
  } finally {
    await browser.close();
  }

  return jobs;
}
