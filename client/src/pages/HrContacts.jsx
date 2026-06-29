import { useEffect, useState } from 'react';
import { getHrContacts, setHrContactSent, uploadHrList } from '../api.js';

export default function HrContacts() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);

  async function load() {
    setData(await getHrContacts());
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

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

  async function toggleSent(contact) {
    try {
      await setHrContactSent(contact._id, !contact.emailSent);
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
          <p>Upload a list of HR/recruiter contacts — up to 20 get cold-emailed automatically each day.</p>
        </div>
        <label className="button">
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
              <span>Emailed</span>
              <strong>{data.sentCount}</strong>
            </div>
            <div className="stat-card">
              <span>Remaining</span>
              <strong>{data.total - data.sentCount}</strong>
            </div>
          </div>

          <div className="panel table-wrap">
            {data.items.length === 0 ? (
              <p className="muted">No HR contacts yet — upload a PDF or DOCX list to get started.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Company</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Sent</th>
                    <th>Sent At</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((contact) => (
                    <tr key={contact._id}>
                      <td>{contact.name || '—'}</td>
                      <td>{contact.company || '—'}</td>
                      <td>{contact.email}</td>
                      <td>{contact.role || '—'}</td>
                      <td>
                        <input
                          type="checkbox"
                          checked={contact.emailSent}
                          onChange={() => toggleSent(contact)}
                          title="Mark as sent/unsent"
                        />
                      </td>
                      <td>{contact.emailedAt ? new Date(contact.emailedAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
