// Stores login credentials for platforms that support auto-apply with a login
// (Indeed, Naukri). Every entry defaults to enabled: false — a hard safety gate, per
// PHASE3_CLAUDE_PROMPT.md section 5a: nothing ever attempts a login until the user
// explicitly flips a platform's "enabled" flag from the dashboard.
//
// Passwords are encrypted at rest with AES-256-GCM when CREDENTIAL_VAULT_KEY (a 32-byte
// hex string) is set in .env. If it's missing, credentials are stored in plain text —
// the file is gitignored either way, but encryption is still strictly better when
// available. This trade-off is intentional (see PHASE3_CLAUDE_PROMPT.md section 5b) and
// is logged loudly on every write so it's never a silent surprise.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const credentialsPath = path.join(serverDir, 'data', 'credentials.json');

const DEFAULT_PLATFORMS = {
  indeed: { email: '', enabled: false },
  naukri: { email: '', enabled: false }
};

function seedIfMissing() {
  if (fsSync.existsSync(credentialsPath)) return;
  fsSync.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  fsSync.writeFileSync(credentialsPath, JSON.stringify(DEFAULT_PLATFORMS, null, 2), 'utf8');
}

async function readAll() {
  seedIfMissing();
  return JSON.parse(await fs.readFile(credentialsPath, 'utf8'));
}

async function writeAll(data) {
  await fs.mkdir(path.dirname(credentialsPath), { recursive: true });
  await fs.writeFile(credentialsPath, JSON.stringify(data, null, 2), 'utf8');
}

let warnedNoKey = false;

function getEncryptionKey() {
  const keyHex = process.env.CREDENTIAL_VAULT_KEY;
  if (!keyHex) {
    if (!warnedNoKey) {
      console.warn(
        'CREDENTIAL_VAULT_KEY is not set — stored credentials will be saved in PLAIN TEXT ' +
          '(the file is still gitignored, but unencrypted). Generate one with: ' +
          `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      );
      warnedNoKey = true;
    }
    return null;
  }
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    console.warn(
      `CREDENTIAL_VAULT_KEY must decode to exactly 32 bytes (64 hex chars) — got ${key.length}. ` +
        'Falling back to plain text storage.'
    );
    return null;
  }
  return key;
}

function encryptPassword(password, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return {
    password: ciphertext.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    encrypted: true
  };
}

function decryptPassword(entry, key) {
  if (!entry.encrypted) return entry.password || '';
  if (!key) {
    throw new Error('Stored password is encrypted but CREDENTIAL_VAULT_KEY is missing or invalid.');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(entry.password, 'hex')), decipher.final()]);
  return plaintext.toString('utf8');
}

// Returns { email, password (decrypted), enabled } or null if the platform has never
// been configured. Used internally by sessionManager/applicators — never by a route
// response (routes must mask the password, see routes/credentials.js).
export async function getCredentials(platform) {
  const data = await readAll();
  const entry = data[platform];
  if (!entry) return null;

  let password = '';
  try {
    password = decryptPassword(entry, getEncryptionKey());
  } catch (error) {
    console.warn(`Could not decrypt credentials for "${platform}": ${error.message}`);
  }

  return { email: entry.email || '', password, enabled: Boolean(entry.enabled) };
}

// Pass password: undefined/null to update email/enabled without touching the stored
// password (e.g. just flipping the "enabled" toggle from the dashboard).
export async function setCredentials(platform, { email, password, enabled } = {}) {
  const data = await readAll();
  const existing = data[platform] || {};
  const entry = { email: email ?? existing.email ?? '', enabled: Boolean(enabled) };

  if (password) {
    const key = getEncryptionKey();
    Object.assign(entry, key ? encryptPassword(password, key) : { password, encrypted: false });
  } else if (existing.password !== undefined) {
    entry.password = existing.password;
    entry.iv = existing.iv;
    entry.authTag = existing.authTag;
    entry.encrypted = existing.encrypted;
  }

  data[platform] = entry;
  await writeAll(data);
  return getCredentials(platform);
}

export async function deleteCredentials(platform) {
  const data = await readAll();
  delete data[platform];
  await writeAll(data);
}

// For GET /api/credentials — never includes the actual password, just whether one exists.
export async function listPlatforms() {
  const data = await readAll();
  return Object.entries(data).map(([platform, entry]) => ({
    platform,
    email: entry.email || '',
    enabled: Boolean(entry.enabled),
    hasPassword: Boolean(entry.password),
    encrypted: Boolean(entry.encrypted)
  }));
}
