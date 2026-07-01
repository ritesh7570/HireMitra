import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList } from 'recharts';

export default function EmailChart({ data }) {
  return (
    <div className="panel chart-panel">
      <div className="panel-header">
        <div>
          <h2>Cold Emails Sent</h2>
          <p className="muted">Last 7 days of outreach volume with daily totals.</p>
        </div>
        <span className="badge badge-green">{data.reduce((sum, item) => sum + item.count, 0)} total</span>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data} margin={{ top: 18, right: 6, left: -10, bottom: 6 }}>
          <defs>
            <linearGradient id="emailGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.88} />
              <stop offset="100%" stopColor="#5eead4" stopOpacity={0.22} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#223248" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 12 }} tickFormatter={(value) => value.slice(5)} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid rgba(148, 163, 184, 0.18)', borderRadius: '14px' }} labelStyle={{ color: '#e2e8f0' }} />
          <Bar dataKey="count" fill="url(#emailGradient)" radius={[10, 10, 0, 0]}>
            <LabelList dataKey="count" position="top" fill="#e2e8f0" fontSize={12} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
