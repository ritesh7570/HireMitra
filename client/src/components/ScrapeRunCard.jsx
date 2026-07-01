import StatusBadge from './StatusBadge.jsx';

export default function ScrapeRunCard({ source, data }) {
  const status = data?.status || 'waiting';
  const pct = status === 'success' ? 100 : status === 'running' ? 50 : 0;
  const barClass = status === 'failed' ? 'badge-red' : status === 'success' ? 'badge-green' : 'badge-blue';

  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <strong style={{ textTransform: 'capitalize' }}>{source}</strong>
        <StatusBadge status={status} />
      </div>
      <div style={{ background: '#111', borderRadius: '999px', height: '6px', overflow: 'hidden', marginBottom: '8px' }}>
        <div
          className={barClass}
          style={{
            width: `${pct}%`,
            height: '100%',
            background: status === 'failed' ? '#ef4444' : status === 'success' ? '#4ade80' : '#60a5fa',
            transition: 'width 0.3s ease'
          }}
        />
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {status === 'waiting' && 'Not started yet'}
        {status === 'running' && 'In progress...'}
        {status === 'success' && `${data.jobsFound} job(s) found in ${(data.durationMs / 1000).toFixed(1)}s`}
        {status === 'failed' && `Error: ${data.error}`}
        {status === 'skipped' && (data.error || 'Skipped')}
      </p>
    </div>
  );
}
