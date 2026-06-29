// Builds the prompt used to fold a freshly uploaded resume into the candidate profile
// that every other prompt (eligibility, resume tailoring, cover letters) reads from.
export function buildProfileExtractionPrompt({ existingProfileText, resumeText }) {
  return `
A candidate has uploaded an updated resume. Merge it into their existing structured
profile, which is used as ground truth by other AI prompts (eligibility checks, resume
tailoring, cover letters). Keep the same compact "Label: value" style as the existing
profile so it stays easy to parse and short enough to reuse in every prompt.

Existing profile:
${existingProfileText}

Newly uploaded resume (raw extracted text):
${resumeText}

Rules:
- Treat the uploaded resume as the latest, most accurate source for skills, experience,
  projects, education, and achievements — update or replace fields the resume contradicts
  or extends.
- Keep fields the resume doesn't mention (e.g. "Job target", "Not targeting", "Honest
  skill note") unchanged unless the resume clearly implies an update.
- Never invent skills, tools, or experience not present in either the existing profile or
  the new resume.
- Keep the output the same general shape/length as the existing profile (short label-value
  lines and short bullet lists) — do not paste the entire raw resume verbatim.
- Extract contact fields if present in the resume (email, LinkedIn, GitHub, portfolio
  URL); otherwise keep the existing ones.

Return only valid JSON:
{
  "profileText": "the full updated profile, same style as the existing profile",
  "contact": {
    "email": "...",
    "linkedinUrl": "...",
    "githubUrl": "...",
    "portfolioUrl": "..."
  }
}
`.trim();
}
