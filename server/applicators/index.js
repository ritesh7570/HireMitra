// Routes a job to the right applicator (or refuses) based on server/data/apply_whitelist.json.
// This is the single gate that decides whether auto-fill is even attempted — see the
// hybrid auto-apply logic in PHASE2_CODEX_PROMPT_v2.md section 7.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import applyInternshala from './internshala.js';
import applyGeneric from './generic.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const whitelistPath = path.join(serverDir, 'data', 'apply_whitelist.json');

function slugify(value) {
  return String(value || '').trim().toLowerCase();
}

export async function loadWhitelist() {
  const raw = await fs.readFile(whitelistPath, 'utf8').catch(() => '{}');
  return JSON.parse(raw);
}

export async function isWhitelisted(job, whitelist = null) {
  const list = whitelist || (await loadWhitelist());
  if (job.source === 'internshala') {
    return Boolean(list.internshala);
  }
  if (job.source === 'companyPages') {
    const companies = Array.isArray(list.companyPages) ? list.companyPages.map(slugify) : [];
    return companies.includes(slugify(job.company));
  }
  return false;
}

export async function autoApply(job, { aiClient, profile, tailoredResumePath } = {}) {
  const whitelist = await loadWhitelist();
  if (!(await isWhitelisted(job, whitelist))) {
    return { applied: false, status: 'not_whitelisted', message: 'Source/company is not on the apply whitelist.' };
  }

  if (job.source === 'internshala') {
    return applyInternshala(job, { aiClient, profile });
  }
  if (job.source === 'companyPages') {
    return applyGeneric(job, { aiClient, profile, tailoredResumePath });
  }
  return { applied: false, status: 'not_whitelisted', message: `No applicator for source "${job.source}".` };
}
