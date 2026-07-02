// One-shot test: runs LinkedIn networking for a fake job at Razorpay.
// Uses LINKEDIN_DRY_RUN=true (default) — finds profiles and logs what it WOULD do,
// but never actually clicks Send. Safe to run repeatedly.
//
// Usage:  node --env-file=.env scripts/testLinkedInNetworking.js
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNetworkingForJob } from '../applicators/linkedinNetworking.js';

// Clear the throttle file so repeated test runs aren't blocked.
const sessionsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'sessions');
await fs.rm(path.join(sessionsDir, 'linkedin-networking.throttle.json'), { force: true });

const FAKE_JOB = {
  title: 'Software Engineer',
  company: 'Razorpay',
  location: 'Bangalore, India',
  source: 'test',
  applyUrl: 'https://razorpay.com/jobs/',
  jdText: 'Software Engineer role at Razorpay.',
  jobId: 'RAZORPAY-TEST-001'
};

console.log('=== LinkedIn Networking Test ===');
console.log(`Company : ${FAKE_JOB.company}`);
console.log(`Role    : ${FAKE_JOB.title}`);
console.log(`Dry run : ${process.env.LINKEDIN_DRY_RUN !== 'false' ? 'YES (no real sends)' : 'NO — LIVE MODE'}`);
console.log('================================\n');

const result = await runNetworkingForJob(FAKE_JOB, { tailoredResumePath: null });

console.log('\n=== Result ===');
console.log(JSON.stringify(result, null, 2));
