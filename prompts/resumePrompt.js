// Builds the resume-tailoring prompt sent to the AI provider.
export function buildResumePrompt({ baseResume, jdText }) {
  return `
Tailor this resume for the job description.

Base resume:
${baseResume}

Job description:
${jdText}

Keep it honest. Do not add skills, tools, outcomes, metrics, or experience the candidate does not have.
Return only valid JSON:
{
  "tailoredResume": "complete tailored resume text",
  "changesMade": ["change 1", "change 2"]
}
`.trim();
}
