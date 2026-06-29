// Generates a tailored .tex resume from the LaTeX template, then compiles it to PDF
// using whichever compiler is available: local pdflatex -> local tectonic -> ytotech.com
// hosted compile API. This lets Ritesh get a working PDF before installing any LaTeX
// toolchain locally.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

import { getCandidateContact } from './profileStore.js';
import { buildResumePrompt } from '../prompts/resumePrompt.js';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = path.join(serverDir, 'templates', 'resume.tex');

const PLACEHOLDER_KEYS = [
  'EMAIL',
  'LINKEDIN_URL',
  'GITHUB_URL',
  'PORTFOLIO_URL',
  'SUMMARY',
  'SKILLS',
  'EXPERIENCE',
  'PROJECTS',
  'EDUCATION',
  'ACHIEVEMENTS'
];

function fillTemplate(template, values) {
  let filled = template;
  for (const key of PLACEHOLDER_KEYS) {
    const value = values[key] ?? '';
    filled = filled.split(`<<${key}>>`).join(value);
  }
  return filled;
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${error.message}\n${stderr || stdout || ''}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function compileWithLocalBinary(command, texPath, outputDir) {
  await execFileAsync(
    command,
    ['-interaction=nonstopmode', '-halt-on-error', `-output-directory=${outputDir}`, texPath],
    { cwd: outputDir, timeout: 30000 }
  );
  const pdfPath = texPath.replace(/\.tex$/, '.pdf');
  await fs.access(pdfPath);
  return pdfPath;
}

async function compileViaYtotech(texPath) {
  const texContent = await fs.readFile(texPath, 'utf8');
  const response = await fetch('https://latex.ytotech.com/builds/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      compiler: 'pdflatex',
      resources: [{ main: true, content: texContent }]
    })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`ytotech compile failed (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const pdfPath = texPath.replace(/\.tex$/, '.pdf');
  await fs.writeFile(pdfPath, buffer);
  return pdfPath;
}

export async function compileLatex(texPath, { preferredCompiler = 'auto' } = {}) {
  const outputDir = path.dirname(texPath);
  const attempts =
    preferredCompiler === 'auto'
      ? ['pdflatex', 'tectonic', 'ytotech']
      : [preferredCompiler];

  const errors = [];
  for (const compiler of attempts) {
    try {
      if (compiler === 'pdflatex' || compiler === 'tectonic') {
        const pdfPath = await compileWithLocalBinary(compiler, texPath, outputDir);
        return { pdfPath, compiler };
      }
      if (compiler === 'ytotech') {
        const pdfPath = await compileViaYtotech(texPath);
        return { pdfPath, compiler };
      }
      throw new Error(`Unknown LaTeX compiler "${compiler}".`);
    } catch (error) {
      errors.push(`${compiler}: ${error.message}`);
    }
  }

  throw new Error(`All LaTeX compile attempts failed.\n${errors.join('\n')}`);
}

export async function tailorResume({ jdText, profile, aiClient, outputDir }) {
  const template = await fs.readFile(templatePath, 'utf8');

  const resumeResult = await aiClient.generateJson(
    buildResumePrompt({ profile, jdText }),
    'Resume tailoring'
  );

  const candidateContact = getCandidateContact();
  const filled = fillTemplate(template, {
    EMAIL: candidateContact.email,
    LINKEDIN_URL: candidateContact.linkedinUrl,
    GITHUB_URL: candidateContact.githubUrl,
    PORTFOLIO_URL: candidateContact.portfolioUrl,
    SUMMARY: resumeResult.summary || '',
    SKILLS: resumeResult.skills || '',
    EXPERIENCE: resumeResult.experience || '',
    PROJECTS: resumeResult.projects || '',
    EDUCATION: resumeResult.education || '',
    ACHIEVEMENTS: resumeResult.achievements || ''
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  await fs.mkdir(outputDir, { recursive: true });
  const texPath = path.join(outputDir, `resume_${timestamp}.tex`);
  await fs.writeFile(texPath, filled, 'utf8');

  let pdfPath = null;
  let compileError = '';
  try {
    const compiled = await compileLatex(texPath, {
      preferredCompiler: process.env.LATEX_COMPILER || 'auto'
    });
    pdfPath = compiled.pdfPath;
  } catch (error) {
    compileError = error.message;
  }

  return {
    texPath,
    pdfPath,
    compileError,
    changesMade: Array.isArray(resumeResult.changesMade) ? resumeResult.changesMade : [],
    raw: resumeResult
  };
}
