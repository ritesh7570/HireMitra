import { useEffect, useState } from 'react';

const API = '/api/companies';

const PRIORITY_LABELS = { 1: 'Every run', 2: 'Every 12h', 3: 'Weekly' };

function timeAgo(iso) {
  if (!iso) return 'Never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

const EMPTY_FORM = { name: '', careersUrl: '', selector: '', priority: 1, tags: '' };

export default function Companies() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);
  const [testingId, setTestingId] = useState(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(API);
      const data = await res.json();
      setCompanies(data.companies || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function startAdd() {
    setEditingId('__new__');
    setForm(EMPTY_FORM);
  }

  function startEdit(company) {
    setEditingId(company.id);
    setForm({
      name: company.name,
      careersUrl: company.careersUrl,
      selector: company.selector || '',
      priority: company.priority ?? 1,
      tags: (company.tags || []).join(', ')
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        careersUrl: form.careersUrl.trim(),
        selector: form.selector.trim(),
        priority: Number(form.priority),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean)
      };

      const res = editingId === '__new__'
        ? await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch(`${API}/${editingId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Save failed');
      }
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id) {
    if (!confirm('Remove this company from the watchlist?')) return;
    await fetch(`${API}/${id}`, { method: 'DELETE' });
    await load();
  }

  async function testScrape(company) {
    setTestingId(company.id);
    setPreview(null);
    setError('');
    try {
      const res = await fetch(`${API}/${company.id}/test-scrape`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Test scrape failed');
      setPreview({ company: company.name, jobs: data.jobs, count: data.count });
    } catch (e) {
      setError(e.message);
    } finally {
      setTestingId(null);
    }
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Company Watchlist</h1>
          <p>Target companies whose career pages are scraped on every pipeline run. Jobs from these companies are prioritized in the queue.</p>
        </div>
        <button type="button" onClick={startAdd}>+ Add Company</button>
      </div>

      {error && <p className="notice error">{error}</p>}

      {editingId && (
        <div className="panel">
          <h2>{editingId === '__new__' ? 'Add Company' : 'Edit Company'}</h2>
          <div className="form-stack">
            <div className="form-grid">
              <div>
                <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 13 }}>Company Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Razorpay" />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 13 }}>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value={1}>1 — Every run</option>
                  <option value={2}>2 — Every 12h</option>
                  <option value={3}>3 — Weekly</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 13 }}>Careers Page URL *</label>
              <input value={form.careersUrl} onChange={(e) => setForm({ ...form, careersUrl: e.target.value })} placeholder="https://company.com/jobs" />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 13 }}>CSS Selector (optional — leave blank to use AI extraction)</label>
              <input value={form.selector} onChange={(e) => setForm({ ...form, selector: e.target.value })} placeholder=".job-card, .opening-row, etc." />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6, color: 'var(--muted)', fontSize: 13 }}>Tags (comma-separated)</label>
              <input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="fintech, remote-friendly" />
            </div>
            <div className="row-actions">
              <button type="button" onClick={save} disabled={saving || !form.name || !form.careersUrl}>
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="ghost" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="spinner-row"><div className="spinner" /><span>Loading watchlist…</span></div>
      ) : companies.length === 0 ? (
        <div className="empty-state">No companies in watchlist yet. Add one above.</div>
      ) : (
        <div className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Careers URL</th>
                  <th>Selector</th>
                  <th>Priority</th>
                  <th>Last Scraped</th>
                  <th>Tags</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td style={{ maxWidth: 200, wordBreak: 'break-all', fontSize: 12 }}>
                      <a href={c.careersUrl} target="_blank" rel="noreferrer">{c.careersUrl}</a>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{c.selector || <em>AI</em>}</td>
                    <td>
                      <span className="badge badge-blue">{PRIORITY_LABELS[c.priority] || c.priority}</span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{timeAgo(c.lastScrapedAt)}</td>
                    <td style={{ fontSize: 12 }}>{(c.tags || []).join(', ') || '—'}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="ghost"
                          style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                          onClick={() => testScrape(c)}
                          disabled={testingId === c.id}
                        >
                          {testingId === c.id ? 'Scraping…' : 'Test Scrape'}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                          onClick={() => startEdit(c)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="danger"
                          style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }}
                          onClick={() => remove(c.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {preview && (
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2>Test Scrape Preview — {preview.company}</h2>
            <button type="button" className="ghost" style={{ fontSize: 12, padding: '6px 12px', minHeight: 32 }} onClick={() => setPreview(null)}>Close</button>
          </div>
          <p className="muted">{preview.count} job{preview.count !== 1 ? 's' : ''} found</p>
          {preview.jobs.length === 0 ? (
            <p className="empty-state">No jobs found — try adding or adjusting the CSS selector, or check that the careers page is publicly accessible.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Title</th><th>Location</th><th>Apply URL</th></tr>
                </thead>
                <tbody>
                  {preview.jobs.map((job, i) => (
                    <tr key={i}>
                      <td>{job.title}</td>
                      <td style={{ color: 'var(--muted)', fontSize: 13 }}>{job.location}</td>
                      <td style={{ fontSize: 12 }}>
                        <a href={job.applyUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                          {job.applyUrl.length > 60 ? job.applyUrl.slice(0, 60) + '…' : job.applyUrl}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
