import { useEffect, useState } from 'react';
import { getHrBatchStatus, sendHrBatch } from '../api.js';

export default function TodayPlan() {
  const [status, setStatus] = useState(null);
  const [count, setCount] = useState(5);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setStatus(await getHrBatchStatus());
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, []);

  async function send() {
    setSending(true);
    setError('');
    setMessage('');
    try {
      const result = await sendHrBatch(count);
      if (result.skipped) {
        setMessage(result.reason);
      } else {
        setMessage(`Sent ${result.sent}/${result.attempted} (${result.failed} failed).`);
      }
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="panel">
      <h2>Today's Plan</h2>
      {error && <p className="notice error">{error}</p>}
      {message && <p className="notice">{message}</p>}
      {!status ? (
        <p className="muted">Loading...</p>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span>HR Contacts Total</span>
              <strong>{status.total}</strong>
            </div>
            <div className="stat-card">
              <span>Emailed Today</span>
              <strong>{status.sentToday}</strong>
            </div>
            <div className="stat-card">
              <span>Remaining</span>
              <strong>{status.remaining}</strong>
            </div>
          </div>
          <div className="inline-actions" style={{ marginTop: '12px' }}>
            <input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(event) => setCount(Number(event.target.value) || 1)}
              style={{ width: '80px' }}
            />
            <button type="button" onClick={send} disabled={sending || status.remaining === 0}>
              {sending ? 'Sending...' : `Send to next ${count} HR contact(s)`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
