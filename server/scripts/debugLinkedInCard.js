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

  const cards = page.locator('li:has(a[href*="/in/"])');
  const count = await cards.count();
  console.log(`Found ${count} cards`);
  for (let i = 0; i < Math.min(3, count); i++) {
    const html = await cards.nth(i).innerHTML({ timeout: 5000 });
    console.log(`\n=== CARD ${i} HTML ===`);
    // Print just button elements
    const btns = html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || [];
    btns.forEach(b => console.log(b.slice(0, 500)));
  }
} finally {
  await browser.close();
}
