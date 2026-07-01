// Best-effort HR/recruiter email finder for jobs where the JD didn't contain a contact.
// Lookup chain (stops at first hit):
//   1. Hunter.io domain-search API (most reliable — verified emails, HR dept filter first)
//   2. Company website scrape (about/contact/team/careers + mailto: links + Gmail pattern)
//   3. Company's public GitHub org (org-level email, then members' public emails)
//
// Hunter.io free tier: 25 domain searches/month. An in-process cache prevents burning
// credits on the same company twice in one pipeline run.
//
// Deliberately does NOT scrape LinkedIn profiles — aggressive anti-bot risk.
// Apollo.io is the next candidate to add as a Step 4 if Hunter credits run out.
import { extractEmail } from '../scrapers/utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// In-process cache so one pipeline run never calls Hunter twice for the same domain.
const hunterCache = new Map();

async function fetchText(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    if (!response.ok) return '';
    return await response.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, ...headers }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Step 1: Hunter.io ────────────────────────────────────────────────────────

// Picks the best HR-relevant email from Hunter's domain-search response.
// Priority: HR/People/Talent department → recruiter/hr/talent in position/email →
//           highest-confidence email overall.
function pickBestHunterEmail(emails) {
  if (!emails?.length) return null;

  const HR_DEPARTMENTS = new Set(['human_resources', 'recruiting']);
  const HR_KEYWORDS = /\b(hr|recruit|talent|people|hiring|staffing)\b/i;

  // 1. HR department match
  const byDept = emails.filter((e) => HR_DEPARTMENTS.has(e.department));
  if (byDept.length) {
    return byDept.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0].value;
  }

  // 2. HR keyword in position or email address itself
  const byKeyword = emails.filter(
    (e) => HR_KEYWORDS.test(e.position || '') || HR_KEYWORDS.test(e.value || '')
  );
  if (byKeyword.length) {
    return byKeyword.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0].value;
  }

  // 3. Highest-confidence email overall (generic contact@ / info@ less useful but beats nothing)
  return emails.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0]?.value || null;
}

export async function findEmailViaHunter(domain) {
  const apiKey = process.env.API_HUNTER_API_KEY || process.env.HUNTER_API_KEY;
  if (!apiKey) return null;
  if (!domain) return null;

  if (hunterCache.has(domain)) return hunterCache.get(domain);

  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=20&api_key=${apiKey}`;
  const data = await fetchJson(url);

  const emails = data?.data?.emails || [];
  const email = pickBestHunterEmail(emails);

  hunterCache.set(domain, email); // cache even null — don't retry a failed domain
  return email;
}

// ─── Step 2: Company website scrape ──────────────────────────────────────────

function extractFirstDuckDuckGoResult(html) {
  const match = html.match(/class="result__a"[^>]*href="([^"]+)"/i);
  if (!match) return null;
  try {
    const url = new URL(match[1], 'https://duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    return redirected ? decodeURIComponent(redirected) : match[1];
  } catch {
    return match[1];
  }
}

export async function findCompanyWebsite(company) {
  if (!company || company === 'Unknown') return null;
  const html = await fetchText(
    `https://duckduckgo.com/html/?q=${encodeURIComponent(`${company} official website`)}`
  );
  return extractFirstDuckDuckGoResult(html);
}

// Extract mailto: links first (most reliable), then regex for any email including Gmail.
function extractEmailFromHtml(html) {
  // mailto: links — most explicit signal
  const mailtoMatch = html.match(/mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
  if (mailtoMatch) return mailtoMatch[1];

  // Gmail addresses specifically — small companies often use personal Gmail for HR
  const gmailMatch = html.match(/\b([a-zA-Z0-9._%+\-]+@gmail\.com)\b/i);
  if (gmailMatch) return gmailMatch[1];

  // Any other email
  return extractEmail(html);
}

const CONTACT_PATHS = [
  '', '/about', '/about-us', '/contact', '/contact-us',
  '/team', '/people', '/careers', '/jobs', '/hr', '/leadership'
];

export async function searchCompanySiteForEmail(websiteUrl) {
  if (!websiteUrl) return null;
  let origin;
  try {
    origin = new URL(websiteUrl).origin;
  } catch {
    return null;
  }

  for (const pathSuffix of CONTACT_PATHS) {
    const html = await fetchText(`${origin}${pathSuffix}`);
    const email = extractEmailFromHtml(html);
    if (email) return email;
  }
  return null;
}

// ─── Step 3: GitHub org ───────────────────────────────────────────────────────

function slugifyCompany(company) {
  return company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export async function searchGithubOrgForEmail(company) {
  if (!company || company === 'Unknown') return null;
  const slug = slugifyCompany(company);
  const candidates = [...new Set([slug, slug.replace(/-/g, '')])].filter(Boolean);

  for (const candidate of candidates) {
    const org = await fetchJson(`https://api.github.com/orgs/${candidate}`);
    if (!org || org.message === 'Not Found') continue;
    if (org.email) return org.email;

    const members = await fetchJson(`https://api.github.com/orgs/${candidate}/members?per_page=10`);
    if (!Array.isArray(members)) continue;

    for (const member of members.slice(0, 5)) {
      const user = await fetchJson(`https://api.github.com/users/${member.login}`);
      if (user?.email) return user.email;
    }
  }
  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// Public, unauthenticated GitHub API calls are rate-limited to 60/hour per IP.
// Hunter.io free tier: 25 domain searches/month (cached per domain per process run).
// Apollo.io can be added here as Step 4 in future when Hunter credits run low.
export async function findHrContact({ company }) {
  // Resolve the company's website first — needed for both Hunter (domain) and site scrape.
  const website = await findCompanyWebsite(company);

  // Step 1: Hunter.io — most reliable, uses verified email database.
  if (website) {
    try {
      const domain = new URL(website).hostname.replace(/^www\./, '');
      const hunterEmail = await findEmailViaHunter(domain);
      if (hunterEmail) {
        return { email: hunterEmail, source: 'hunter.io', website, domain };
      }
    } catch {
      // malformed URL — fall through
    }
  }

  // Step 2: Scrape company website pages directly.
  const siteEmail = await searchCompanySiteForEmail(website);
  if (siteEmail) {
    return { email: siteEmail, source: 'company-website', website };
  }

  // Step 3: GitHub org public emails.
  const githubEmail = await searchGithubOrgForEmail(company);
  if (githubEmail) {
    return { email: githubEmail, source: 'github-org' };
  }

  return null;
}
