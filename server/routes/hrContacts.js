import { Router } from 'express';
import multer from 'multer';
import { extractResumeText } from '../services/resumeParser.js';
import { buildHrListExtractionPrompt } from '../prompts/hrListExtractionPrompt.js';
import { createAiClientFromEnv } from '../services/applicationProcessor.js';
import { listHrContacts, saveHrContacts, setHrContactSent, getHrContactStats } from '../services/hrContactStore.js';
import { runDailyHrBatch, getBatchState } from '../services/hrBatchSender.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MAX_RAW_TEXT_CHARS = 60000;
const CHUNK_SIZE_CHARS = 4000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Splits on line boundaries (never mid-line) so one contact's details don't get split
// across two chunks. A single giant AI call for a 100+ entry list was unreliable —
// large prompts + large structured output hit truncation, timeouts, and rate limits
// even with fallback models. Many small calls are far more likely to each succeed.
function chunkText(text, maxChars) {
  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  return chunks;
}

router.get('/', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const search = typeof req.query.search === 'string' ? req.query.search : '';
    const [list, stats] = await Promise.all([
      listHrContacts({ page, limit, search }),
      getHrContactStats()
    ]);
    res.json({ ...list, ...stats });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded (field name must be "file").' });
    }

    const rawText = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!rawText) {
      return res.status(400).json({ error: 'Could not extract any text from the uploaded file.' });
    }

    const truncated = rawText.length > MAX_RAW_TEXT_CHARS;
    const chunks = chunkText(rawText.slice(0, MAX_RAW_TEXT_CHARS), CHUNK_SIZE_CHARS);
    const aiClient = createAiClientFromEnv();

    const allContacts = [];
    const chunkErrors = [];
    for (const [index, chunk] of chunks.entries()) {
      try {
        const { contacts } = await aiClient.generateJson(
          buildHrListExtractionPrompt({ rawText: chunk }),
          `HR list extraction (chunk ${index + 1}/${chunks.length})`
        );
        if (Array.isArray(contacts)) allContacts.push(...contacts);
      } catch (error) {
        chunkErrors.push(`chunk ${index + 1}/${chunks.length}: ${error.message}`);
        console.warn(`HR list chunk ${index + 1}/${chunks.length} failed, skipping: ${error.message}`);
      }
      if (index < chunks.length - 1) await delay(1500);
    }

    if (allContacts.length === 0) {
      return res.status(400).json({
        error: 'No contacts with an email address were found in the file.',
        chunkErrors: chunkErrors.length ? chunkErrors : undefined
      });
    }

    const result = await saveHrContacts(allContacts, req.file.originalname);
    res.json({
      ...result,
      found: allContacts.length,
      truncated,
      chunks: chunks.length,
      chunkFailures: chunkErrors.length
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const [stats, state] = await Promise.all([getHrContactStats(), getBatchState()]);
    res.json({ ...stats, lastRunDate: state.lastRunDate || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Manual/on-demand batch — separate from the automatic daily run on server start.
// Bypasses the "already ran today" lock (force: true) so a small test send can happen
// even if today's automatic batch already ran or hasn't yet; tomorrow's automatic run
// is unaffected.
router.post('/send-batch', async (req, res) => {
  try {
    const count = Math.min(Math.max(Number(req.body.count) || 5, 1), 100);
    const result = await runDailyHrBatch({ batchSize: count, force: true });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updated = await setHrContactSent(req.params.id, req.body.emailSent !== false);
    if (!updated) return res.status(404).json({ error: 'Contact not found.' });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
