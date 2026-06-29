import { cleanText, createBrowserPage, extractEmail, randomDelay } from './utils.js';

function slugifyKeywords(keywords) {
  return encodeURIComponent(cleanText(keywords).replace(/\s+/g, '-'));
}

export default async function scrapeJobs({ keywords, location, limit = 20 }) {
  const { browser, page } = await createBrowserPage();
  const jobs = [];

  try {
    const url = `https://internshala.com/internships/keywords-${slugifyKeywords(keywords)}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay();

    const cards = await page.locator('a[href*="/internship/detail/"]').evaluateAll((anchors, max) => {
      const seen = new Set();
      return anchors
        .map((anchor) => ({
          title: anchor.textContent?.trim() || '',
          applyUrl: anchor.href || ''
        }))
        .filter((item) => {
          if (!item.applyUrl || seen.has(item.applyUrl)) return false;
          seen.add(item.applyUrl);
          return true;
        })
        .slice(0, max);
    }, limit);

    for (const card of cards) {
      try {
        await page.goto(card.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await randomDelay();
        const bodyText = cleanText(await page.locator('body').innerText({ timeout: 10000 }));
        const company = cleanText(
          await page
            .locator('.company_name, a[href*="/company/"]')
            .first()
            .innerText({ timeout: 3000 })
            .catch(() => '')
        );

        jobs.push({
          title: card.title || 'Unknown',
          company: company || 'Unknown',
          location: location || 'India',
          jdText: bodyText,
          applyUrl: card.applyUrl,
          recruiterEmail: extractEmail(bodyText),
          source: 'internshala',
          autoApplyEligible: true,
          scrapedAt: new Date().toISOString()
        });
      } catch (error) {
        console.warn(`Internshala job skipped: ${error.message}`);
      }
    }
  } catch (error) {
    console.warn(`Internshala scrape failed: ${error.message}`);
  } finally {
    await browser.close();
  }

  return jobs;
}
