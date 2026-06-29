import { resendEmail, updateStatus } from '../api.js';
import StatusBadge from './StatusBadge.jsx';

const statuses = ['drafted', 'applied', 'auto_applied', 'email_sent', 'needs_manual', 'notified', 'referral_sent', 'rejected', 'interview'];

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString() : '—';
}

export default function AppRow({ application, onChanged }) {
  async function handleStatus(event) {
    await updateStatus(application._id, event.target.value);
    onChanged();
  }

  async function handleResend() {
    await resendEmail(application._id);
    onChanged();
  }

  return (
    <tr>
      <td>{formatDate(application.appliedAt)}</td>
      <td>{application.company}</td>
      <td>{application.jobTitle}</td>
      <td>{formatDate(application.postedDate)}</td>
      <td>{formatDate(application.applicationDeadline)}</td>
      <td>{application.eligibilityScore}</td>
      <td>
        <div className="status-cell">
          <StatusBadge status={application.status} />
          <select value={application.status} onChange={handleStatus}>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </td>
      <td>{application.emailSent ? 'Yes' : 'No'}</td>
      <td className="row-actions">
        <a className="button ghost" href={`/api/applications/${application._id}/resume`} target="_blank" rel="noreferrer">
          Resume
        </a>
        <button type="button" onClick={handleResend} disabled={!application.recruiterEmail}>
          Resend
        </button>
      </td>
    </tr>
  );
}
