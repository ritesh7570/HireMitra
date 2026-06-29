// Builds prompts used by the auto-apply applicators (Internshala form-fill, generic
// company-page form-fill). Kept separate from coldEmailPrompt.js because these target
// in-form fields, not a standalone email.
export function buildCoverLetterPrompt({ profile, jdText, role, company }) {
  return `
Write a short cover letter (120-180 words, plain text, no markdown) for this candidate
applying to a role, to be pasted into an application form's cover letter field.

Candidate profile:
${profile}

Role: ${role || 'the role'}
Company: ${company || 'the company'}
Job description:
${jdText}

Rules:
- Be honest. Do not claim skills, tools, or experience the profile does not contain.
- Reference 1-2 specific points from the job description.
- Plain text only, no greeting placeholders like "[Hiring Manager]" — keep it generic
  ("Hello,") since the recipient is unknown.

Return only valid JSON:
{ "coverLetter": "..." }
`.trim();
}

export function buildFormAnswerPrompt({ profile, question }) {
  return `
Answer this job application form question briefly (1-3 sentences, plain text) based only
on the candidate profile below. If the profile has no relevant information, give a short,
honest, generic answer rather than inventing specifics.

Candidate profile:
${profile}

Question: ${question}

Return only valid JSON:
{ "answer": "..." }
`.trim();
}
