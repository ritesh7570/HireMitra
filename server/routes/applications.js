import { Router } from 'express';
import fs from 'node:fs/promises';
import { getApplicationModel } from '../services/applicationStore.js';
import { sendColdEmail } from '../services/emailService.js';

const router = Router();

async function model() {
  return getApplicationModel({
    mongoUri: process.env.MONGO_URI,
    mongoDbName: process.env.MONGO_DB_NAME
  });
}

router.get('/', async (req, res) => {
  try {
    const Application = await model();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const [items, total] = await Promise.all([
      Application.find()
        .sort({ appliedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Application.countDocuments()
    ]);
    res.json({ page, limit, total, items });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const Application = await model();
    const application = await Application.findById(req.params.id).lean();
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    res.json(application);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/resume', async (req, res) => {
  try {
    const Application = await model();
    const application = await Application.findById(req.params.id).lean();
    if (!application?.tailoredResumePath) {
      return res.status(404).json({ error: 'Resume not found.' });
    }
    const resume = await fs.readFile(application.tailoredResumePath);
    res.type(application.tailoredResumePath.endsWith('.pdf') ? 'application/pdf' : 'text/plain');
    res.send(resume);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/send-email', async (req, res) => {
  try {
    const Application = await model();
    const application = await Application.findById(req.params.id);
    if (!application) return res.status(404).json({ error: 'Application not found.' });

    await sendColdEmail({
      to: application.recruiterEmail,
      subject: application.coldEmailSubject,
      body: application.coldEmailBody,
      gmailUser: process.env.GMAIL_USER,
      gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
      attachments: application.tailoredResumePath
        ? [{ filename: 'Ritesh_Kumar_Resume.pdf', path: application.tailoredResumePath }]
        : []
    });

    application.emailSent = true;
    application.emailSentAt = new Date();
    application.status = 'email_sent';
    await application.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const allowed = [
      'drafted',
      'applied',
      'auto_applied',
      'email_sent',
      'needs_manual',
      'notified',
      'referral_sent',
      'rejected',
      'interview'
    ];
    if (!allowed.includes(req.body.status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    const Application = await model();
    const application = await Application.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    ).lean();
    if (!application) return res.status(404).json({ error: 'Application not found.' });
    res.json(application);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
