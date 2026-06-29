import { Router } from 'express';
import multer from 'multer';
import { extractResumeText } from '../services/resumeParser.js';
import { buildHrListExtractionPrompt } from '../prompts/hrListExtractionPrompt.js';
import { createAiClientFromEnv } from '../services/applicationProcessor.js';
import { listHrContacts, saveHrContacts, setHrContactSent } from '../services/hrContactStore.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const MAX_RAW_TEXT_CHARS = 20000;

router.get('/', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    res.json(await listHrContacts({ page, limit }));
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
    const aiClient = createAiClientFromEnv();
    const { contacts } = await aiClient.generateJson(
      buildHrListExtractionPrompt({ rawText: rawText.slice(0, MAX_RAW_TEXT_CHARS) }),
      'HR list extraction'
    );

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts with an email address were found in the file.' });
    }

    const result = await saveHrContacts(contacts, req.file.originalname);
    res.json({ ...result, found: contacts.length, truncated });
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
