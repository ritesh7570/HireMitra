// Tracks daily LinkedIn connection-request + message counts so the pipeline never
// exceeds LINKEDIN_MAX_REQUESTS_PER_DAY regardless of how many jobs it processes.
// State is persisted across server restarts so the limit is truly per-calendar-day.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const statePath = path.join(dataDir, 'linkedin_network_state.json');

const DEFAULT = { lastResetDate: '', todayCount: 0, requests: [] };

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function read() {
  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const state = JSON.parse(raw);
    // Reset counter when calendar day rolls over.
    if (state.lastResetDate !== today()) {
      return { ...DEFAULT, lastResetDate: today(), requests: state.requests || [] };
    }
    return state;
  } catch {
    return { ...DEFAULT, lastResetDate: today() };
  }
}

async function write(state) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function canSendRequest() {
  const max = Number(process.env.LINKEDIN_MAX_REQUESTS_PER_DAY) || 3;
  const state = await read();
  return state.todayCount < max;
}

export async function recordRequest({ profileUrl, company, jobTitle, type }) {
  const state = await read();
  state.todayCount = (state.todayCount || 0) + 1;
  state.requests = state.requests || [];
  state.requests.push({ profileUrl, company, jobTitle, type, sentAt: new Date().toISOString() });
  await write(state);
}

export async function alreadyContacted(profileUrl) {
  const state = await read();
  return (state.requests || []).some((r) => r.profileUrl === profileUrl);
}

export async function getNetworkStats() {
  const state = await read();
  const max = Number(process.env.LINKEDIN_MAX_REQUESTS_PER_DAY) || 3;
  return {
    todayCount: state.todayCount || 0,
    max,
    remaining: Math.max(0, max - (state.todayCount || 0)),
    totalEver: (state.requests || []).length,
    lastResetDate: state.lastResetDate
  };
}
