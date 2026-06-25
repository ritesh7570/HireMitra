// Builds the prompt that extracts job metadata from the pasted job description.
export function buildExtractionPrompt({ jdText }) {
  return `
Extract job details from this job description:
${jdText}

Return only valid JSON:
{
  "company": "Unknown",
  "role": "Unknown",
  "hiringManager": "",
  "contactEmail": "",
  "companyResearchPoint": "one specific point visible in the JD or a cautious generic point if not available"
}
`.trim();
}
