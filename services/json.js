// Utility functions for extracting JSON objects from AI responses.
export function parseJsonResponse(rawText, label) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error(`${label} response was empty.`);
  }

  const cleaned = rawText
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '');

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error(`${label} response did not contain a JSON object.`);
    }

    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch (error) {
      throw new Error(`${label} response contained invalid JSON: ${error.message}`);
    }
  }
}
