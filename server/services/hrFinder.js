// Best-effort HR/recruiter email finder for jobs where the JD itself didn't contain one
// (common for newly founded startups with no listed contact). Checks, in order:
//   1. The company's own website (about/contact/team/careers pages)
//   2. The company's public GitHub org (org-level email, then members' public emails)
// Deliberately does NOT scrape LinkedIn profiles — see PHASE2_CODEX_PROMPT_v2.md scope
// discussion: LinkedIn aggressively blocks automated profile/people-search interactions,
// and the existing LinkedIn scraper is already restricted to public job listings only.
import { extractEmail } from '../scrapers/utils.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

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

const CONTACT_PATHS = ['', '/about', '/about-us', '/contact', '/contact-us', '/team', '/careers'];

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
    const email = extractEmail(html);
    if (email) return email;
  }
  return null;
}

function slugifyCompany(company) {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function fetchJson(url) {
  const text = await fetchText(url);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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

// Public, unauthenticated GitHub API calls are rate-limited to 60/hour per IP, so this
// stays best-effort and silent on failure rather than retrying.
export async function findHrContact({ company }) {
  const website = await findCompanyWebsite(company);
  const siteEmail = await searchCompanySiteForEmail(website);
  if (siteEmail) {
    return { email: siteEmail, source: 'company-website', website };
  }

  const githubEmail = await searchGithubOrgForEmail(company);
  if (githubEmail) {
    return { email: githubEmail, source: 'github-org' };
  }

  return null;
}
