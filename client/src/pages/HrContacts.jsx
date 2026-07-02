import { useEffect, useState } from 'react';
import { getHrContacts, setHrContactSent, uploadHrList } from '../api.js';
import AppIcon from '../components/AppIcon.jsx';

export default function HrContacts() {
  const [data, setData] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);

  async function load(searchTerm = search) {
    setData(await getHrContacts(1, searchTerm));
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  function onSearchChange(event) {
    const value = event.target.value;
    setSearch(value);
    load(value).catch((err) => setError(err.message));
  }

  async function onUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    setMessage('');
    try {
      const result = await uploadHrList(file);
      const chunkNote = result.chunkFailures
        ? ` (${result.chunkFailures}/${result.chunks} chunk(s) failed and were skipped)`
        : '';
      setMessage(
        `Found ${result.found} contact(s) across ${result.chunks} chunk(s) — added ${result.inserted}, skipped ${result.skipped} duplicate(s).${chunkNote}`
      );
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function toggleSent(hr) {
    try {
      await setHrContactSent(hr._id, !hr.emailSent);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>HR Contacts</h1>
          <p>Grouped by company — up to 20 not-yet-emailed contacts get cold-emailed automatically each day.</p>
        </div>
        <label className="button upload-button">
          {uploading ? 'Uploading...' : 'Upload PDF/DOCX'}
          <input type="file" accept=".pdf,.docx" onChange={onUpload} disabled={uploading} hidden />
        </label>
      </div>

      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice">{message}</p>}

      {!data ? (
        <p className="muted">Loading HR contacts...</p>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span>Total Contacts</span>
              <strong>{data.total}</strong>
            </div>
            <div className="stat-card">
              <span>Companies</span>
              <strong>{data.totalCompanies}</strong>
            </div>
            <div className="stat-card">
              <span>Emailed</span>
              <strong>{data.sentCount}</strong>
            </div>
            <div className="stat-card">
              <span>Remaining</span>
              <strong>{data.remaining}</strong>
            </div>
          </div>

          <div className="search-row">
            <input
              className="search-input"
              type="text"
              placeholder="Search by company name..."
              value={search}
              onChange={onSearchChange}
            />
            <div className="search-actions">
              <label className="button button-ghost upload-button-inline">
                {uploading ? 'Uploading...' : 'Upload'}
                <input type="file" accept=".pdf,.docx" onChange={onUpload} disabled={uploading} hidden />
              </label>
            </div>
          </div>

          <div className="page-stack">
            {data.companies.length === 0 ? (
              <p className="empty-state">
                {search ? `No companies matching "${search}".` : 'No HR contacts yet — upload a PDF or DOCX list to get started.'}
              </p>
            ) : (
              data.companies.map((group) => (
                <div key={group._id} className="panel table-wrap company-panel">
                  <div className="panel-header">
                    <div>
                      <h3>{group.company}</h3>
                      <p className="muted">{group.hrs.length} contact(s)</p>
                    </div>
                    <div className="inline-actions">
                      <span className="muted">{group.location || ''}</span>
                    </div>
                  </div>

                  <div className="desktop-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Email</th>
                          <th>Role</th>
                          <th>LinkedIn</th>
                          <th>Sent</th>
                          <th>Sent At</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.hrs.map((hr) => (
                          <tr key={hr._id}>
                            <td>{hr.name || '—'}</td>
                            <td>{hr.email}</td>
                            <td>{hr.role || '—'}</td>
                            <td>
                              {hr.linkedin ? (
                                <a href={hr.linkedin.startsWith('http') ? hr.linkedin : `https://${hr.linkedin}`} target="_blank" rel="noreferrer">
                                  Profile
                                </a>
                              ) : '—'}
                            </td>
                            <td>
                              <input
                                type="checkbox"
                                checked={hr.emailSent}
                                onChange={() => toggleSent(hr)}
                                title="Mark as sent/unsent"
                              />
                            </td>
                            <td>{hr.emailedAt ? new Date(hr.emailedAt).toLocaleString() : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mobile-cards">
                    {group.hrs.map((hr) => (
                      <div key={hr._id} className="hr-card">
                        <div className="hr-main">
                          <div>
                            <strong>{hr.name || '—'}</strong>
                            <div className="card-row">
                              <span className="card-badge">
                                <AppIcon name="profile" className="card-icon" />
                                {hr.role || '—'}
                              </span>
                              <span className="card-badge">
                                <AppIcon name="location" className="card-icon" />
                                {group.location || 'Unknown location'}
                              </span>
                            </div>
                          </div>
                          <div className="hr-actions">
                            <button type="button" className="button ghost small" onClick={() => toggleSent(hr)}>
                              <AppIcon name="check" className="card-icon" />
                              <span>{hr.emailSent ? 'Sent' : 'Mark sent'}</span>
                            </button>
                          </div>
                        </div>
                        <div className="hr-meta">
                          <div className="meta-item">
                            <AppIcon name="email" />
                            <span>{hr.email}</span>
                          </div>
                          <div className="meta-item">
                            {hr.linkedin ? (
                              <a href={hr.linkedin.startsWith('http') ? hr.linkedin : `https://${hr.linkedin}`} target="_blank" rel="noreferrer">
                                <AppIcon name="linkedin" className="card-icon" />
                                <span>LinkedIn</span>
                              </a>
                            ) : '—'}
                          </div>
                          <div className="muted small card-row">
                            <AppIcon name="calendar" className="card-icon" />
                            <span>{hr.emailedAt ? new Date(hr.emailedAt).toLocaleString() : 'Not emailed'}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </section>
  );
}
