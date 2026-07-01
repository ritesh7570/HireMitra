import { useEffect, useState } from 'react';
import { getStats, triggerScrape } from '../api.js';
import EmailChart from '../components/EmailChart.jsx';
import PerformanceChart from '../components/PerformanceChart.jsx';
import StatsCard from '../components/StatsCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import Spinner from '../components/Spinner.jsx';
import TodayPlan from '../components/TodayPlan.jsx';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [message, setMessage] = useState('');

  async function load() {
    setStats(await getStats());
  }

  async function runPipeline() {
    const result = await triggerScrape({});
    setMessage(`Scrape started: ${result.jobId}`);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
    const interval = setInterval(() => load().catch(console.error), 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Dashboard</h1>
          <p>Daily sending, performance overview, and pipeline controls.</p>
        </div>
        <button type="button" onClick={runPipeline}>Run full pipeline now</button>
      </div>
      <p className="notice info">UI improved: refreshed dashboard design, charts, and mobile-friendly data presentation.</p>
      {message && <p className="notice">{message}</p>}

      {!stats ? (
        <Spinner label="Loading dashboard..." />
      ) : (
        <>
          <div className="stats-grid">
            <StatsCard label="Total Applications" value={stats.total} />
            <StatsCard label="Emails Today" value={stats.todayCount} />
            <StatsCard label="Emails This Week" value={stats.weekCount} />
            <StatsCard label="Average Score" value={stats.avgScore} />
          </div>

          <div className="chart-grid">
            <EmailChart data={stats.dailyEmailChart} />
            <PerformanceChart recent={stats.recent} />
          </div>

          <TodayPlan />
          <div className="panel">
            <h2>Recent Activity</h2>
            {stats.recent.length === 0 ? (
              <p className="empty-state">No activity yet.</p>
            ) : (
              <div className="activity-list">
                {stats.recent.map((item) => (
                  <div key={item._id} className="activity-item">
                    <strong>{item.jobTitle}</strong>
                    <span className="status-cell" style={{ flexDirection: 'row', gap: '8px', alignItems: 'center' }}>
                      {item.company} - {item.eligibilityScore}/100 <StatusBadge status={item.status} />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
