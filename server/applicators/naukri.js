// Naukri applicator. Like indeed.js, login() and apply() both take an already-created
// Playwright `page` — applicators/index.js owns the browser and session/cookie reuse via
// services/sessionManager.js. Naukri's flow is simpler than Indeed's Easy Apply: most
// jobs are a single "I'm Interested" click with no form, though many redirect to an
// external ATS instead — those are detected and left for manual application rather than
// guessed at. Defaults to DRY_RUN: clicks through to the point of applying but stops
// short of the final action until NAUKRI_DRY_RUN=false.
import { randomDelay } from '../scrapers/utils.js';
import { isCaptchaPresent, handleCaptcha } from './captchaGuard.js';
import { buildFormAnswerPrompt } from '../prompts/coverLetterPrompt.js';
import { createAiClientFromEnv } from '../services/applicationProcessor.js';
import { getCandidateProfile } from '../services/profileStore.js';

function isDryRun() {
  return process.env.NAUKRI_DRY_RUN !== 'false';
}

export async function login(page, { email, password }) {
  // Naukri's login form is JS-rendered — domcontentloaded is too early, need to wait
  // for the actual inputs to appear. The form renders on /nlogin/login but takes time.
  await page.goto('https://www.naukri.com/nlogin/login', { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for the email field to appear (JS-rendered form can take 3-5s)
  await page
    .waitForSelector(
      'input#usernameField, input[placeholder*="Email" i], input[placeholder*="Username" i]',
      { state: 'visible', timeout: 20000 }
    )
    .catch(() => {});

  await randomDelay();

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, 'naukri');
    throw new Error('Captcha encountered during Naukri login — manual intervention needed.');
  }

  const emailField = page
    .locator('input#usernameField, input[placeholder*="Email ID" i], input[placeholder*="email" i], input[placeholder*="Username" i]')
    .first();
  if (!(await emailField.count())) {
    throw new Error('Naukri login: email field not found — page layout may have changed.');
  }
  await emailField.fill(email, { timeout: 10000 });

  const passwordField = page
    .locator('input#passwordField, input[type="password"], input[placeholder*="Password" i]')
    .first();
  if (!(await passwordField.count())) {
    throw new Error('Naukri login: password field not found — page layout may have changed.');
  }
  await passwordField.fill(password, { timeout: 10000 });

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, 'naukri');
    throw new Error('Captcha encountered during Naukri login — manual intervention needed.');
  }

  const submitButton = page.locator('button[type="submit"]').first();
  await submitButton.click({ timeout: 10000 });
  await randomDelay(2000, 4000);

  if (await isCaptchaPresent(page)) {
    await handleCaptcha(page, 'naukri');
    throw new Error('Captcha encountered during Naukri login — manual intervention needed.');
  }

  const cookies = await page.context().cookies();
  if (!cookies.length) {
    throw new Error('Naukri login did not produce a session — no cookies were set.');
  }
  return cookies;
}

async function answerVisibleQuestions(page, profile) {
  const aiClient = createAiClientFromEnv();
  const labels = await page.locator('label, .lbl').all().catch(() => []);

  for (const label of labels.slice(0, 8)) {
    try {
      const questionText = (await label.innerText({ timeout: 2000 })).trim();
      if (!questionText || questionText.length > 200) continue;

      const field = label
        .locator('xpath=following::input[@type="text"][1] | xpath=following::textarea[1]')
        .first();
      if (!(await field.count())) continue;
      if (await field.inputValue({ timeout: 1000 }).catch(() => '')) continue;

      const { answer } = await aiClient.generateJson(
        buildFormAnswerPrompt({ profile, question: questionText }),
        'Naukri form answer'
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
    return handleCaptcha(page, 'naukri');
  }

  const interestedButton = page
    .locator('button:has-text("I am Interested"), button:has-text("Apply"), #apply-button')
    .first();
  if (!(await interestedButton.count())) {
    return { applied: false, status: 'needs_manual', message: '"I am Interested"/Apply button not found.' };
  }

  // Unlike Internshala/Indeed (a multi-step form where only the LAST step is the real
  // submit), Naukri's "I am Interested" button is frequently the entire application by
  // itself — clicking it for real would already BE applying. So dry-run must stop here,
  // before clicking anything, rather than gating some later "submit" step that may not
  // even exist for this job.
  if (dryRun) {
    return {
      applied: false,
      status: 'dry_run',
      message:
        'Found the apply button but did not click it (NAUKRI_DRY_RUN=true) — clicking it may itself ' +
        'submit the application on Naukri, so dry-run stops before any click.'
    };
  }

  await interestedButton.click({ timeout: 10000 });
  await randomDelay(2000, 3500);

  if (await isCaptchaPresent(page)) {
    return handleCaptcha(page, 'naukri');
  }

  // Many Naukri postings redirect straight to an external ATS after this click — that's
  // outside scope for this applicator (each one is a custom site), so detect and stop
  // rather than guess at an unknown form.
  const currentHost = new URL(page.url()).host;
  if (!currentHost.includes('naukri.com')) {
    console.warn(`Naukri job redirected externally to ${currentHost} — leaving for manual application.`);
    return {
      applied: false,
      status: 'needs_manual',
      message: `Redirected to an external site (${currentHost}) — apply manually.`
    };
  }

  if (resumePath) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count()) {
      await fileInput.setInputFiles(resumePath).catch(() => {});
      await randomDelay();
    }
  }

  const profile = getCandidateProfile();
  await answerVisibleQuestions(page, profile);

  const submitButton = page.locator('button:has-text("Submit"), button[type="submit"]').first();
  if (await submitButton.count()) {
    await submitButton.click({ timeout: 10000 });
    await randomDelay();
    return { applied: true, status: 'auto_applied', message: 'Application submitted via follow-up form.' };
  }

  return {
    applied: true,
    status: 'auto_applied',
    message: 'No further form found — the "I am Interested" click was the entire application.'
  };
}
