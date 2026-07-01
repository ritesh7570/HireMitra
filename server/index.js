import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import statsRouter from './routes/stats.js';
import applicationsRouter from './routes/applications.js';
import jobsRouter from './routes/jobs.js';
import applyRouter from './routes/apply.js';
import scrapeRouter from './routes/scrape.js';
import resetRouter from './routes/reset.js';
import profileRouter from './routes/profile.js';
import hrContactsRouter from './routes/hrContacts.js';
import credentialsRouter from './routes/credentials.js';
import companiesRouter from './routes/companies.js';
import { runDailyHrBatch } from './services/hrBatchSender.js';

const app = express();
const port = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.join(__dirname, '..', 'client', 'dist');

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '5mb' }));

// Logs every API request/response for debugging — method, path, status, timing.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api')) return next();
  const start = Date.now();
  console.log(`-> ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    console.log(`<- ${req.method} ${req.originalUrl} ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

app.use('/api/stats', statsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/apply', applyRouter);
app.use('/api/scrape', scrapeRouter);
app.use('/api/reset', resetRouter);
app.use('/api/profile', profileRouter);
app.use('/api/hr-contacts', hrContactsRouter);
app.use('/api/credentials', credentialsRouter);
app.use('/api/companies', companiesRouter);

app.use(express.static(clientBuild));
app.get('/*splat', (req, res) => {
  res.sendFile(path.join(clientBuild, 'index.html'));
});

app.listen(port, () => {
  console.log(`OK Server on http://localhost:${port}`);
});

// Best-effort: starts a BullMQ worker in-process if Redis is reachable. Logs a warning
// and leaves the rest of the server running if it isn't.
import('./workers/jobWorker.js').catch((error) => {
  console.warn(`Job worker module failed to load: ${error.message}`);
});

// Daily HR-contact-list batch send: runs once on startup, then checked hourly so a
// long-running server still picks up the new calendar day without needing a restart.
// runDailyHrBatch() itself no-ops if it already ran today (see hrBatchSender.js).
runDailyHrBatch().catch((error) => console.warn(`HR batch failed: ${error.message}`));
setInterval(() => {
  runDailyHrBatch().catch((error) => console.warn(`HR batch failed: ${error.message}`));
}, 60 * 60 * 1000);
