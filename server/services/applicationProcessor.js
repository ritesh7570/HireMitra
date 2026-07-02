// Shared non-interactive processing flow for auto mode, dashboard apply, and pipeline jobs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiClient } from './aiClient.js';
import { sendColdEmail } from './emailService.js';
import { saveApplication } from './applicationStore.js';
import { tailorResume } from './resumeTailor.js';
import { getCandidateProfile } from './profileStore.js';
import { buildEligibilityPrompt } from '../prompts/eligibilityPrompt.js';
import { buildExtractionPrompt } from '../prompts/extractionPrompt.js';
import { buildColdEmailPrompt } from '../prompts/coldEmailPrompt.js';
import { buildReferralPrompt } from '../prompts/referralPrompt.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(serverDir, 'output');

export function normalizeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

export function formatEmailDraft(emailDraft) {
  return `Subject: ${emailDraft.subject || ''}\n\n${emailDraft.body || ''}`.trim();
}

export function parseDateOrNull(value) {
  if (!value || typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createAiClientFromEnv() {
  return new AiClient({
    provider: process.env.AI_PROVIDER,
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    openrouterModel: process.env.OPENROUTER_MODEL,
    groqApiKey: process.env.GROQ_API_KEY
  });
}

export async function checkEligibility({ jd, jdText, aiClient = createAiClientFromEnv() }) {
  const fullJdText = normalizeString(jdText || jd);
  if (!fullJdText) {
    throw new Error('Job description is required.');
  }

  const eligibility = await aiClient.generateJson(
    buildEligibilityPrompt({ profile: getCandidateProfile(), jdText: fullJdText }),
    'Eligibility'
  );

  return {
    eligibility,
    matchScore: Number(eligibility.matchScore) || 0
  };
}

export async function processApplication({
  jd,
  jdText,
  recruiterEmail,
  recruiterName,
  company,
  role,
  source = 'manual',
  applyUrl = '',
  sendEmail = false,
  statusWhenEmailSent = 'applied',
  statusWhenDrafted = 'drafted',
  saveToMongo = true,
  aiClient = createAiClientFromEnv()
}) {
  const fullJdText = normalizeString(jdText || jd);
  if (!fullJdText) {
    throw new Error('Job description is required.');
  }

  const { eligibility, matchScore } = await checkEligibility({ jdText: fullJdText, aiClient });

  const resumeResult = await tailorResume({
    jdText: fullJdText,
    profile: getCandidateProfile(),
    aiClient,
    outputDir
  });
  const tailoredResumePath = resumeResult.pdfPath || resumeResult.texPath;

  const extracted = await aiClient.generateJson(
    buildExtractionPrompt({ jdText: fullJdText }),
    'Job detail extraction'
  );

  const resolvedCompany = normalizeString(company, normalizeString(extracted.company, 'Unknown'));
  const resolvedRole = normalizeString(role, normalizeString(extracted.role, 'Unknown'));
  const resolvedRecruiterEmail = normalizeString(
    recruiterEmail,
    normalizeString(extracted.contactEmail, '')
  );
  const companyResearchPoint = normalizeString(
    extracted.companyResearchPoint,
    'the role aligns closely with backend product work'
  );

  const coldEmailDraft = await aiClient.generateJson(
    buildColdEmailPrompt({
      role: resolvedRole,
      company: resolvedCompany,
      companyResearchPoint
    }),
    'Cold email'
  );
  const coldEmailSubject = normalizeString(coldEmailDraft.subject);
  const coldEmailBody = normalizeString(coldEmailDraft.body);
  const coldEmailText = formatEmailDraft({ subject: coldEmailSubject, body: coldEmailBody });

  let emailSent = false;
  let emailError = '';
  if (sendEmail && resolvedRecruiterEmail) {
    try {
      await sendColdEmail({
        to: resolvedRecruiterEmail,
        subject: coldEmailSubject,
        body: coldEmailBody,
        gmailUser: process.env.GMAIL_USER,
        gmailAppPassword: process.env.GMAIL_APP_PASSWORD
      });
      emailSent = true;
    } catch (error) {
      emailError = error.message;
    }
  }

  const referralDraft = await aiClient.generateJson(
    buildReferralPrompt({ role: resolvedRole, company: resolvedCompany }),
    'Referral message'
  );
  const referralMessage = normalizeString(referralDraft.message);
  const changesMade = Array.isArray(resumeResult.changesMade) ? resumeResult.changesMade : [];

  const application = {
    jobTitle: resolvedRole,
    company: resolvedCompany,
    jdText: fullJdText,
    recruiterEmail: resolvedRecruiterEmail,
    recruiterName: normalizeString(recruiterName, normalizeString(extracted.hiringManager, '')),
    source,
    applyUrl,
    eligibilityScore: matchScore,
    missingSkills: Array.isArray(eligibility.missingSkills) ? eligibility.missingSkills : [],
    changesMade,
    coldEmailDraft: coldEmailText,
    coldEmailSubject,
    coldEmailBody,
    referralMessageDraft: referralMessage,
    tailoredResumePath,
    emailSent,
    emailSentAt: emailSent ? new Date() : null,
    postedDate: parseDateOrNull(extracted.postedDate),
    applicationDeadline: parseDateOrNull(extracted.applicationDeadline),
    appliedAt: new Date(),
    status: emailSent ? statusWhenEmailSent : statusWhenDrafted
  };

  let saved = null;
  if (saveToMongo) {
    saved = await saveApplication({
      mongoUri: process.env.MONGO_URI,
      mongoDbName: process.env.MONGO_DB_NAME,
      application
    });
  }

  return {
    eligibility,
    matchScore,
    extracted,
    company: resolvedCompany,
    role: resolvedRole,
    recruiterEmail: resolvedRecruiterEmail,
    coldEmailDraft: {
      subject: coldEmailSubject,
      body: coldEmailBody,
      text: coldEmailText
    },
    referralMessage,
    changesMade,
    tailoredResumePath,
    emailSent,
    emailError,
    application,
    saved
  };
}
