// Builds the resume-tailoring prompt sent to the AI provider.
// Output is consumed by services/resumeTailor.js to fill server/templates/resume.tex,
// so every section value must already be valid, escaped LaTeX content.
export function buildResumePrompt({ profile, jdText }) {
  return `
You are tailoring a candidate's resume for a specific job description. The output will be
inserted directly into a LaTeX document, so every string value below MUST be valid LaTeX
content, not plain text or Markdown.

Candidate profile (ground truth — do not invent anything beyond this):
${profile}

Job description:
${jdText}

Rules:
- Be honest. Never add skills, tools, metrics, or experience the profile does not contain.
- Reorder and reword existing content to emphasize keywords and phrasing from the job
  description, but do not fabricate new facts.
- Escape LaTeX special characters in every value: & % $ # _ { } ~ ^ and backslash.
  Example: "C++ & Node.js_API" must become "C++ \\& Node.js\\_API".
- Use "\\\\" for line breaks inside a block of text, and "\\begin{itemize}...\\end{itemize}"
  with "\\item" entries for bullet lists (skills, experience bullets, project bullets,
  achievements). Do not leave raw newlines as the only separator.
- "skills" should be a short LaTeX itemize list grouped by category (e.g. Languages,
  Backend, Tools).
- "experience" and "projects" should each be a LaTeX itemize list, one \\item per role or
  project, bold the role/project name with \\textbf{...} followed by a short description.
- "education" is a single short LaTeX block (degree, institute, graduation, CGPA).
- "achievements" is a LaTeX itemize list.
- "summary" is 2-3 plain sentences (still LaTeX-escaped) tailored to this job.
- "changesMade" is a plain-English (not LaTeX) bullet list summarizing what you changed
  and why, for the candidate to study before an interview.

Return only valid JSON, no markdown fences, matching exactly this shape:
{
  "summary": "...",
  "skills": "...",
  "experience": "...",
  "projects": "...",
  "education": "...",
  "achievements": "...",
  "changesMade": ["change 1", "change 2"]
}
`.trim();
}
