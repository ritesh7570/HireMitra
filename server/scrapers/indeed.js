import { cleanText, createBrowserPage, extractEmail, randomDelay } from './utils.js';

export default async function scrapeJobs({ keywords, location, limit = 20 }) {
  const { browser, page } = await createBrowserPage();
  const jobs = [];

  try {
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    const url = `https://in.indeed.com/jobs?q=${encodeURIComponent(keywords)}&l=${encodeURIComponent(location)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay(2500, 4500);

    const body = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
    if (/captcha|unusual traffic|verify/i.test(body)) {
      console.warn('Indeed appears to be blocking automation, skipped.');
      return jobs;
    }

    const links = await page.locator('a[href*="/viewjob"]').evaluateAll((anchors, max) => {
      const seen = new Set();
      return anchors
        .map((anchor) => ({
          title: anchor.textContent?.trim() || '',
          applyUrl: new URL(anchor.getAttribute('href') || '', 'https://in.indeed.com').href
        }))
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
        await randomDelay(2500, 4500);
        const jdText = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
        const company = cleanText(
          await page
            .locator('[data-testid="inlineHeader-companyName"], [data-company-name="true"]')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => '')
        );

        jobs.push({
          title: link.title || 'Unknown',
          company: company || 'Unknown',
          location: location || 'India',
          jdText,
          applyUrl: link.applyUrl,
          recruiterEmail: extractEmail(jdText),
          source: 'indeed',
          scrapedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn(`Indeed job skipped: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`Indeed scrape failed: ${error.message}`);
  } finally {
    await browser.close();
  }

  return jobs;
}
