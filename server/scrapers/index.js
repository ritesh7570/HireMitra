import scrapeNaukri from './naukri.js';
import scrapeWellfound from './wellfound.js';
import scrapeLinkedin from './linkedin.js';
import scrapeInternshala from './internshala.js';
import scrapeIndeed from './indeed.js';
import scrapeCompanyPages from './companyPages.js';
import { dedupe } from './utils.js';

export async function scrapeAll(keywordsOrOptions, locationArg, limitArg = 20) {
  const options =
    typeof keywordsOrOptions === 'object'
      ? keywordsOrOptions
      : { keywords: keywordsOrOptions, location: locationArg, limit: limitArg };
  const enabledSources = options.sources || [
    'internshala',
    'naukri',
    'wellfound',
    'indeed',
    'linkedin',
    'companyPages'
  ];
  const allScrapers = {
    internshala: scrapeInternshala,
    naukri: scrapeNaukri,
    wellfound: scrapeWellfound,
    indeed: scrapeIndeed,
    linkedin: scrapeLinkedin,
    companyPages: scrapeCompanyPages
  };
  const scrapers = enabledSources
    .filter((source) => allScrapers[source])
    .map((source) => [source, allScrapers[source]]);

  const results = await Promise.allSettled(
    scrapers.map(async ([source, scraper]) => ({
      source,
      jobs: await scraper({
        keywords: options.keywords,
        location: options.location,
        limit: options.limit || 20
      })
    }))
  );

  const counts = {};
  const jobs = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      counts[result.value.source] = result.value.jobs.length;
      jobs.push(...result.value.jobs);
    } else {
      console.warn(`Scraper failed: ${result.reason.message}`);
    }
  }

  return { jobs: dedupe(jobs), counts };
}
