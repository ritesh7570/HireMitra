import AppIcon from './AppIcon.jsx';

export default function JobCard({ job, onDelete }) {
  const age = job.scrapedAt ? new Date(job.scrapedAt).toLocaleDateString() : 'Unknown';
  const location = job.location || 'Remote';
  const source = job.source ? job.source.replace(/([a-z])([A-Z])/g, '$1 $2') : 'Unknown';

  return (
    <div className="job-card">
      <div className="card-header">
        <div>
          <strong>{job.title}</strong>
          <div className="card-row">
            <span className="card-badge">
              <AppIcon name="company" className="card-icon" />
              {job.company || 'Unknown company'}
            </span>
            <span className="card-badge">
              <AppIcon name="source" className="card-icon" />
              {source}
            </span>
          </div>
        </div>
        <span className="badge badge-muted">{age}</span>
      </div>

      <div className="card-meta">
        <div className="meta-item">
          <AppIcon name="location" />
          <span>{location}</span>
        </div>
        <div className="meta-item">
          <AppIcon name="email" />
          <span>{job.recruiterEmail || 'No email'}</span>
        </div>
      </div>

      <div className="card-actions">
        <a href={job.applyUrl} target="_blank" rel="noreferrer" className="button ghost small">
          <AppIcon name="link" />
          <span>Open</span>
        </a>
        <button type="button" className="button danger small" onClick={() => onDelete(job.applyUrl)}>
          <AppIcon name="trash" />
          <span>Delete</span>
        </button>
      </div>
    </div>
  );
}
