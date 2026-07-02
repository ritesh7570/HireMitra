import AppIcon from './AppIcon.jsx';

const PRIORITY_LABELS = { 1: 'Every run', 2: 'Every 12h', 3: 'Weekly' };

function timeAgo(iso) {
  if (!iso) return 'Never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export default function CompanyCard({ company, onEdit, onRemove, onTest, testingId }) {
  return (
    <div className="company-card">
      <div className="card-header">
        <div>
          <strong>{company.name}</strong>
          <div className="card-row">
            <span className="card-badge">
              <AppIcon name="link" className="card-icon" />
              <a href={company.careersUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>
                Careers page
              </a>
            </span>
            <span className="card-badge">
              <AppIcon name="settings" className="card-icon" />
              {PRIORITY_LABELS[company.priority] || company.priority}
            </span>
          </div>
        </div>
        <span className="badge badge-muted">{timeAgo(company.lastScrapedAt)}</span>
      </div>

      <div className="card-meta">
        <div className="meta-item">
          <AppIcon name="source" />
          <span>Selector: {company.selector || 'AI extraction'}</span>
        </div>
        <div className="meta-item">
          <AppIcon name="tag" />
          <span>{(company.tags || []).join(', ') || 'No tags'}</span>
        </div>
      </div>

      <div className="card-actions">
        <button type="button" className="button ghost small" onClick={() => onTest(company)} disabled={testingId === company.id}>
          <AppIcon name="sparkles" />
          <span>{testingId === company.id ? 'Testing…' : 'Test Scrape'}</span>
        </button>
        <button type="button" className="button ghost small" onClick={() => onEdit(company)}>
          <AppIcon name="settings" />
          <span>Edit</span>
        </button>
        <button type="button" className="button danger small" onClick={() => onRemove(company.id)}>
          <AppIcon name="trash" />
          <span>Remove</span>
        </button>
      </div>
    </div>
  );
}
