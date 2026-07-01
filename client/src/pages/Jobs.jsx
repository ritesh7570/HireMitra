import { useEffect, useState } from 'react';
import { getJobs, triggerScrape, deleteJob } from '../api.js';
import Spinner from '../components/Spinner.jsx';

function ageLabel(iso) {
  if (!iso) return null;
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  return `${days}d ago`;
}

function ageBadgeClass(iso) {
  if (!iso) return 'badge-muted';
  const hours = (Date.now() - new Date(iso).getTime()) / 3600000;
  if (hours < 24) return 'badge-green';
  if (hours < 72) return 'badge-blue';
  if (hours < 168) return 'badge-amber';
  return 'badge-red';
}

const SOURCE_LABELS = {
  internshala: 'Internshala',
  naukri: 'Naukri',
  linkedin: 'LinkedIn',
  wellfound: 'Wellfound',
  indeed: 'Indeed',
  companyPages: 'Company',
  companyWatchlist: 'Watchlist'
};

export default function Jobs() {
  const [jobs, setJobs] = useState(null);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(null);
  const [filter, setFilter] = useState('');

  async function load() {
    const data = await getJobs();
    setJobs(data.items || []);
  }

  async function scrape() {
    setMessage('');
    try {
      const result = await triggerScrape({});
      setMessage(`Scrape started: ${result.jobId}`);
    } catch (e) {
      setMessage(e.message);
    }
  }

  async function remove(applyUrl) {
    setDeleting(applyUrl);
    try {
      await deleteJob(applyUrl);
      setJobs((prev) => prev.filter((j) => j.applyUrl !== applyUrl));
    } catch (e) {
      setMessage(e.message);
    } finally {
      setDeleting(null);
    }
  }

  useEffect(() => { load().catch((e) => setMessage(e.message)); }, []);

  const visible = (jobs || []).filter((job) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      job.title?.toLowerCase().includes(q) ||
      job.company?.toLowerCase().includes(q) ||
      job.source?.toLowerCase().includes(q) ||
      job.location?.toLowerCase().includes(q)
    );
  });

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Scraped Jobs</h1>
          <p>Jobs fetched from all enabled sources. Delete any you've already applied to or aren't interested in.</p>
        </div>
        <button type="button" onClick={scrape}>Trigger Scrape</button>
      </div>

      {message && <p className="notice">{message}</p>}

      {jobs !== null && jobs.length > 0 && (
        <div style={{ maxWidth: 360 }}>
          <input
            placeholder="Filter by role, company, source…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ marginBottom: 0 }}
          />
        </div>
      )}

      <div className="panel table-wrap">
        {jobs === null ? (
          <Spinner label="Loading jobs..." />
        ) : visible.length === 0 ? (
          <p className="empty-state">
            {jobs.length === 0
              ? 'No jobs scraped yet — click "Trigger Scrape" to fetch some.'
              : 'No jobs match the current filter.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Company</th>
                <th>Source</th>
                <th>Location</th>
                <th>Scraped</th>
                <th>Email</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((job) => (
                <tr key={job.applyUrl}>
                  <td style={{ fontWeight: 600 }}>{job.title}</td>
                  <td>{job.company}</td>
                  <td>
                    <span className="badge badge-muted">{SOURCE_LABELS[job.source] || job.source}</span>
                  </td>
                  <td style={{ color: 'var(--muted)', fontSize: 13 }}>{job.location || '—'}</td>
                  <td>
                    {job.scrapedAt ? (
                      <span className={`badge ${ageBadgeClass(job.scrapedAt)}`} title={new Date(job.scrapedAt).toLocaleString()}>
                        {ageLabel(job.scrapedAt)}
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)' }}>{job.recruiterEmail || '—'}</td>
                  <td>
                    <div className="row-actions">
                      <a
                        href={job.applyUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="button ghost"
                        style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                      >
                        Open
                      </a>
                      <button
                        type="button"
                        className="danger"
                        style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                        onClick={() => remove(job.applyUrl)}
                        disabled={deleting === job.applyUrl}
                      >
                        {deleting === job.applyUrl ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {jobs !== null && jobs.length > 0 && (
        <p className="muted" style={{ fontSize: 13 }}>
          Showing {visible.length} of {jobs.length} job{jobs.length !== 1 ? 's' : ''}.
          Green = scraped today · Blue = 1-3 days · Amber = this week · Red = older.
        </p>
      )}
    </section>
  );
}
