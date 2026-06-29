import { useEffect, useState } from 'react';
import { getJobs, triggerScrape } from '../api.js';
import Spinner from '../components/Spinner.jsx';

export default function Jobs() {
  const [jobs, setJobs] = useState(null);
  const [message, setMessage] = useState('');

  async function load() {
    const data = await getJobs();
    setJobs(data.items || []);
  }

  async function scrape() {
    const result = await triggerScrape({});
    setMessage(`Scrape started: ${result.jobId}`);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Scraped Jobs</h1>
          <p>Cached jobs from enabled sources.</p>
        </div>
        <button type="button" onClick={scrape}>Trigger Scrape</button>
      </div>
      {message && <p className="notice">{message}</p>}
      <div className="panel table-wrap">
        {jobs === null ? (
          <Spinner label="Loading jobs..." />
        ) : jobs.length === 0 ? (
          <p className="empty-state">No jobs scraped yet — click "Trigger Scrape" to fetch some.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Role</th>
                <th>Company</th>
                <th>Source</th>
                <th>Email</th>
                <th>Link</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={`${job.source}-${job.applyUrl}`}>
                  <td>{job.title}</td>
                  <td>{job.company}</td>
                  <td>{job.source}</td>
                  <td>{job.recruiterEmail || 'None'}</td>
                  <td><a href={job.applyUrl} target="_blank" rel="noreferrer">Open</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
