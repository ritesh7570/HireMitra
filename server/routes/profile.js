import { Router } from 'express';
import multer from 'multer';
import { extractResumeText } from '../services/resumeParser.js';
import { buildProfileExtractionPrompt } from '../prompts/profileExtractionPrompt.js';
import { getProfileMeta, updateCandidateProfile } from '../services/profileStore.js';
import { createAiClientFromEnv } from '../services/applicationProcessor.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', (req, res) => {
  res.json(getProfileMeta());
});

router.post('/resume', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No resume file uploaded (field name must be "resume").' });
    }

    const resumeText = await extractResumeText(req.file.buffer, req.file.mimetype, req.file.originalname);
    if (!resumeText) {
      return res.status(400).json({ error: 'Could not extract any text from the uploaded resume.' });
    }

    const { profileText: existingProfileText } = getProfileMeta();
    const aiClient = createAiClientFromEnv();
    const extracted = await aiClient.generateJson(
      buildProfileExtractionPrompt({ existingProfileText, resumeText }),
      'Profile extraction'
    );

    const updated = await updateCandidateProfile({
      profileText: extracted.profileText,
      contact: extracted.contact
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
