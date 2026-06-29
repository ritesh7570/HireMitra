// Main CLI entry point for the autonomous job application agent.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { AiClient } from './services/aiClient.js';
import { saveApplication, disconnectApplicationStore } from './services/applicationStore.js';
import { sendColdEmail } from './services/emailService.js';
import { getCandidateProfile } from './services/profileStore.js';
import { tailorResume } from './services/resumeTailor.js';
import { buildEligibilityPrompt } from './prompts/eligibilityPrompt.js';
import { buildExtractionPrompt } from './prompts/extractionPrompt.js';
import { buildColdEmailPrompt } from './prompts/coldEmailPrompt.js';
import { buildReferralPrompt } from './prompts/referralPrompt.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(rootDir, 'output');

async function readMultilineInput(rl) {
  console.log('Paste the job description (press Enter twice when done):');
  const lines = [];
  let previousWasEmpty = false;

  while (true) {
    const line = await rl.question('');
    const isEmpty = line.trim() === '';
    if (isEmpty && previousWasEmpty) {
      break;
    }
    lines.push(line);
    previousWasEmpty = isEmpty;
  }

  return lines.join('\n').trim();
}

function normalizeString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function formatEmailDraft(emailDraft) {
  return `Subject: ${emailDraft.subject}\n\n${emailDraft.body}`;
}

async function main() {
  const rl = readline.createInterface({ input, output });

  try {
    const jdText = await readMultilineInput(rl);
    if (!jdText) {
      console.error('No job description was provided. Please run the agent again with a JD.');
      return;
    }

    const aiClient = new AiClient({
      provider: process.env.AI_PROVIDER,
      geminiApiKey: process.env.GEMINI_API_KEY,
      geminiModel: process.env.GEMINI_MODEL
    });

    console.log('\nChecking eligibility...');
    const eligibility = await aiClient.generateJson(
      buildEligibilityPrompt({ profile: getCandidateProfile(), jdText }),
      'Eligibility'
    );

    const matchScore = Number(eligibility.matchScore) || 0;
    console.log(`Eligibility: ${eligibility.eligible ? 'Yes' : 'No'} (${matchScore}/100)`);
    console.log(`Reason: ${eligibility.reason || 'No reason returned.'}`);
    if (Array.isArray(eligibility.missingSkills) && eligibility.missingSkills.length > 0) {
      console.log(`Missing skills: ${eligibility.missingSkills.join(', ')}`);
    }

    if (matchScore < 40) {
      const continueAnswer = await rl.question('\nMatch score is below 40. Continue anyway? (y/n): ');
      if (continueAnswer.trim().toLowerCase() !== 'y') {
        console.log('Stopped before tailoring or outreach.');
        return;
      }
    }

    console.log('\nTailoring resume (LaTeX -> PDF)...');
    const resumeResult = await tailorResume({
      jdText,
      profile: getCandidateProfile(),
      aiClient,
      outputDir
    });
    const tailoredResumePath = resumeResult.pdfPath || resumeResult.texPath;
    if (resumeResult.compileError) {
      console.warn(`PDF compile failed, kept .tex source instead: ${resumeResult.compileError}`);
    }

    const changesMade = Array.isArray(resumeResult.changesMade) ? resumeResult.changesMade : [];
    console.log('\nChanges made:');
    changesMade.forEach((change, index) => console.log(`${index + 1}. ${change}`));
    console.log(`\nSaved tailored resume: ${tailoredResumePath}`);

    console.log('\nExtracting job details...');
    const details = await aiClient.generateJson(buildExtractionPrompt({ jdText }), 'Job detail extraction');
    const company = normalizeString(details.company, 'Unknown');
    const role = normalizeString(details.role, 'Unknown');
    const contactEmail = normalizeString(details.contactEmail, '');
    const companyResearchPoint = normalizeString(
      details.companyResearchPoint,
      'the role aligns closely with backend product work'
    );

    console.log(`Role: ${role}`);
    console.log(`Company: ${company}`);
    if (contactEmail) {
      console.log(`Contact email: ${contactEmail}`);
    }

    console.log('\nDrafting cold email...');
    const coldEmailDraft = await aiClient.generateJson(
      buildColdEmailPrompt({ role, company, companyResearchPoint }),
      'Cold email'
    );
    const coldEmailText = formatEmailDraft(coldEmailDraft);
    console.log(`\n${coldEmailText}`);

    let emailSent = false;
    const sendAnswer = await rl.question('\nSend this email? (y/n): ');
    if (sendAnswer.trim().toLowerCase() === 'y') {
      try {
        await sendColdEmail({
          to: contactEmail,
          subject: coldEmailDraft.subject,
          body: coldEmailDraft.body,
          gmailUser: process.env.GMAIL_USER,
          gmailAppPassword: process.env.GMAIL_APP_PASSWORD
        });
        emailSent = true;
        console.log('Email sent successfully.');
      } catch (error) {
        console.error(`Email was not sent: ${error.message}`);
      }
    }

    console.log('\nDrafting referral message...');
    const referralDraft = await aiClient.generateJson(
      buildReferralPrompt({ role, company }),
      'Referral message'
    );
    const referralMessage = normalizeString(referralDraft.message, '');
    console.log(`\n${referralMessage}`);

    const application = {
      jobTitle: role,
      company,
      jdText,
      eligibilityScore: matchScore,
      missingSkills: Array.isArray(eligibility.missingSkills) ? eligibility.missingSkills : [],
      changesMade,
      coldEmailDraft: coldEmailText,
      referralMessageDraft: referralMessage,
      tailoredResumePath,
      emailSent,
      appliedAt: new Date(),
      status: emailSent ? 'applied' : 'drafted'
    };

    console.log('\nLogging application to MongoDB...');
    try {
      const saved = await saveApplication({
        mongoUri: process.env.MONGO_URI,
        mongoDbName: process.env.MONGO_DB_NAME,
        application
      });
      console.log(`Application logged with id: ${saved._id}`);
    } catch (error) {
      console.error(`Application was not logged to MongoDB: ${error.message}`);
    }
  } catch (error) {
    console.error(`Agent failed: ${error.message}`);
  } finally {
    rl.close();
    await disconnectApplicationStore();
  }
}

await main();
