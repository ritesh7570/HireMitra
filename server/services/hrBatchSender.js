// Daily batch: cold-emails up to N (default 20) not-yet-emailed HR contacts from the
// uploaded list, once per calendar day. Reuses ONE generic tailored resume and ONE
// generic cold-email template for the whole batch (string-substituting {{name}}/
// {{company}} per contact) to keep AI usage light against Gemini's free-tier quota.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAiClientFromEnv } from './applicationProcessor.js';
import { getCandidateProfile, getUploadedResumePath } from './profileStore.js';
import { tailorResume } from './resumeTailor.js';
import { sendColdEmail } from './emailService.js';
import { buildGenericColdEmailPrompt } from '../prompts/genericColdEmailPrompt.js';
import { getUnsentHrContacts, setHrContactSent } from './hrContactStore.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(serverDir, 'output');
const statePath = path.join(serverDir, 'data', 'hr_batch_state.json');

const GENERIC_JD_TEXT =
  'General outreach with no specific job posting attached. Tailor a strong, honest, ' +
  "general-purpose resume that highlights the candidate's core skills and job target " +
  'for early-career backend/software engineering roles.';

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function readState() {
  if (!fsSync.existsSync(statePath)) return { lastRunDate: null };
  try {
    return JSON.parse(await fs.readFile(statePath, 'utf8'));
  } catch {
    return { lastRunDate: null };
  }
}

async function writeState(state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function fillTemplate(template, contact) {
  return template
    .replaceAll('{{name}}', contact.name || 'there')
    .replaceAll('{{company}}', contact.company || 'your team');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getBatchState() {
  return readState();
}

// force=true bypasses the "already ran today" lock for an on-demand/manual batch
// (e.g. a small test send) without disturbing the automatic daily schedule — it still
// writes lastRunDate at the end, so the next automatic check this same day stays a no-op.
export async function runDailyHrBatch({ batchSize = 20, force = false } = {}) {
  console.log('HR batch: checking whether today\'s batch has run yet...');
  const today = todayKey();
  const state = await readState();
  if (!force && state.lastRunDate === today) {
    console.log('HR batch: already ran today, skipping.');
    return { skipped: true, reason: 'Already ran today.' };
  }

  const contacts = await getUnsentHrContacts(batchSize);
  if (contacts.length === 0) {
    console.log('HR batch: no unsent contacts, nothing to do today.');
    await writeState({ lastRunDate: today });
    return { skipped: true, reason: 'No unsent HR contacts to email.' };
  }

  const aiClient = createAiClientFromEnv();
  const profile = getCandidateProfile();

  const uploadedResumePath = getUploadedResumePath();
  let tailoredResumePath = uploadedResumePath;
  if (uploadedResumePath) {
    console.log(`HR batch: using the literal uploaded resume file (${uploadedResumePath}).`);
  } else {
    console.log(`HR batch: no uploaded resume on file — tailoring a generic one for ${contacts.length} contact(s)...`);
    const resumeResult = await tailorResume({ jdText: GENERIC_JD_TEXT, profile, aiClient, outputDir });
    tailoredResumePath = resumeResult.pdfPath || resumeResult.texPath;
  }

  const template = await aiClient.generateJson(
    buildGenericColdEmailPrompt({ profile }),
    'Generic cold email template'
  );

  const resumeExt = tailoredResumePath ? path.extname(tailoredResumePath) || '.pdf' : '.pdf';
  let sent = 0;
  let failed = 0;

  for (const contact of contacts) {
    try {
      await sendColdEmail({
        to: contact.email,
        subject: fillTemplate(template.subject || 'Quick intro', contact),
        body: fillTemplate(template.body || '', contact),
        gmailUser: process.env.GMAIL_USER,
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
        attachments: tailoredResumePath
          ? [{ filename: `Ritesh_Kumar_Resume${resumeExt}`, path: tailoredResumePath }]
          : []
      });
      await setHrContactSent(contact._id, true);
      sent += 1;
      console.log(`HR batch: emailed ${contact.email} (${contact.company || 'unknown company'}).`);
    } catch (error) {
      failed += 1;
      console.warn(`HR batch: failed to email ${contact.email}: ${error.message}`);
    }
    await delay(2000);
  }

  await writeState({ lastRunDate: today });
  console.log(`HR batch complete: ${sent} sent, ${failed} failed, ${contacts.length} attempted.`);
  return { skipped: false, attempted: contacts.length, sent, failed };
}
