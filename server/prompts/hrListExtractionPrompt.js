// Builds the prompt that extracts a list of HR/recruiter contacts from freeform text
// (whatever came out of an uploaded PDF/DOCX — no fixed column format assumed).
export function buildHrListExtractionPrompt({ rawText }) {
  return `
The text below was extracted from an uploaded document listing HR/recruiter contacts at
different companies. The formatting is freeform — it might be a table, a bullet list, or
just loosely structured lines. Find every distinct person you can and extract their
contact details.

Raw text:
${rawText}

Rules:
- Only include entries that have at least a usable email address — skip anything without
  one, don't invent an email.
- If a field (name, company, role, linkedin) isn't present for an entry, use an empty
  string for it rather than guessing.
- Deduplicate exact repeated entries.

Return only valid JSON, no markdown fences:
{
  "contacts": [
    { "name": "", "company": "", "email": "", "role": "", "linkedin": "" }
  ]
}
`.trim();
}
