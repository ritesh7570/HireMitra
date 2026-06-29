// Persists the candidate profile (text used for AI tailoring + contact fields used
// verbatim in the resume header) to server/data/profile.json, seeded from the defaults
// in prompts/profile.js on first run. This is what lets an uploaded resume update the
// profile at runtime without editing source code or restarting the server.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PROFILE_TEXT, DEFAULT_CONTACT } from '../prompts/profile.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profilePath = path.join(serverDir, 'data', 'profile.json');

function seedIfMissing() {
  if (fsSync.existsSync(profilePath)) return;
  const seed = {
    profileText: DEFAULT_PROFILE_TEXT,
    contact: DEFAULT_CONTACT,
    updatedAt: null
  };
  fsSync.mkdirSync(path.dirname(profilePath), { recursive: true });
  fsSync.writeFileSync(profilePath, JSON.stringify(seed, null, 2), 'utf8');
}

seedIfMissing();
let cache = JSON.parse(fsSync.readFileSync(profilePath, 'utf8'));

export function getCandidateProfile() {
  return cache.profileText;
}

export function getCandidateContact() {
  return cache.contact;
}

export function getProfileMeta() {
  return { profileText: cache.profileText, contact: cache.contact, updatedAt: cache.updatedAt };
}

export async function updateCandidateProfile({ profileText, contact }) {
  cache = {
    profileText: profileText || cache.profileText,
    contact: { ...cache.contact, ...(contact || {}) },
    updatedAt: new Date().toISOString()
  };
  await fs.mkdir(path.dirname(profilePath), { recursive: true });
  await fs.writeFile(profilePath, JSON.stringify(cache, null, 2), 'utf8');
  return getProfileMeta();
}
