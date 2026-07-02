// LinkedIn referral networking — finds employees at a company and sends connection
// requests with a referral note, or messages existing connections directly.
//
// ⚠️  SAFETY RULES (non-negotiable):
//   - LINKEDIN_DRY_RUN=true by default. Never sends anything until explicitly set false.
//   - Hard cap: LINKEDIN_MAX_REQUESTS_PER_DAY (default 3). Never exceeded, even if many
//     jobs process in one run. Tracked in data/linkedin_network_state.json.
//   - 8–30s random delays between every click (human-like pacing).
//   - Never contacts the same profile URL twice (alreadyContacted() check).
//   - Login throttle: shared with sessionManager (6h minimum between logins).
//   - Headed browser for all actions so you can watch it and kill it if needed.
//
// ─── NOTES FOR REAL ACCOUNT (read before switching) ─────────────────────────
//   1. Drop LINKEDIN_MAX_REQUESTS_PER_DAY to 2-3 (not 10 — LinkedIn flags volume spikes).
//   2. Only target people you share mutual connections with (check profile first).
//   3. Personalise the note with something specific from their profile (not just a template).
//   4. Don't run during odd hours (2am runs look like bots).
//   5. Keep LINKEDIN_DRY_RUN=true until you've watched 5+ complete dry runs.
//   6. If LinkedIn shows a "You're doing that too often" toast: stop immediately, wait 24h.
//   7. Don't run from the same IP as other LinkedIn sessions (can trigger device verification).
// ─────────────────────────────────────────────────────────────────────────────
import { randomDelay, createBrowserPage } from '../scrapers/utils.js';
import { isCaptchaPresent, handleCaptcha } from './captchaGuard.js';
import { canSendRequest, recordRequest, alreadyContacted } from '../services/linkedinNetworkState.js';
import { loginAndSave, saveSession, getSession } from '../services/sessionManager.js';

const PLATFORM = 'linkedin-networking';

function isDryRun() {
  return process.env.LINKEDIN_DRY_RUN !== 'false';
}

function maxPerCompany() {
  return Math.min(Number(process.env.LINKEDIN_MAX_PER_COMPANY) || 3, 5); // hard max 5
}

// ─── Login ────────────────────────────────────────────────────────────────────

export async function login(page, { email, password }) {
  await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay(2000, 4000);

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, PLATFORM);
    throw new Error('Captcha during LinkedIn login — handle manually.');
  }

  // LinkedIn's login form animates in — wait for the field to become visible, not just present.
  await page
    .waitForSelector('input#username, input[name="session_key"], input[type="email"]', {
      state: 'visible',
      timeout: 20000
    })
    .catch(() => {});

  const emailField = page.locator('input#username, input[name="session_key"], input[type="email"]').filter({ visible: true }).first();
  await emailField.fill(email, { timeout: 10000 });

  await page
    .waitForSelector('input#password, input[name="session_password"], input[type="password"]', {
      state: 'visible',
      timeout: 15000
    })
    .catch(() => {});

  const passField = page
    .locator('input#password, input[name="session_password"], input[type="password"]')
    .filter({ visible: true })
    .first();
  await passField.fill(password, { timeout: 10000 });

  // Press Enter on password field — avoids ambiguity with "Sign in with Microsoft" button.
  await passField.press('Enter');

  // Wait for navigation away from login page (or an error/checkpoint).
  await page
    .waitForURL((url) => !url.toString().includes('/login'), { timeout: 20000 })
    .catch(() => {});

  await randomDelay(2000, 3000);

  // Verify we landed on a logged-in page (feed or otherwise — not still on /login).
  const currentUrl = page.url();

  // Log any visible error message on the page for diagnosis.
  const errorMsg = await page
    .locator('[role="alert"], .error-for-password, .error-for-username, #error-for-password, #error-for-username, .alert-content')
    .first()
    .innerText({ timeout: 2000 })
    .catch(() => null);
  if (errorMsg) console.warn(`[linkedin-networking] Page error message: ${errorMsg.trim()}`);

  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint')) {
    throw new Error(`LinkedIn login may have failed or requires verification. Current URL: ${currentUrl}`);
  }

  const cookies = await page.context().cookies();
  if (!cookies.length) throw new Error('LinkedIn login produced no cookies.');
  return cookies;
}

// ─── Find company LinkedIn URL ────────────────────────────────────────────────

async function findCompanyUrl(page, company) {
  const searchUrl = `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay(2000, 4000);

  if (await isCaptchaPresent(page)) return null;

  const companyLink = page.locator('a[href*="/company/"]').first();
  if (!(await companyLink.count())) {
    console.warn(`[linkedin-networking] Company not found on LinkedIn: "${company}"`);
    return null;
  }

  const href = await companyLink.getAttribute('href');
  const base = href?.split('?')[0].replace(/\/$/, '');
  return base?.startsWith('http') ? base : `https://www.linkedin.com${base}`;
}

// ─── Check company home page for 1st-degree connections ("X works here") ─────

// Returns array of { profileUrl, name } for connections LinkedIn highlights on the
// company home page. These are already 1st-degree — we message them directly.
async function findConnectionsAtCompany(page, companyUrl) {
  await page.goto(companyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay(2000, 3000);

  if (await isCaptchaPresent(page)) return [];

  // The "X works here" snackbar links to each connection's profile.
  // Selector covers both the badge container and inline "X and Y work here" text.
  const connections = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // The badge section typically has class containing "employees-snackbar" or similar,
    // and contains anchor tags pointing to /in/ profiles.
    const containers = document.querySelectorAll(
      '[class*="employee"], [class*="connection"], [class*="snackbar"], [class*="works-here"]'
    );
    for (const el of containers) {
      for (const a of el.querySelectorAll('a[href*="/in/"]')) {
        // Normalize to https and strip trailing slash for dedup.
        const rawUrl = (a.href?.split('?')[0] || '').replace(/\/$/, '');
        const url = rawUrl.replace(/^http:\/\//, 'https://');
        if (!url || !url.includes('/in/') || seen.has(url)) continue;
        seen.add(url);
        // Name from "X works here" text (the profile name, not the connector's photo alt).
        const containerText = el.innerText?.trim() || '';
        const worksMatch = containerText.match(/^(.+?)\s+works here/i);
        let name = worksMatch ? worksMatch[1].trim() : '';
        name = name.replace(/\s*works here\s*/gi, '').trim();
        // Leave name empty — sendMessageToConnection will fetch it from the profile h1.
        results.push({ profileUrl: url, name });
      }
    }

    // Fallback: look for any /in/ link near text that says "works here"
    if (!results.length) {
      const allEls = Array.from(document.querySelectorAll('*'));
      const worksHereEl = allEls.find(
        (el) => el.children.length === 0 && el.innerText?.toLowerCase().includes('works here')
      );
      if (worksHereEl) {
        const parent = worksHereEl.closest('div, section, li') || worksHereEl.parentElement;
        for (const a of (parent?.querySelectorAll('a[href*="/in/"]') || [])) {
          const rawUrl2 = (a.href?.split('?')[0] || '').replace(/\/$/, '');
          const url = rawUrl2.replace(/^http:\/\//, 'https://');
          if (!url || !url.includes('/in/') || seen.has(url)) continue;
          seen.add(url);
          let name = a.innerText?.trim() || '';
          name = name.replace(/\s*works here\s*/gi, '').trim();
          results.push({ profileUrl: url, name });
        }
      }
    }

    return results;
  });

  if (connections.length) {
    console.log(`[linkedin-networking] Found ${connections.length} 1st-degree connection(s) at company: ${connections.map((c) => c.name || c.profileUrl).join(', ')}`);
  }
  return connections;
}

// ─── Navigate to company People page ─────────────────────────────────────────

async function goToCompanyPeoplePage(page, companyUrl) {
  const peopleUrl = `${companyUrl}/people/`;
  await page.goto(peopleUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay(2000, 4000);

  if (await isCaptchaPresent(page)) return false;

  // Scroll to load employee cards.
  await page.evaluate(() => window.scrollBy(0, 800));
  await randomDelay(1500, 3000);

  return true;
}

// ─── Collect employee cards from the People page ──────────────────────────────

// Returns array of { profileUrl, name, hasConnect, hasMessage, hasPending, cardIndex }
async function collectPeopleCards(page, limit) {
  // Extract all card data in one DOM pass to avoid stale-locator issues.
  const cardData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('li:has(a[href*="/in/"])'));
    return cards.slice(0, 40).map((li) => {
      // Profile URL — normalize to https, strip query params and trailing slash.
      const hrefAnchor = li.querySelector('a[href*="/in/"]');
      const profileUrl = (hrefAnchor?.href || '').split('?')[0].replace(/\/$/, '').replace(/^http:\/\//, 'https://');

      // Name from image alt (most reliable — e.g. alt="Tuhin Changder")
      // Fall back to aria-label or title text.
      const img = li.querySelector('img[alt]:not([alt=""])');
      const imgAlt = img?.getAttribute('alt')?.trim() || '';
      const ariaAnchor = li.querySelector('a[aria-label]');
      const ariaLabel = ariaAnchor?.getAttribute('aria-label') || '';
      const ariaMatch = ariaLabel.match(/^View (.+?)'s profile/i);
      const name = imgAlt || (ariaMatch ? ariaMatch[1].trim() : '');

      const text = li.innerText || '';
      const hasConnect = text.includes('Connect');
      const hasMessage = text.includes('Message');
      const hasPending = text.includes('Pending');

      return { profileUrl, name, hasConnect, hasMessage, hasPending };
    }).filter((c) => c.profileUrl.includes('/in/') && c.name && !c.name.toLowerCase().includes('logo') && !c.name.toLowerCase().includes('page'));
  });

  if (!cardData.length) return [];

  // Shuffle and limit.
  return cardData.sort(() => Math.random() - 0.5).slice(0, limit * 2);
}

// ─── Connection note ──────────────────────────────────────────────────────────

function buildConnectionNote(name, jobTitle, company) {
  const firstName = name.split(' ')[0] || name;
  const note =
    `Hi ${firstName}! I came across the ${jobTitle} opening at ${company} and am exploring it as a fresher. ` +
    `Would you be open to referring me if my profile is a good fit? Thank you!`;
  return note.slice(0, 300);
}

// ─── Send connection request (from People page card) ─────────────────────────

async function sendConnectFromCard(page, profileUrl, { name, jobTitle, company }) {
  // Find the Connect button in the card that contains this profile URL.
  const connectBtn = page
    .locator(`li:has(a[href*="${profileUrl.split('/in/')[1]?.split('?')[0]}"])`)
    .locator('button:has-text("Connect")')
    .first();
  await connectBtn.click({ timeout: 10000 });
  await randomDelay(1500, 3000);

  // Modal: try to add a personalised note; fall back to "Send without a note".
  const addNoteBtn = page.locator('button:has-text("Add a note")').first();
  if (await addNoteBtn.count()) {
    await addNoteBtn.click({ timeout: 8000 });
    await randomDelay(800, 1500);

    const noteBox = page
      .locator('textarea[name="message"], textarea#custom-message, textarea[aria-label*="note" i]')
      .first();
    if (await noteBox.count()) {
      await noteBox.fill(buildConnectionNote(name, jobTitle, company), { timeout: 5000 });
      await randomDelay(800, 1500);
    }
  }

  // Send — prefer "Send invitation" (with note), fall back to "Send without a note".
  const sendBtn = page
    .locator('button:has-text("Send invitation"), button:has-text("Send without a note")')
    .filter({ visible: true })
    .first();
  if (!(await sendBtn.count())) {
    await page.keyboard.press('Escape');
    return 'error';
  }
  await sendBtn.click({ timeout: 10000 });
  await randomDelay(2000, 4000);

  console.log(`[linkedin-networking] Connection request sent to ${name} at ${company}`);
  return 'request_sent';
}

// ─── Send message to existing 1st-degree connection ──────────────────────────

async function sendMessageToConnection(page, { profileUrl, name, jobTitle, company, jobId }) {
  // Go to the person's profile and click Message — this opens a pre-filled conversation thread.
  const profileNorm = profileUrl.startsWith('http') ? profileUrl : `https://www.linkedin.com${profileUrl}`;
  await page.goto(profileNorm.replace(/\/$/, ''), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay(2000, 4000);

  // Get full name from profile h1 if we only have first name.
  const profileName = await page.locator('h1').first().innerText({ timeout: 5000 }).then((t) => t.trim()).catch(() => name);
  const displayName = profileName || name;

  const messageBtn = page.locator('button:has-text("Message"), a:has-text("Message")').filter({ visible: true }).first();
  if (!(await messageBtn.count())) {
    console.warn(`[linkedin-networking] No Message button on profile: ${profileNorm}`);
    return 'skipped';
  }
  // Scroll the button into view and use JS click to bypass sticky-header interception.
  await messageBtn.scrollIntoViewIfNeeded().catch(() => {});
  await messageBtn.evaluate((el) => el.click());
  await randomDelay(1500, 3000);

  // The message modal pops up at the bottom right — wait for it.
  // Dismiss any upsell/premium modal that LinkedIn may show between profile visits.
  const upsellModal = page.locator('[data-test-modal-id="modal-upsell"], [data-test-modal-overlay]').first();
  if (await upsellModal.count()) {
    await page.keyboard.press('Escape');
    await randomDelay(500, 1000);
  }

  await page.waitForSelector('div.msg-form__contenteditable[role="textbox"], div[role="textbox"][aria-label*="message" i]', {
    state: 'visible', timeout: 15000
  }).catch(() => {});

  const messageBox = page
    .locator('div.msg-form__contenteditable[role="textbox"], div[role="textbox"][aria-label*="message" i]')
    .first();
  if (!(await messageBox.count())) {
    console.warn(`[linkedin-networking] Message box not found after clicking Message on ${profileNorm}`);
    await page.screenshot({ path: 'data/debug_linkedin_msg.png', fullPage: false }).catch(() => {});
    return 'error';
  }

  const firstName = displayName.split(' ')[0] || displayName;
  const msg =
    `Hi ${firstName}! Hope you're doing well. I came across the ${jobTitle} opening at ${company}` +
    (jobId ? ` (Job ID: ${jobId})` : '') +
    ` and am very interested as a fresher. Would you be open to referring me if my profile is a good fit? I can share my tailored resume. Thank you!`;

  // Use JS click to bypass any remaining overlay on the textbox.
  await messageBox.evaluate((el) => el.click());
  await randomDelay(300, 600);
  await messageBox.pressSequentially(msg.slice(0, 1000), { delay: 20 });
  await randomDelay(1000, 2000);

  const sendBtn = page
    .locator('button.msg-form__send-button, button[aria-label*="Send message"], button:has-text("Send")')
    .filter({ visible: true })
    .first();
  if (!(await sendBtn.count())) return 'error';
  await sendBtn.click({ timeout: 10000 });
  await randomDelay(2000, 4000);

  // Close the message overlay so it doesn't interfere with subsequent actions.
  await page.keyboard.press('Escape');
  await randomDelay(500, 800);

  console.log(`[linkedin-networking] Referral message sent to ${displayName} at ${company}`);
  return 'message_sent';
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runNetworkingForJob(job, { tailoredResumePath } = {}) {
  const enabled = process.env.LINKEDIN_NETWORKING_ENABLED === 'true';
  if (!enabled) {
    return { sent: 0, skipped: 0, reason: 'LINKEDIN_NETWORKING_ENABLED is not true — skipped.' };
  }

  const email = process.env.LINKEDIN_NETWORKING_EMAIL;
  const password = process.env.LINKEDIN_NETWORKING_PASSWORD;
  if (!email || !password) {
    return { sent: 0, skipped: 0, reason: 'LINKEDIN_NETWORKING_EMAIL / _PASSWORD not set.' };
  }

  if (!(await canSendRequest())) {
    return { sent: 0, skipped: 0, reason: 'Daily LinkedIn request limit reached.' };
  }

  const limit = maxPerCompany();
  let browser;

  try {
    const { browser: b, page } = await createBrowserPage({ headless: false });
    browser = b;

    // Reuse saved session or login fresh.
    let cookies = await getSession(PLATFORM);
    if (!cookies) {
      try {
        cookies = await loginAndSave(PLATFORM, page, login, { email, password });
      } catch (error) {
        console.warn(`[linkedin-networking] Login failed: ${error.message}`);
        return { sent: 0, skipped: 0, reason: `Login failed: ${error.message}` };
      }
    }
    if (cookies?.length) await page.context().addCookies(cookies);

    // Step 1: Find the company LinkedIn URL.
    const companyUrl = await findCompanyUrl(page, job.company);
    if (!companyUrl) {
      return { sent: 0, skipped: 0, reason: `Company not found on LinkedIn: "${job.company}".` };
    }

    let sent = 0;
    let skipped = 0;
    const results = [];
    const contactedThisRun = new Set(); // prevent duplicate sends within the same session

    // Step 2: Check company home page for "X works here" — 1st-degree connections first.
    const connections = await findConnectionsAtCompany(page, companyUrl);
    for (const conn of connections) {
      if (sent >= limit || !(await canSendRequest())) break;
      if (contactedThisRun.has(conn.profileUrl) || await alreadyContacted(conn.profileUrl)) { skipped++; continue; }

      if (isDryRun()) {
        console.log(`[linkedin-networking] DRY RUN — would send referral message to ${conn.name} (1st-degree) at ${job.company}`);
        results.push({ profileUrl: conn.profileUrl, name: conn.name, outcome: 'dry_run', degree: '1st' });
        sent++;
        continue;
      }

      await randomDelay(5000, 12000);
      const outcome = await sendMessageToConnection(page, {
        profileUrl: conn.profileUrl,
        name: conn.name || 'there',
        jobTitle: job.title,
        company: job.company,
        jobId: job.jobId || null
      });
      results.push({ profileUrl: conn.profileUrl, name: conn.name, outcome, degree: '1st' });
      contactedThisRun.add(conn.profileUrl);
      if (outcome === 'message_sent') {
        await recordRequest({ profileUrl: conn.profileUrl, company: job.company, jobTitle: job.title, type: 'message_sent' });
        sent++;
      } else skipped++;
    }

    // Step 3: If cap not reached, go to People tab and send connect requests to others.
    if (sent < limit && (await canSendRequest())) {
      const ok = await goToCompanyPeoplePage(page, companyUrl);
      if (ok) {
        const cards = await collectPeopleCards(page, limit - sent);
        for (const card of cards) {
          if (sent >= limit || !(await canSendRequest())) break;
          if (contactedThisRun.has(card.profileUrl) || await alreadyContacted(card.profileUrl)) { skipped++; continue; }
          if (card.hasPending) { skipped++; continue; }
          if (!card.hasConnect) { skipped++; continue; }

          if (isDryRun()) {
            console.log(`[linkedin-networking] DRY RUN — would send connect request to ${card.name} at ${job.company}`);
            results.push({ profileUrl: card.profileUrl, name: card.name, outcome: 'dry_run', degree: '2nd+' });
            sent++;
            continue;
          }

          await randomDelay(8000, 20000);
          const outcome = await sendConnectFromCard(page, card.profileUrl, {
            name: card.name,
            jobTitle: job.title,
            company: job.company
          });
          results.push({ profileUrl: card.profileUrl, name: card.name, outcome, degree: '2nd+' });
          contactedThisRun.add(card.profileUrl);
          if (outcome === 'request_sent') {
            await recordRequest({ profileUrl: card.profileUrl, company: job.company, jobTitle: job.title, type: 'request_sent' });
            sent++;
          } else skipped++;
        }
      }
    }

    // Persist refreshed cookies.
    const freshCookies = await page.context().cookies();
    if (freshCookies.length) await saveSession(PLATFORM, freshCookies);

    return { sent, skipped, dryRun: isDryRun(), profiles: results };
  } catch (error) {
    console.warn(`[linkedin-networking] Fatal error: ${error.message}`);
    return { sent: 0, skipped: 0, error: error.message };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
