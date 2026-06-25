// Builds the prompt that drafts a brief referral request message.
export function buildReferralPrompt({ role, company }) {
  return `
Write a referral request message for LinkedIn or WhatsApp.

From: Ritesh Kumar, final-year IT student, SIH 2024 national winner.
Role: ${role} at ${company}.
Tone: brief, respectful, not desperate.
Length: under 80 words.
Use ritesh7882@gmail.com as the contact email.

Return only valid JSON:
{
  "message": "referral request message"
}
`.trim();
}
