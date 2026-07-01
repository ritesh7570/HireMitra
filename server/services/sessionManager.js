// Orchestrates login session reuse for platforms that require it (Indeed, Naukri):
// load a saved cookie session if it's still fresh, otherwise log in (subject to
// throttling) and save the resulting cookies for next time. Each platform's actual
// login flow lives in its own applicator (e.g. applicators/indeed.js exports
// `login(page, credentials)`) — this file never knows the specifics of any one site.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sessionsDir = path.join(serverDir, 'data', 'sessions');

function sessionPath(platform) {
  return path.join(sessionsDir, `${platform}.json`);
}

function throttlePath(platform) {
  return path.join(sessionsDir, `${platform}.throttle.json`);
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function getSession(platform, { maxAgeDays = 7 } = {}) {
  const data = await readJsonSafe(sessionPath(platform));
  if (!data?.cookies || !data?.savedAt) return null;
  if (!(await isSessionFresh(platform, maxAgeDays))) return null;
  return data.cookies;
}

export async function isSessionFresh(platform, maxAgeDays = 7) {
  const data = await readJsonSafe(sessionPath(platform));
  if (!data?.savedAt) return false;
  const ageDays = (Date.now() - new Date(data.savedAt).getTime()) / (1000 * 60 * 60 * 24);
  return ageDays < maxAgeDays;
}

export async function getSessionMeta(platform) {
  const data = await readJsonSafe(sessionPath(platform));
  return data ? { savedAt: data.savedAt } : null;
}

export async function saveSession(platform, cookies) {
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    sessionPath(platform),
    JSON.stringify({ cookies, savedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

// Anti-detection hygiene (PHASE3_CLAUDE_PROMPT.md section 6e): never attempt to log in
// to the same platform more than once per MIN_HOURS_BETWEEN_LOGINS, even if the previous
// attempt failed or the session just expired. This is checked before EVERY login
// attempt, not just successful ones, so a string of failures can't be used to retry
// rapidly.
export async function canAttemptLogin(platform) {
  const minHours = Number(process.env.MIN_HOURS_BETWEEN_LOGINS) || 6;
  const data = await readJsonSafe(throttlePath(platform));
  if (!data?.lastAttemptAt) return true;
  const hoursSince = (Date.now() - new Date(data.lastAttemptAt).getTime()) / (1000 * 60 * 60);
  return hoursSince >= minHours;
}

async function recordLoginAttempt(platform) {
  await fs.mkdir(sessionsDir, { recursive: true });
  await fs.writeFile(
    throttlePath(platform),
    JSON.stringify({ lastAttemptAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

// loginFn: async (page, credentials) => cookies — the platform's own login flow,
// implemented in its applicator. Throws if throttled, so callers should check
// canAttemptLogin() first if they want to give a friendlier message before even
// launching a browser.
export async function loginAndSave(platform, page, loginFn, credentials) {
  if (!(await canAttemptLogin(platform))) {
    const minHours = Number(process.env.MIN_HOURS_BETWEEN_LOGINS) || 6;
    throw new Error(
      `Login throttled for "${platform}" — must wait at least ${minHours}h between login attempts.`
    );
  }
  await recordLoginAttempt(platform);
  const cookies = await loginFn(page, credentials);
  await saveSession(platform, cookies);
  return cookies;
}

// The orchestration flow described in PHASE3_CLAUDE_PROMPT.md section 5c:
//   1. fresh session?    -> reuse it
//   2. enabled creds?    -> log in (throttled) and save the new session
//   3. neither?          -> throw a clear error
export async function ensureSession(platform, { page, credentials, loginFn, maxAgeDays = 7 } = {}) {
  const fresh = await getSession(platform, { maxAgeDays });
  if (fresh) return fresh;

  if (!credentials?.enabled) {
    throw new Error(
      `Credentials not configured for "${platform}" (or not enabled). Enable them from the ` +
        'Credentials page after reviewing the applicator in DRY_RUN mode.'
    );
  }

  return loginAndSave(platform, page, loginFn, credentials);
}
