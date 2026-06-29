import { Router } from 'express';
import { processApplication } from '../services/applicationProcessor.js';

const router = Router();

router.post('/', async (req, res) => {
  try {
    const result = await processApplication({
      ...req.body,
      source: req.body.source || 'manual',
      sendEmail: req.body.sendEmail === true,
      statusWhenEmailSent: 'email_sent',
      statusWhenDrafted: 'drafted'
    });
    res.json({
      id: result.saved?._id,
      score: result.matchScore,
      company: result.company,
      role: result.role,
      changesMade: result.changesMade,
      emailDraft: result.coldEmailDraft,
      referralDraft: result.referralMessage,
      tailoredResumePath: result.tailoredResumePath,
      emailSent: result.emailSent,
      emailError: result.emailError
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
