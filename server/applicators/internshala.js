// Auto-fills (and, only when not in dry-run mode, submits) an Internshala application.
// Defaults to dry-run via INTERNSHALA_DRY_RUN so Ritesh can visually verify the flow
// before letting it submit for real (see PHASE2_CODEX_PROMPT_v2.md section 7).
import { createBrowserPage, randomDelay } from '../scrapers/utils.js';
import { buildCoverLetterPrompt, buildFormAnswerPrompt } from '../prompts/coverLetterPrompt.js';

function isDryRun() {
  return process.env.INTERNSHALA_DRY_RUN !== 'false';
}

async function answerCustomQuestions(page, { aiClient, profile }) {
  const questionBlocks = await page
    .locator('.question_text, label.question')
    .all()
    .catch(() => []);

  for (const block of questionBlocks) {
    try {
      const questionText = (await block.innerText({ timeout: 3000 })).trim();
      if (!questionText) continue;

      const container = block.locator('xpath=following::textarea[1] | xpath=following::input[@type="text"][1]').first();
      const exists = await container.count();
      if (!exists) continue;

      const { answer } = await aiClient.generateJson(
        buildFormAnswerPrompt({ profile, question: questionText }),
        'Form answer'
      );
      await container.fill(answer || '', { timeout: 5000 });
      await randomDelay(500, 1200);
    } catch {
      // Best-effort only; skip questions we can't confidently answer.
    }
  }
}

export default async function applyInternshala(job, { aiClient, profile }) {
  const dryRun = isDryRun();
  let browser;

  try {
    const created = await createBrowserPage();
    browser = created.browser;
    const page = created.page;

    await page.goto(job.applyUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay();

    const applyButton = page.locator('text=/apply now/i').first();
    if (!(await applyButton.count())) {
      return { applied: false, status: 'failed', message: 'Apply button not found.' };
    }
    await applyButton.click({ timeout: 10000 });
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

    const coverLetterField = page.locator('textarea').first();
    if (await coverLetterField.count()) {
      await coverLetterField.fill(coverLetter || '', { timeout: 5000 });
    }

    await answerCustomQuestions(page, { aiClient, profile });

    if (dryRun) {
      return {
        applied: false,
        status: 'dry_run',
        message: 'Form filled but not submitted (INTERNSHALA_DRY_RUN=true).'
      };
    }

    const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();
    if (!(await submitButton.count())) {
      return { applied: false, status: 'failed', message: 'Submit button not found.' };
    }
    await submitButton.click({ timeout: 10000 });
    await randomDelay();

    return { applied: true, status: 'auto_applied', message: 'Application submitted.' };
  } catch (error) {
    return { applied: false, status: 'failed', message: error.message };
  } finally {
    if (browser) await browser.close();
  }
}
