import { useState } from 'react';
import { runManualApply, resendEmail } from '../api.js';

export default function ManualApply() {
  const [form, setForm] = useState({ jd: '', recruiterEmail: '', recruiterName: '', company: '', role: '' });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  function update(event) {
    setForm({ ...form, [event.target.name]: event.target.value });
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    try {
      setResult(await runManualApply(form));
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  }

  async function sendNow() {
    await resendEmail(result.id);
    setMessage('Email sent.');
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Manual Apply</h1>
          <p>Paste a JD, get score, drafts, and a tailored resume.</p>
        </div>
      </div>
      <div className="two-column">
        <form className="panel form-stack" onSubmit={submit}>
          <textarea name="jd" value={form.jd} onChange={update} placeholder="Paste job description" required />
          <div className="form-grid">
            <input name="recruiterEmail" value={form.recruiterEmail} onChange={update} placeholder="Recruiter email" />
            <input name="recruiterName" value={form.recruiterName} onChange={update} placeholder="Recruiter name" />
            <input name="company" value={form.company} onChange={update} placeholder="Company" />
            <input name="role" value={form.role} onChange={update} placeholder="Role" />
          </div>
          <button type="submit" disabled={loading}>{loading ? 'Processing...' : 'Process'}</button>
        </form>
        <div className="panel result-panel">
          {message && <p className="notice">{message}</p>}
          {!result && <p className="muted">Results will appear here.</p>}
          {result && (
            <>
              <span className="score-badge">{result.score}/100</span>
              <h2>{result.role} at {result.company}</h2>
              <h3>Changes</h3>
              <ul>{result.changesMade.map((change) => <li key={change}>{change}</li>)}</ul>
              <h3>Cold Email</h3>
              <pre>{result.emailDraft.text}</pre>
              <h3>Referral</h3>
              <pre>{result.referralDraft}</pre>
              <div className="inline-actions">
                <button type="button" onClick={sendNow}>Send Email Now</button>
                <a className="button ghost" href={`/api/applications/${result.id}/resume`} target="_blank" rel="noreferrer">
                  Download Resume
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
