import 'dotenv/config';
import { createBrowserPage } from '../scrapers/utils.js';
import { login } from '../applicators/linkedinNetworking.js';
import { getSession, loginAndSave } from '../services/sessionManager.js';

const { browser, page } = await createBrowserPage({ headless: false });
try {
  let cookies = await getSession('linkedin-networking');
  if (cookies) {
    await page.context().addCookies(cookies);
  } else {
    cookies = await loginAndSave('linkedin-networking', page, login, {
      email: process.env.LINKEDIN_NETWORKING_EMAIL,
      password: process.env.LINKEDIN_NETWORKING_PASSWORD
    });
  }

  await page.goto('https://www.linkedin.com/company/minerals-technologies/people/', {
    waitUntil: 'domcontentloaded',
    timeout: 45000
  });
  await new Promise((r) => setTimeout(r, 4000));
  await page.evaluate(() => window.scrollBy(0, 800));
  await new Promise((r) => setTimeout(r, 2000));

  const card = await page.locator('li:has(a[href*="/in/"])').first().innerHTML({ timeout: 5000 });
  console.log('=== CARD HTML ===');
  console.log(card.slice(0, 3000));
} finally {
  await browser.close();
}
