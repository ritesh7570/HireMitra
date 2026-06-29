import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrapeAll } from './scrapers/index.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(serverDir, 'data', 'scraped_jobs.json');

async function main() {
  const keywords = process.env.SCRAPE_KEYWORDS || 'backend developer node.js';
  const location = process.env.SCRAPE_LOCATION || 'India';
  const limit = Number(process.env.SCRAPE_LIMIT) || 10;

  const { jobs, counts } = await scrapeAll(keywords, location, limit);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(jobs, null, 2), 'utf8');

  console.log(
    `Scraped ${counts.naukri} jobs from Naukri, ${counts.wellfound} from Wellfound, ${counts.linkedin} from LinkedIn`
  );
  console.log(`Saved ${jobs.length} deduplicated jobs to ${outputPath}`);
}

await main().catch((error) => {
  console.error(`Scrape failed: ${error.message}`);
  process.exitCode = 1;
});
