const COLORS = {
  drafted: 'badge-muted',
  applied: 'badge-blue',
  auto_applied: 'badge-green',
  email_sent: 'badge-green',
  needs_manual: 'badge-amber',
  notified: 'badge-blue',
  referral_sent: 'badge-blue',
  rejected: 'badge-red',
  interview: 'badge-green',
  skipped: 'badge-muted',
  failed: 'badge-red'
};

export default function StatusBadge({ status }) {
  const colorClass = COLORS[status] || 'badge-muted';
  return <span className={`badge ${colorClass}`}>{status?.replaceAll('_', ' ')}</span>;
}
