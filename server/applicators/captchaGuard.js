// Shared captcha detection for platform applicators that require login (Indeed, Naukri).
// Never attempts to solve a captcha — only detects it, screenshots it, emails a
// notification, and signals the caller to stop and skip this job. Non-negotiable rule
// from PHASE3_CLAUDE_PROMPT.md section 6d / 11.5.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendHtmlEmail } from '../services/emailService.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(serverDir, 'data');

const CAPTCHA_SELECTORS = [
  'iframe[src*="captcha" i]',
  '#captcha',
  '.g-recaptcha',
  '[id*="captcha" i]',
  '[class*="captcha" i]'
];

export async function isCaptchaPresent(page) {
  if (/captcha/i.test(page.url())) return true;
  for (const selector of CAPTCHA_SELECTORS) {
    // Require the element to be visible — many sites keep hidden captcha-related
    // elements in the DOM on normal pages (Naukri login being a confirmed case).
    const count = await page.locator(selector).filter({ visible: true }).count().catch(() => 0);
    if (count > 0) return true;
  }
  return false;
}

// Screenshots the page, emails NOTIFICATION_EMAIL, and returns a result object the
// applicator can return directly (status: "captcha_blocked") to skip this job cleanly.
export async function handleCaptcha(page, platform) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const screenshotPath = path.join(dataDir, `captcha_${platform}_${timestamp}.png`);

  await fs.mkdir(dataDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((error) => {
    console.warn(`Captcha screenshot failed for ${platform}: ${error.message}`);
  });

  try {
    await sendHtmlEmail({
      to: process.env.NOTIFICATION_EMAIL || process.env.GMAIL_USER,
      subject: `Captcha encountered on ${platform} — manual intervention needed`,
      html:
        `<p>A captcha was encountered while automating <strong>${platform}</strong>.</p>` +
        '<p>No automated solving was attempted — this job/login was skipped. ' +
        'See the attached screenshot to handle it manually if needed.</p>',
      gmailUser: process.env.GMAIL_USER,
      gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
      attachments: [{ filename: path.basename(screenshotPath), path: screenshotPath }]
    });
  } catch (error) {
    console.warn(`Captcha notification email failed for ${platform}: ${error.message}`);
  }

  console.warn(`Captcha encountered on ${platform} — screenshot saved to ${screenshotPath}, job skipped.`);
  return { applied: false, status: 'captcha_blocked', message: `Captcha encountered — see ${screenshotPath}` };
}
