// Extracts plain text from an uploaded resume file (PDF or DOCX) so it can be fed to
// the profile-extraction prompt. Intentionally narrow — these are the two formats anyone
// is realistically going to export a resume as.
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';

export async function extractResumeText(buffer, mimetype, filename = '') {
  const lowerName = filename.toLowerCase();

  if (mimetype === 'application/pdf' || lowerName.endsWith('.pdf')) {
    const parser = new PDFParse({ data: buffer });
    try {
      const { text } = await parser.getText();
      return text.trim();
    } finally {
      await parser.destroy();
    }
  }

  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value.trim();
  }

  throw new Error('Unsupported resume file type. Upload a PDF or DOCX file.');
}
