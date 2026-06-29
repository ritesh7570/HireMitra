// Heuristic form-filler for whitelisted, simple company career pages. Field-detection is
// best-effort (label/name/placeholder matching) since every career page is different.
// Defaults to dry-run via AUTO_APPLY_DRY_RUN, same safety posture as the Internshala
// applicator — never submits until Ritesh explicitly flips the flag.
import { createBrowserPage, randomDelay } from '../scrapers/utils.js';
import { getCandidateContact } from '../services/profileStore.js';
import { buildCoverLetterPrompt } from '../prompts/coverLetterPrompt.js';

function isDryRun() {
  return process.env.AUTO_APPLY_DRY_RUN !== 'false';
}

const FIELD_MATCHERS = [
  { pattern: /e-?mail/i, value: () => getCandidateContact().email },
  { pattern: /linked\s*in/i, value: () => getCandidateContact().linkedinUrl },
  { pattern: /git\s*hub/i, value: () => getCandidateContact().githubUrl },
  { pattern: /portfolio|website/i, value: () => getCandidateContact().portfolioUrl },
  { pattern: /full\s*name|^name$|your\s*name/i, value: () => 'Ritesh Kumar' }
];

async function fillKnownFields(page) {
  const inputs = await page.locator('input[type="text"], input[type="email"], input[type="url"], input:not([type])').all();
  for (const input of inputs) {
    try {
      const attrs = await input.evaluate((el) => `${el.name || ''} ${el.id || ''} ${el.placeholder || ''}`);
      const matcher = FIELD_MATCHERS.find((entry) => entry.pattern.test(attrs));
      if (matcher) {
        await input.fill(matcher.value(), { timeout: 5000 });
        await randomDelay(300, 800);
      }
    } catch {
      // Skip fields we can't safely fill.
    }
  }
}

async function fillCoverLetterField(page, coverLetter) {
  const textarea = page.locator('textarea').first();
  if (await textarea.count()) {
    await textarea.fill(coverLetter || '', { timeout: 5000 });
  }
}

async function attachResume(page, tailoredResumePath) {
  if (!tailoredResumePath) return;
  const fileInput = page.locator('input[type="file"]').first();
  if (await fileInput.count()) {
    await fileInput.setInputFiles(tailoredResumePath).catch(() => {});
  }
}

export default async function applyGeneric(job, { aiClient, profile, tailoredResumePath }) {
  const dryRun = isDryRun();
  let browser;

  try {
    const created = await createBrowserPage();
    browser = created.browser;
    const page = created.page;

    await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay();

    const { coverLetter } = await aiClient.generateJson(
      buildCoverLetterPrompt({
        profile,
        jdText: job.jdText,
        role: job.title,
        company: job.company
      }),
      'Cover letter'
    );

    await fillKnownFields(page);
    await fillCoverLetterField(page, coverLetter);
    await attachResume(page, tailoredResumePath);

    if (dryRun) {
      return {
        applied: false,
        status: 'dry_run',
        message: 'Form filled but not submitted (AUTO_APPLY_DRY_RUN=true).'
      };
    }

    const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();
    if (!(await submitButton.count())) {
      return { applied: false, status: 'needs_manual', message: 'No submit button found — fill manually.' };
    }
    await submitButton.click({ timeout: 10000 });
    await randomDelay();

    return { applied: true, status: 'auto_applied', message: 'Application submitted.' };
  } catch (error) {
    return { applied: false, status: 'needs_manual', message: error.message };
  } finally {
    if (browser) await browser.close();
  }
}
