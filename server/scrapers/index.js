import scrapeNaukri from './naukri.js';
import scrapeWellfound from './wellfound.js';
import scrapeLinkedin from './linkedin.js';
import scrapeInternshala from './internshala.js';
import scrapeIndeed from './indeed.js';
import scrapeCompanyPages from './companyPages.js';
import scrapeCompanyWatchlist from './companyWatchlist.js';
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
    'companyPages',
    'companyWatchlist'
  ];
  const allScrapers = {
    internshala: scrapeInternshala,
    naukri: scrapeNaukri,
    wellfound: scrapeWellfound,
    indeed: scrapeIndeed,
    linkedin: scrapeLinkedin,
    companyPages: scrapeCompanyPages,
    companyWatchlist: scrapeCompanyWatchlist
  };
  const scrapers = enabledSources
    .filter((source) => allScrapers[source])
    .map((source) => [source, allScrapers[source]]);

  // reporter (services/scrapeReporter.js's ScrapeRun) is optional — when passed, every
  // source's start/success/failure gets timed and recorded for the per-run log + any
  // future live-progress listeners. Callers that don't care just omit it.
  const reporter = options.reporter;

  const results = await Promise.allSettled(
    scrapers.map(async ([source, scraper]) => {
      reporter?.sourceStarted(source);
      const startedAt = Date.now();
      try {
        const sourceJobs = await scraper({
          keywords: options.keywords,
          location: options.location,
          limit: options.limit || 20
        });
        reporter?.sourceDone(source, sourceJobs.length, Date.now() - startedAt);
        return { source, jobs: sourceJobs };
      } catch (error) {
        reporter?.sourceFailed(source, error.message, Date.now() - startedAt);
        throw error;
      }
    })
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

  const deduped = dedupe(jobs);
  if (reporter) {
    await reporter.finish({ totalJobs: jobs.length, deduplicated: deduped.length });
  }

  return { jobs: deduped, counts };
}
