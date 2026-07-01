// Per-scrape-run reporting: tracks per-source status/timing/errors as scrapeAll() runs,
// writes the final summary to server/data/scrape_runs/run_<id>.json, and broadcasts
// events onto a shared `scrapeHub` EventEmitter that any number of SSE clients can
// subscribe to regardless of whether they connected before or after a given run started
// (routes/scrape.js's GET /status/stream is the consumer — see Phase 3 Part D, step 3).
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runsDir = path.join(serverDir, 'data', 'scrape_runs');

// Shared across every ScrapeRun instance in this process — SSE clients subscribe here
// once and see events from whichever run happens to be active, past or future.
export const scrapeHub = new EventEmitter();

export class ScrapeRun extends EventEmitter {
  constructor() {
    super();
    this.runId = new Date().toISOString().replace(/[:.]/g, '-');
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.sources = {};
  }

  _broadcast(event, payload) {
    const withRunId = { runId: this.runId, ...payload };
    this.emit(event, withRunId);
    scrapeHub.emit(event, withRunId);
  }

  sourceStarted(source) {
    this.sources[source] = { status: 'running', jobsFound: 0, durationMs: 0, error: null };
    this._broadcast('source-started', { source });
  }

  sourceProgress(source, found) {
    if (this.sources[source]) this.sources[source].jobsFound = found;
    this._broadcast('source-progress', { source, found });
  }

  sourceDone(source, jobsFound, durationMs) {
    this.sources[source] = { status: 'success', jobsFound, durationMs, error: null };
    this._broadcast('source-done', { source, jobsFound, durationMs });
  }

  sourceFailed(source, error, durationMs) {
    this.sources[source] = { status: 'failed', jobsFound: 0, durationMs, error };
    this._broadcast('source-error', { source, error });
  }

  sourceSkipped(source, reason) {
    this.sources[source] = { status: 'skipped', jobsFound: 0, durationMs: 0, error: reason };
    this._broadcast('source-skipped', { source, error: reason });
  }

  async finish({ totalJobs, deduplicated }) {
    this.finishedAt = new Date().toISOString();
    const record = {
      runId: this.runId,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      sources: this.sources,
      totalJobs,
      deduplicated
    };

    await fs.mkdir(runsDir, { recursive: true });
    await fs.writeFile(path.join(runsDir, `run_${this.runId}.json`), JSON.stringify(record, null, 2), 'utf8');

    this._broadcast('run-complete', record);
    return record;
  }
}

export async function listScrapeRuns(limit = 10) {
  await fs.mkdir(runsDir, { recursive: true });
  const files = await fs.readdir(runsDir);
  const runFiles = files
    .filter((file) => file.startsWith('run_') && file.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  const runs = [];
  for (const file of runFiles) {
    try {
      runs.push(JSON.parse(await fs.readFile(path.join(runsDir, file), 'utf8')));
    } catch {
      // Skip unreadable/corrupt run files rather than failing the whole list.
    }
  }
  return runs;
}
