import { Router } from 'express';
import { getApplicationModel } from '../services/applicationStore.js';

const router = Router();

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfLastSevenDays() {
  const date = startOfToday();
  date.setDate(date.getDate() - 6);
  return date;
}

router.get('/', async (req, res) => {
  try {
    const Application = await getApplicationModel({
      mongoUri: process.env.MONGO_URI,
      mongoDbName: process.env.MONGO_DB_NAME
    });
    const today = startOfToday();
    const sevenDaysAgo = startOfLastSevenDays();

    const [total, todayCount, weekCount, avgScore, recent, chartRows] = await Promise.all([
      Application.countDocuments(),
      Application.countDocuments({ emailSent: true, emailSentAt: { $gte: today } }),
      Application.countDocuments({ emailSent: true, emailSentAt: { $gte: sevenDaysAgo } }),
      Application.aggregate([{ $group: { _id: null, avgScore: { $avg: '$eligibilityScore' } } }]),
      Application.find()
        .sort({ appliedAt: -1 })
        .limit(10)
        .select('company jobTitle status emailSent eligibilityScore appliedAt source')
        .lean(),
      Application.aggregate([
        { $match: { emailSent: true, emailSentAt: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$emailSentAt' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = startOfLastSevenDays();
      date.setDate(date.getDate() + index);
      return date.toISOString().slice(0, 10);
    });
    const chartMap = new Map(chartRows.map((row) => [row._id, row.count]));

    res.json({
      total,
      todayCount,
      weekCount,
      avgScore: Math.round((avgScore[0]?.avgScore || 0) * 10) / 10,
      dailyEmailChart: days.map((date) => ({ date, count: chartMap.get(date) || 0 })),
      recent
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
