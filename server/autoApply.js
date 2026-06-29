// Auto mode: process queued job descriptions without interactive prompts.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processApplication } from './services/applicationProcessor.js';
import { disconnectApplicationStore } from './services/applicationStore.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const queuePath = path.join(serverDir, 'data', 'job_queue.json');

async function readJobQueue() {
  const raw = await fs.readFile(queuePath, 'utf8');
  const queue = JSON.parse(raw);
  if (!Array.isArray(queue)) {
    throw new Error('data/job_queue.json must contain an array of jobs.');
  }
  return queue;
}

async function main() {
  let processed = 0;
  let sent = 0;
  let skipped = 0;

  try {
    const jobs = await readJobQueue();
    if (jobs.length === 0) {
      console.log('No jobs found in data/job_queue.json.');
      return;
    }

    for (const [index, job] of jobs.entries()) {
      try {
        const result = await processApplication({
          ...job,
          source: job.source || 'queue',
          sendEmail: job.sendEmail === true,
          statusWhenEmailSent: 'applied',
          statusWhenDrafted: 'drafted'
        });

        processed += 1;
        if (result.emailSent) {
          sent += 1;
        } else {
          skipped += 1;
        }

        const emailStatus = result.emailSent ? 'email sent' : 'email skipped';
        const emailNote = result.emailError ? ` (${result.emailError})` : '';
        console.log(
          `OK ${result.company} ${result.role} - ${emailStatus}${emailNote} - score: ${result.matchScore}`
        );
        if (job.sendReferral) {
          console.log(`Referral draft:\n${result.referralMessage}\n`);
        }
      } catch (error) {
        skipped += 1;
        console.error(`Job ${index + 1} failed: ${error.message}`);
      }
    }

    console.log(`Done. Processed: ${processed}. Emails sent: ${sent}. Skipped: ${skipped}.`);
  } catch (error) {
    console.error(`Auto apply failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectApplicationStore();
  }
}

await main();
