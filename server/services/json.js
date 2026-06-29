// Utility functions for extracting JSON objects from AI responses.

// Finds the last point in a truncated response where we were "between elements" of
// the outermost array (i.e. just closed a complete `{...}` array entry, before the
// response got cut off mid-next-element). Used to salvage a partial list — e.g. an HR
// contact list extraction that returned 80 of 100 entries before hitting the model's
// output token limit — instead of throwing the whole result away.
function findLastSafeArrayCut(text) {
  const stack = [];
  let inString = false;
  let escape = false;
  let arrayDepth = -1;
  let lastSafeIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch);
      if (ch === '[' && arrayDepth === -1) arrayDepth = stack.length;
      continue;
    }
    if (ch === '}' || ch === ']') {
      stack.pop();
      if (arrayDepth !== -1 && stack.length === arrayDepth && ch === '}') {
        lastSafeIndex = i + 1;
      }
    }
  }

  return { lastSafeIndex, openStack: stack };
}

function repairTruncatedJson(text) {
  if (!text.includes('[')) return null;

  const { lastSafeIndex, openStack } = findLastSafeArrayCut(text);
  if (lastSafeIndex === -1) return null;

  let candidate = text.slice(0, lastSafeIndex);
  for (let i = openStack.length - 1; i >= 0; i--) {
    candidate += openStack[i] === '{' ? '}' : ']';
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

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
    if (start === -1) {
      throw new Error(`${label} response did not contain a JSON object.`);
    }

    const sliced = end > start ? cleaned.slice(start, end + 1) : cleaned.slice(start);

    try {
      return JSON.parse(sliced);
    } catch (error) {
      const repaired = repairTruncatedJson(sliced);
      if (repaired) {
        console.warn(`${label} response was truncated — recovered a partial result instead of failing.`);
        return repaired;
      }
      throw new Error(`${label} response contained invalid JSON: ${error.message}`);
    }
  }
}
