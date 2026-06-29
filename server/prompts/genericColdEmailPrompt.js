// Builds a single reusable cold-email template for the daily HR-list batch send (not
// tied to a specific job posting, since this list is just "people who might be hiring").
export function buildGenericColdEmailPrompt({ profile }) {
  return `
Write a short, professional cold email a candidate can send to an HR/recruiter contact
they don't have a specific job posting for — just a general "are you hiring for roles
that fit my background" outreach.

Candidate profile:
${profile}

Rules:
- Keep it under 150 words.
- Literally include the placeholders {{name}} and {{company}} in the body where the
  recipient's name and company should go (e.g. "Hi {{name}}," and "...openings at
  {{company}}..."). Do not replace them with real values.
- Be honest about skills/experience — only reference what's in the profile.
- Mention the candidate's job target briefly and ask if there are any fitting openings.
- Professional, concise, no excessive flattery.

Return only valid JSON, no markdown fences:
{ "subject": "...", "body": "..." }
`.trim();
}
