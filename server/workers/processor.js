// Pure job-processing logic (no side effects on import) shared by workers/jobWorker.js
// (in-process worker started from server/index.js) and pipeline.js (standalone CLI run).
// Implements the hybrid auto-apply decision from PHASE2_CODEX_PROMPT_v2.md section 7:
//   - always cold-email if a recruiter email was found
//   - separately: auto-fill the form if the source/company is whitelisted,
//     otherwise send Ritesh a notification email with drafts + tailored resume
import { checkEligibility, processApplication, createAiClientFromEnv } from '../services/applicationProcessor.js';
import { autoApply, isWhitelisted } from '../applicators/index.js';
import { sendJobNotification } from '../services/notifier.js';
import { getCandidateProfile } from '../services/profileStore.js';
import { findHrContact } from '../services/hrFinder.js';

export async function processJob(job) {
  const sourceJob = job.data;
  const aiClient = createAiClientFromEnv();
  const minScore = Number(process.env.MIN_ELIGIBILITY_SCORE) || 60;

  const { eligibility, matchScore } = await checkEligibility({ jdText: sourceJob.jdText, aiClient });
  if (matchScore < minScore) {
    return {
      company: sourceJob.company || 'Unknown',
      role: sourceJob.title || 'Unknown',
      score: matchScore,
      status: 'skipped',
      emailSent: false
    };
  }

  // If the JD itself had no recruiter email, make a best-effort attempt to find one via
  // the company's own website or public GitHub org before falling back to a notification.
  let recruiterEmail = sourceJob.recruiterEmail;
  let hrContactSource = null;
  if (!recruiterEmail) {
    try {
      const found = await findHrContact({ company: sourceJob.company });
      if (found?.email) {
        recruiterEmail = found.email;
        hrContactSource = found.source;
      }
    } catch (error) {
      console.warn(`HR lookup failed for ${sourceJob.company}: ${error.message}`);
    }
  }

  const result = await processApplication({
    jdText: sourceJob.jdText,
    recruiterEmail,
    company: sourceJob.company,
    role: sourceJob.title,
    source: sourceJob.source,
    applyUrl: sourceJob.applyUrl,
    sendEmail: Boolean(recruiterEmail),
    statusWhenEmailSent: 'email_sent',
    statusWhenDrafted: 'drafted',
    aiClient
  });

  if (hrContactSource) {
    console.log(`Found recruiter email for ${result.company} via ${hrContactSource}: ${recruiterEmail}`);
  }

  let finalStatus = result.application.status;
  const whitelisted = await isWhitelisted(sourceJob);

  if (whitelisted) {
    try {
      const applyResult = await autoApply(sourceJob, {
        aiClient,
        profile: getCandidateProfile(),
        tailoredResumePath: result.tailoredResumePath
      });
      finalStatus = applyResult.applied ? 'auto_applied' : 'needs_manual';
    } catch (error) {
      console.warn(`Auto-apply failed for ${result.company}/${result.role}: ${error.message}`);
      finalStatus = 'needs_manual';
    }
  } else {
    try {
      await sendJobNotification({
        company: result.company,
        role: result.role,
        location: sourceJob.location,
        source: sourceJob.source,
        eligibilityScore: matchScore,
        eligibilityReason: eligibility.reason,
        applyUrl: sourceJob.applyUrl,
        changesMade: result.changesMade,
        coldEmailSubject: result.coldEmailDraft.subject,
        coldEmailBody: result.coldEmailDraft.body,
        referralMessage: result.referralMessage,
        applicationId: result.saved?._id,
        tailoredResumePath: result.tailoredResumePath
      });
      finalStatus = 'notified';
    } catch (error) {
      console.warn(`Notification email failed for ${result.company}/${result.role}: ${error.message}`);
    }
  }

  if (result.saved && finalStatus !== result.application.status) {
    result.saved.status = finalStatus;
    await result.saved.save();
  }

  return {
    company: result.company,
    role: result.role,
    score: matchScore,
    status: finalStatus,
    emailSent: result.emailSent
  };
}
