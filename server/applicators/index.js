// Routes a job to the right applicator (or refuses) based on server/data/apply_whitelist.json.
// This is the single gate that decides whether auto-fill is even attempted — see the
// hybrid auto-apply logic in PHASE2_CODEX_PROMPT_v2.md section 7.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import applyInternshala from './internshala.js';
import applyGeneric from './generic.js';
import * as indeedApplicator from './indeed.js';
import * as naukriApplicator from './naukri.js';
import { getCredentials } from '../services/credentialStore.js';
import { ensureSession } from '../services/sessionManager.js';
import { createBrowserPage } from '../scrapers/utils.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const whitelistPath = path.join(serverDir, 'data', 'apply_whitelist.json');

const SESSION_APPLICATORS = {
  indeed: indeedApplicator,
  naukri: naukriApplicator
};

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
  if (job.source === 'indeed' || job.source === 'naukri') {
    return Boolean(list[job.source]);
  }
  // Both companyPages scraped jobs AND companyWatchlist jobs use the generic applicator —
  // whitelisted if the job's company name appears in the companyPages array.
  if (job.source === 'companyPages' || job.source === 'companyWatchlist') {
    const companies = Array.isArray(list.companyPages) ? list.companyPages.map(slugify) : [];
    return companies.includes(slugify(job.company));
  }
  return false;
}

// Indeed and Naukri both need a persistent logged-in session (login() + apply() share
// one Playwright page/context), unlike Internshala/generic which start fresh per job.
// Owns the browser lifecycle here so each platform's applicator module can stay focused
// on its own page actions (see services/sessionManager.js for the fresh-session-or-login
// orchestration this delegates to).
async function applyWithSession(platform, job, { tailoredResumePath }) {
  const applicatorModule = SESSION_APPLICATORS[platform];
  const credentials = await getCredentials(platform);
  const { browser, page } = await createBrowserPage();

  try {
    let cookies;
    try {
      cookies = await ensureSession(platform, {
        page,
        credentials,
        loginFn: applicatorModule.login
      });
    } catch (error) {
      return { applied: false, status: 'needs_manual', message: error.message };
    }

    if (cookies?.length) {
      await page.context().addCookies(cookies);
    }

    return await applicatorModule.apply(page, job, tailoredResumePath);
  } catch (error) {
    return { applied: false, status: 'failed', message: error.message };
  } finally {
    await browser.close();
  }
}

export async function autoApply(job, { aiClient, profile, tailoredResumePath } = {}) {
  const whitelist = await loadWhitelist();
  if (!(await isWhitelisted(job, whitelist))) {
    return { applied: false, status: 'not_whitelisted', message: 'Source/company is not on the apply whitelist.' };
  }

  if (job.source === 'internshala') {
    return applyInternshala(job, { aiClient, profile });
  }
  if (job.source === 'companyPages' || job.source === 'companyWatchlist') {
    return applyGeneric(job, { aiClient, profile, tailoredResumePath });
  }
  if (SESSION_APPLICATORS[job.source]) {
    return applyWithSession(job.source, job, { tailoredResumePath });
  }
  return { applied: false, status: 'not_whitelisted', message: `No applicator for source "${job.source}".` };
}
