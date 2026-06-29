import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function EmailChart({ data }) {
  return (
    <div className="panel chart-panel">
      <h2>Cold Emails Sent</h2>
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data}>
          <CartesianGrid stroke="#2a2a2a" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: '#a1a1aa' }} tickFormatter={(value) => value.slice(5)} />
          <YAxis allowDecimals={false} tick={{ fill: '#a1a1aa' }} />
          <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a' }} />
          <Bar dataKey="count" fill="#4ade80" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
