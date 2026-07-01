import { Pie, PieChart, ResponsiveContainer, Tooltip, Cell } from 'recharts';

const STATUS_COLORS = {
  applied: '#60a5fa',
  success: '#22c55e',
  failed: '#f87171',
  pending: '#facc15',
  rejected: '#f472b6',
  unknown: '#94a3b8'
};

const STATUS_LABELS = {
  applied: 'Applied',
  success: 'Success',
  failed: 'Failed',
  pending: 'Pending',
  rejected: 'Rejected',
  unknown: 'Unknown'
};

function buildStatusData(recent) {
  const totals = recent.reduce((acc, item) => {
    const status = item.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(totals).map(([status, count]) => ({
    status,
    label: STATUS_LABELS[status] || status,
    count,
    color: STATUS_COLORS[status] || STATUS_COLORS.unknown
  }));
}

export default function PerformanceChart({ recent }) {
  const chartData = buildStatusData(recent);
  const total = chartData.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="panel chart-panel performance-chart">
      <div className="panel-header">
        <div>
          <h2>Application Health</h2>
          <p className="muted">Status mix from the most recent applications.</p>
        </div>
        <span className="badge badge-muted">{total} entries</span>
      </div>

      {chartData.length === 0 ? (
        <p className="empty-state">No recent application status data available.</p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Tooltip
                formatter={(value) => [value, 'Applications']}
                contentStyle={{
                  background: '#0f172a',
                  border: '1px solid rgba(148, 163, 184, 0.18)',
                  borderRadius: '14px'
                }}
              />
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="label"
                innerRadius={60}
                outerRadius={96}
                paddingAngle={4}
              >
                {chartData.map((entry) => (
                  <Cell key={entry.status} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>

          <div className="chart-legend">
            {chartData.map((entry) => (
              <div key={entry.status} className="legend-item">
                <span className="legend-color" style={{ background: entry.color }} />
                <span>{entry.label}</span>
                <strong>{entry.count}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
