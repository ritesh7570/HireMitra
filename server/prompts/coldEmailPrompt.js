// Builds the prompt that drafts a cold application email.
export function buildColdEmailPrompt({ role, company, companyResearchPoint }) {
  return `
Write a cold email from Ritesh Kumar applying for ${role} at ${company}.

Tone: professional but not robotic.
Length: under 150 words.
Include:
- One specific thing about the company that shows research: ${companyResearchPoint}
- His strongest relevant achievement, choosing from SIH 2024 national win, Sarthi, or Connexus
- Clear ask: 15-minute call or application review
- Sign off with: riteshkr0759@gmail.com

Return only valid JSON:
{
  "subject": "email subject",
  "body": "email body"
}
`.trim();
}
