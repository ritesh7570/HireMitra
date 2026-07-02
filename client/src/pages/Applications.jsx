import { useEffect, useState } from 'react';
import { getApplications } from '../api.js';
import AppRow from '../components/AppRow.jsx';
import AppCard from '../components/AppCard.jsx';
import Spinner from '../components/Spinner.jsx';

export default function Applications() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const data = await getApplications();
    setItems(data.items || []);
  }

  useEffect(() => {
    load().catch((loadError) => setError(loadError.message));
  }, []);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Applications Pipeline</h1>
          <p>Track every role, status update, and follow-up action in one polished workspace.</p>
        </div>
      </div>
      {error && <p className="notice error">{error}</p>}
      <div className="panel table-wrap">
        {items === null ? (
          <Spinner label="Loading applications..." />
        ) : items.length === 0 ? (
          <p className="empty-state">No applications yet — use Manual Apply or run the pipeline to create some.</p>
        ) : (
          <>
            <div className="desktop-table">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Company</th>
                      <th>Role</th>
                      <th>Posted</th>
                      <th>Deadline</th>
                      <th>Score</th>
                      <th>Status</th>
                      <th>Email Sent</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => <AppRow key={item._id} application={item} onChanged={load} />)}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mobile-cards">
              {items.map((item) => (
                <AppCard key={item._id} application={item} onChanged={load} />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
