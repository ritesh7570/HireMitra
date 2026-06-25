// Builds the eligibility-check prompt sent to the AI provider.
export function buildEligibilityPrompt({ profile, jdText }) {
  return `
Given this candidate profile:
${profile}

And this job description:
${jdText}

Is the candidate eligible? Reply only with valid JSON:
{
  "eligible": true,
  "reason": "short explanation",
  "matchScore": 0,
  "missingSkills": []
}

Rules:
- Use matchScore from 0 to 100.
- Set eligible to false when the role is clearly outside the candidate's target areas.
- Do not recommend or invent Docker, Kubernetes, or CI/CD experience.
`.trim();
}
