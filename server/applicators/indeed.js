// Indeed Easy Apply applicator. Unlike internshala.js/generic.js (which own their whole
// browser lifecycle), login() and apply() both take an already-created Playwright `page`
// — the caller (applicators/index.js) owns the browser and session/cookie reuse via
// services/sessionManager.js, since Indeed needs a persistent logged-in session rather
// than a fresh anonymous visit per job. Defaults to DRY_RUN: fills the Easy Apply form
// but never clicks final submit until INDEED_DRY_RUN=false.
import { randomDelay } from '../scrapers/utils.js';
import { isCaptchaPresent, handleCaptcha } from './captchaGuard.js';
import { buildCoverLetterPrompt, buildFormAnswerPrompt } from '../prompts/coverLetterPrompt.js';
import { createAiClientFromEnv } from '../services/applicationProcessor.js';
import { getCandidateProfile } from '../services/profileStore.js';

function isDryRun() {
  return process.env.INDEED_DRY_RUN !== 'false';
}

// Returns cookies on success. Throws (caller treats as a failed/needs_manual result) if
// a captcha is hit or login otherwise fails — never attempts to solve a captcha.
export async function login(page, { email, password }) {
  await page.goto('https://secure.indeed.com/account/login', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay();

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, 'indeed');
    throw new Error('Captcha encountered during Indeed login — manual intervention needed.');
  }

  // Indeed login is two-step: email → Continue → password appears.
  const emailField = page.locator('input[type="email"], input[name="__email"], input[data-tn-element*="email" i]').first();
  if (await emailField.count()) {
    await emailField.fill(email, { timeout: 10000 });
    const continueButton = page.locator('button[type="submit"]').first();
    if (await continueButton.count()) {
      await continueButton.click({ timeout: 10000 });
      // Wait for the password field to actually appear and become visible — the page
      // animates between the email and password steps, so filling immediately fails.
      await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 15000 }).catch(() => {});
      await randomDelay();
    }
  }

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, 'indeed');
    throw new Error('Captcha encountered during Indeed login — manual intervention needed.');
  }

  const passwordField = page.locator('input[type="password"]').filter({ visible: true }).first();
  if (!(await passwordField.count())) {
    throw new Error('Indeed login: password field not found or not visible — page layout may have changed.');
  }
  await passwordField.fill(password, { timeout: 10000 });

  const submitButton = page.locator('button[type="submit"]').first();
  await submitButton.click({ timeout: 10000 });
  await randomDelay(2000, 4000);

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, 'indeed');
    throw new Error('Captcha encountered during Indeed login — manual intervention needed.');
  }

  const cookies = await page.context().cookies();
  if (!cookies.length) {
    throw new Error('Indeed login did not produce a session — no cookies were set.');
  }
  return cookies;
}

async function fillCoverLetterIfPresent(page, profile, job) {
  const coverLetterField = page
    .locator('textarea[name*="cover" i], textarea[id*="cover" i], textarea[aria-label*="cover" i]')
    .first();
  if (!(await coverLetterField.count())) return;

  try {
    const aiClient = createAiClientFromEnv();
    const { coverLetter } = await aiClient.generateJson(
      buildCoverLetterPrompt({ profile, jdText: job.jdText, role: job.title, company: job.company }),
      'Indeed cover letter'
    );
    await coverLetterField.fill(coverLetter || '', { timeout: 5000 });
    await randomDelay(500, 1200);
  } catch {
    // Best-effort — skip if the AI call fails, don't block the rest of the flow.
  }
}

async function answerVisibleQuestions(page, profile) {
  const aiClient = createAiClientFromEnv();
  const labels = await page.locator('label, legend').all().catch(() => []);

  for (const label of labels.slice(0, 8)) {
    try {
      const questionText = (await label.innerText({ timeout: 2000 })).trim();
      if (!questionText || questionText.length > 200) continue;

      const field = label
        .locator('xpath=following::input[@type="text"][1] | xpath=following::textarea[1]')
        .first();
      if (!(await field.count())) continue;
      if (await field.inputValue({ timeout: 1000 }).catch(() => '')) continue; // already filled

      const { answer } = await aiClient.generateJson(
        buildFormAnswerPrompt({ profile, question: questionText }),
        'Indeed form answer'
      );
      await field.fill(answer || '', { timeout: 5000 });
      await randomDelay(500, 1200);
    } catch {
      // Best-effort only — skip questions we can't confidently answer.
    }
  }
}

export async function apply(page, job, resumePath) {
  const dryRun = isDryRun();

  await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await randomDelay();

  if (await isCaptchaPresent(page)) {
    return handleCaptcha(page, 'indeed');
  }

  const easyApplyButton = page.locator('button:has-text("Easy Apply"), button:has-text("Apply now")').first();
  if (!(await easyApplyButton.count())) {
    return {
      applied: false,
      status: 'needs_manual',
      message: 'No Easy Apply button found — likely an external-site redirect.'
    };
  }
  await easyApplyButton.click({ timeout: 10000 });
  await randomDelay();

  if (await isCaptchaPresent(page)) {
    return handleCaptcha(page, 'indeed');
  }

  if (resumePath) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput.setInputFiles(resumePath).catch(() => {});
      await randomDelay();
    }
  }

  const profile = getCandidateProfile();
  await fillCoverLetterIfPresent(page, profile, job);
  await answerVisibleQuestions(page, profile);

  // Indeed's Easy Apply is often multi-step ("Continue" through several screens before a
  // final review/submit). Best-effort: advance through up to 6 steps.
  for (let step = 0; step < 6; step++) {
    if (await isCaptchaPresent(page)) {
      return handleCaptcha(page, 'indeed');
    }
    const continueButton = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
    if (!(await continueButton.count())) break;
    await continueButton.click({ timeout: 10000 }).catch(() => {});
    await randomDelay();
  }

  if (dryRun) {
    return {
      applied: false,
      status: 'dry_run',
      message: 'Easy Apply form filled but not submitted (INDEED_DRY_RUN=true).'
    };
  }

  const submitButton = page
    .locator('button:has-text("Submit application"), button:has-text("Submit your application")')
    .first();
  if (!(await submitButton.count())) {
    return { applied: false, status: 'needs_manual', message: 'Submit button not found.' };
  }
  await submitButton.click({ timeout: 10000 });
  await randomDelay();

  return { applied: true, status: 'auto_applied', message: 'Application submitted via Easy Apply.' };
}
