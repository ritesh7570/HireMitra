// Sends Ritesh a "couldn't auto-apply" notification email for jobs that aren't on the
// apply whitelist and have no recruiter email to cold-email instead. Dark-mode-friendly
// HTML with the tailored resume attached and ready-to-copy cold email / referral drafts.
import { sendHtmlEmail } from './emailService.js';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildSubject({ role, company, eligibilityScore }) {
  return `New job match: ${role || 'Role'} at ${company || 'Company'} — score ${eligibilityScore ?? '?'}/100`;
}

function buildHtml({
  company,
  role,
  location,
  source,
  eligibilityScore,
  eligibilityReason,
  applyUrl,
  changesMade = [],
  coldEmailSubject,
  coldEmailBody,
  referralMessage,
  applicationId,
  dashboardUrl
}) {
  const changesList = changesMade.length
    ? changesMade.map((change) => `<li>${escapeHtml(change)}</li>`).join('')
    : '<li>No changes recorded.</li>';

  const markAppliedUrl = applicationId
    ? `${dashboardUrl}/applications?highlight=${encodeURIComponent(applicationId)}`
    : dashboardUrl;

  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0f0f;color:#e5e5e5;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px;">
    <h2 style="color:#4ade80;margin:0 0 4px;">NEW JOB MATCH</h2>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr><td style="color:#9ca3af;padding:4px 0;">Company</td><td style="padding:4px 0;">${escapeHtml(company)}</td></tr>
      <tr><td style="color:#9ca3af;padding:4px 0;">Role</td><td style="padding:4px 0;">${escapeHtml(role)}</td></tr>
      <tr><td style="color:#9ca3af;padding:4px 0;">Location</td><td style="padding:4px 0;">${escapeHtml(location || 'Not specified')}</td></tr>
      <tr><td style="color:#9ca3af;padding:4px 0;">Source</td><td style="padding:4px 0;">${escapeHtml(source)}</td></tr>
      <tr><td style="color:#9ca3af;padding:4px 0;">Eligibility score</td><td style="padding:4px 0;color:#4ade80;font-weight:bold;">${escapeHtml(eligibilityScore)}/100</td></tr>
    </table>

    <h3 style="color:#e5e5e5;margin:20px 0 4px;">Why it matched</h3>
    <p style="color:#d1d5db;font-size:14px;line-height:1.5;">${escapeHtml(eligibilityReason || 'No reason recorded.')}</p>

    ${
      applyUrl
        ? `<a href="${escapeHtml(applyUrl)}" style="display:inline-block;margin:12px 0;padding:12px 20px;background:#4ade80;color:#0f0f0f;text-decoration:none;border-radius:6px;font-weight:bold;">Apply now</a>`
        : ''
    }

    <p style="color:#d1d5db;font-size:14px;">I tailored your resume — see the attached PDF.</p>
    <h3 style="color:#e5e5e5;margin:20px 0 4px;">Key changes (study these before the interview)</h3>
    <ul style="color:#d1d5db;font-size:14px;line-height:1.5;">${changesList}</ul>

    <h3 style="color:#e5e5e5;margin:20px 0 4px;">Cold email draft (copy/paste)</h3>
    <pre style="background:#1a1a1a;color:#e5e5e5;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:13px;">Subject: ${escapeHtml(coldEmailSubject)}

${escapeHtml(coldEmailBody)}</pre>

    <h3 style="color:#e5e5e5;margin:20px 0 4px;">Referral message draft (copy/paste)</h3>
    <pre style="background:#1a1a1a;color:#e5e5e5;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:13px;">${escapeHtml(referralMessage)}</pre>

    <a href="${escapeHtml(markAppliedUrl)}" style="display:inline-block;margin:20px 0 0;padding:12px 20px;background:#1a1a1a;color:#4ade80;border:1px solid #4ade80;text-decoration:none;border-radius:6px;font-weight:bold;">Mark as applied &rarr;</a>
  </div>
</body>
</html>
`.trim();
}

export async function sendJobNotification({
  company,
  role,
  location,
  source,
  eligibilityScore,
  eligibilityReason,
  applyUrl,
  changesMade,
  coldEmailSubject,
  coldEmailBody,
  referralMessage,
  applicationId,
  tailoredResumePath,
  gmailUser = process.env.GMAIL_USER,
  gmailAppPassword = process.env.GMAIL_APP_PASSWORD,
  notificationEmail = process.env.NOTIFICATION_EMAIL || process.env.GMAIL_USER,
  dashboardUrl = process.env.DASHBOARD_URL || 'http://localhost:5173'
}) {
  const subject = buildSubject({ role, company, eligibilityScore });
  const html = buildHtml({
    company,
    role,
    location,
    source,
    eligibilityScore,
    eligibilityReason,
    applyUrl,
    changesMade,
    coldEmailSubject,
    coldEmailBody,
    referralMessage,
    applicationId,
    dashboardUrl
  });

  await sendHtmlEmail({
    to: notificationEmail,
    subject,
    html,
    gmailUser,
    gmailAppPassword,
    attachments: tailoredResumePath
      ? [{ filename: 'Ritesh_Kumar_Resume.pdf', path: tailoredResumePath }]
      : []
  });
}
