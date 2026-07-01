import { useEffect, useRef, useState } from 'react';
import { triggerScrape, getScrapeRuns } from '../api.js';
import ScrapeRunCard from '../components/ScrapeRunCard.jsx';
import Spinner from '../components/Spinner.jsx';

const SOURCES = ['internshala', 'naukri', 'wellfound', 'indeed', 'linkedin', 'companyPages'];

export default function ScrapeStatus() {
  const [sources, setSources] = useState({});
  const [runs, setRuns] = useState(null);
  const [form, setForm] = useState({ keywords: '', location: '', limit: 20 });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const esRef = useRef(null);

  async function loadRuns() {
    const data = await getScrapeRuns(10);
    setRuns(data.runs || []);
  }

  useEffect(() => {
    loadRuns().catch((err) => setError(err.message));

    const es = new EventSource('/api/scrape/status/stream');
    esRef.current = es;

    es.addEventListener('source-started', (event) => {
      const { source } = JSON.parse(event.data);
      setRunning(true);
      setSources((prev) => ({ ...prev, [source]: { status: 'running' } }));
    });

    es.addEventListener('source-done', (event) => {
      const { source, jobsFound, durationMs } = JSON.parse(event.data);
      setSources((prev) => ({ ...prev, [source]: { status: 'success', jobsFound, durationMs } }));
    });

    es.addEventListener('source-error', (event) => {
      const { source, error: sourceError } = JSON.parse(event.data);
      setSources((prev) => ({ ...prev, [source]: { status: 'failed', error: sourceError } }));
    });

    es.addEventListener('source-skipped', (event) => {
      const { source, error: reason } = JSON.parse(event.data);
      setSources((prev) => ({ ...prev, [source]: { status: 'skipped', error: reason } }));
    });

    es.addEventListener('run-complete', () => {
      setRunning(false);
      loadRuns().catch((err) => setError(err.message));
    });

    es.onerror = () => {
      // EventSource auto-reconnects on its own; nothing to do here beyond not crashing.
    };

    return () => es.close();
  }, []);

  async function startScrape(event) {
    event.preventDefault();
    setError('');
    setMessage('');
    setSources({});
    try {
      const body = {};
      if (form.keywords) body.keywords = form.keywords;
      if (form.location) body.location = form.location;
      if (form.limit) body.limit = Number(form.limit);
      const result = await triggerScrape(body);
      setMessage(`Scrape started: ${result.jobId}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Scrape Status</h1>
          <p>Live per-source scraping progress and run history.</p>
        </div>
      </div>

      <form className="panel form-stack" onSubmit={startScrape}>
        <div className="form-grid">
          <input
            placeholder="Keywords (optional)"
            value={form.keywords}
            onChange={(e) => setForm({ ...form, keywords: e.target.value })}
          />
          <input
            placeholder="Location (optional)"
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
          <input
            type="number"
            placeholder="Limit per source"
            value={form.limit}
            onChange={(e) => setForm({ ...form, limit: e.target.value })}
          />
        </div>
        <button type="submit" disabled={running}>
          {running ? 'Scraping...' : 'Start new scrape'}
        </button>
      </form>

      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      <div className="stats-grid">
        {SOURCES.map((source) => (
          <ScrapeRunCard key={source} source={source} data={sources[source]} />
        ))}
      </div>

      <div className="panel">
        <h2>Run History</h2>
        {runs === null ? (
          <Spinner label="Loading run history..." />
        ) : runs.length === 0 ? (
          <p className="empty-state">No scrape runs yet — start one above.</p>
        ) : (
          <div className="page-stack">
            {runs.map((run) => (
              <details key={run.runId} className="panel">
                <summary>
                  {new Date(run.startedAt).toLocaleString()} — {run.totalJobs} job(s) found,{' '}
                  {run.deduplicated} after dedupe
                </summary>
                <table style={{ marginTop: '10px' }}>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Jobs Found</th>
                      <th>Duration</th>
                      <th>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(run.sources).map(([source, data]) => (
                      <tr key={source}>
                        <td>{source}</td>
                        <td>{data.status}</td>
                        <td>{data.jobsFound}</td>
                        <td>{(data.durationMs / 1000).toFixed(1)}s</td>
                        <td>{data.error || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
