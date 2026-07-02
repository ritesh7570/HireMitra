import { resendEmail, updateStatus } from '../api.js';
import AppIcon from './AppIcon.jsx';
import StatusBadge from './StatusBadge.jsx';

const statuses = ['drafted', 'applied', 'auto_applied', 'email_sent', 'needs_manual', 'notified', 'referral_sent', 'rejected', 'interview'];

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export default function AppCard({ application, onChanged }) {
  async function handleStatus(event) {
    await updateStatus(application._id, event.target.value);
    onChanged();
  }

  async function handleResend() {
    await resendEmail(application._id);
    onChanged();
  }

  return (
    <div className="app-card">
      <div className="card-header">
        <div>
          <strong>{application.company}</strong>
          <div className="card-row">
            <span className="card-badge">
              <AppIcon name="jobs" className="card-icon" />
              {application.jobTitle || 'Untitled role'}
            </span>
            <span className="card-badge">
              <AppIcon name="calendar" className="card-icon" />
              {formatDate(application.appliedAt)}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', minWidth: 120 }}>
          <StatusBadge status={application.status} />
          <div className="card-row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
            <span className="card-badge">
              <AppIcon name="check" className="card-icon" />
              {application.emailSent ? 'Email sent' : 'No email'}
            </span>
          </div>
        </div>
      </div>

      <div className="card-meta">
        <div className="meta-item">
          <AppIcon name="calendar" />
          <span>Posted: {formatDate(application.postedDate)}</span>
        </div>
        <div className="meta-item">
          <AppIcon name="calendar" />
          <span>Deadline: {formatDate(application.applicationDeadline)}</span>
        </div>
        <div className="meta-item">
          <AppIcon name="sparkles" />
          <span>Score: {application.eligibilityScore ?? '—'}</span>
        </div>
        <div className="meta-item">
          <AppIcon name="email" />
          <span>{application.recruiterEmail || 'No recruiter email'}</span>
        </div>
      </div>

      <div className="card-actions">
        <a
          className="button ghost small"
          href={`/api/applications/${application._id}/resume`}
          target="_blank"
          rel="noreferrer"
        >
          <AppIcon name="link" />
          <span>Resume</span>
        </a>
        <button type="button" className="button small" onClick={handleResend} disabled={!application.recruiterEmail}>
          <AppIcon name="email" />
          <span>Resend</span>
        </button>
        <select value={application.status} onChange={handleStatus} style={{ minWidth: 140, borderRadius: 12, padding: '10px 12px', background: 'rgba(15, 23, 42, 0.9)', color: 'var(--text)', border: '1px solid rgba(148, 163, 184, 0.18)' }}>
          {statuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
