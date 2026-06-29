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
  "companyResearchPoint": "one specific point visible in the JD or a cautious generic point if not available",
  "postedDate": null,
  "applicationDeadline": null
}

For "postedDate" and "applicationDeadline": look for phrases like "Posted 3 weeks ago",
"APPLY BY 17 Jul' 26", "Apply before", "Closing date", etc. Resolve relative phrases
("3 weeks ago") to an actual ISO date (YYYY-MM-DD) using today as a reference point if the
JD doesn't state today's date explicitly — make your best estimate. If a field truly
cannot be determined, return null for it rather than guessing a specific date.
`.trim();
}
