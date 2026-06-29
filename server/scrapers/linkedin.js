import { cleanText, createBrowserPage, extractEmail, randomDelay } from './utils.js';

export default async function scrapeJobs({ keywords, location, limit = 10 }) {
  const { browser, page } = await createBrowserPage();
  const jobs = [];

  try {
    const url = `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(keywords)}&location=${encodeURIComponent(location)}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay();

    const links = await page.locator('a[href*="/jobs/view/"]').evaluateAll((anchors, max) => {
      const seen = new Set();
      return anchors
        .map((anchor) => ({
          title: anchor.textContent?.trim() || '',
          applyUrl: (anchor.href || '').split('?')[0]
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
        await randomDelay();
        const bodyText = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
        if (/sign in|join linkedin|authwall/i.test(bodyText) && bodyText.length < 1500) {
          console.warn(`LinkedIn page requires login, skipped: ${link.applyUrl}`);
          continue;
        }

        const company = cleanText(
          await page
            .locator('.topcard__org-name-link, .topcard__flavor, a[href*="/company/"]')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => '')
        );
        const locationText = cleanText(
          await page
            .locator('.topcard__flavor--bullet, span[class*="location"]')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => location)
        );

        jobs.push({
          title: link.title || 'Unknown',
          company: company || 'Unknown',
          location: locationText || location,
          jdText: bodyText,
          applyUrl: link.applyUrl,
          recruiterEmail: extractEmail(bodyText),
          source: 'linkedin',
          scrapedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn(`LinkedIn job skipped: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`LinkedIn scrape failed: ${error.message}`);
  } finally {
    await browser.close();
  }

  return jobs;
}
