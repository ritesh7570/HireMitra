import { chromium } from 'playwright';

export const userAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export function getUserAgent() {
  return userAgent;
}

export function randomDelay(min = 1500, max = 3500) {
  const waitMs = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

export async function createBrowserPage() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1366, height: 768 },
    locale: 'en-US'
  });
  const page = await context.newPage();
  return { browser, page };
}

export function cleanText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function extractEmail(text) {
  const match = cleanText(text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

export const extractRecruiterEmail = extractEmail;

export function dedupe(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${job.title || ''}|${job.company || ''}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
