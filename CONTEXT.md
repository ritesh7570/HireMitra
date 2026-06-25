# Job Application Agent Context

## 1. PROJECT STATUS

Done:
- Created the Phase 1 Node.js CLI project scaffold in `e:\agent`.
- Added `package.json` with Node 18+ ESM configuration and dependencies for Gemini, MongoDB, Nodemailer, BullMQ/Redis, Playwright, and dotenv.
- Installed dependencies, generating `package-lock.json` and `node_modules/`.
- Added `.env.example` with all required keys and no hardcoded secrets.
- Added `agent.js`, the main CLI entry point.
- Added prompt modules in `prompts/` so prompts are editable without touching business logic.
- Added service modules in `services/` for Gemini AI calls, JSON parsing, Gmail email sending, and MongoDB persistence.
- Added `data/base_resume.txt` using the provided profile as the current base resume.
- Added `output/` directory for generated tailored resumes.
- Verified project source syntax with `node --check`.
- Ran `npm audit`; current dependency tree reports 0 vulnerabilities.

In progress:
- Phase 1 CLI implementation is ready for real credential testing.

Pending:
- Add real `.env` values for Gemini, MongoDB, and Gmail sending.
- Run the full CLI against a real JD after installing dependencies.
- Replace `data/base_resume.txt` with Ritesh's final resume text when available.

## 2. FOLDER STRUCTURE

```text
e:\agent
|-- .env.example              # Template for Gemini, MongoDB, Gmail, and Redis environment variables.
|-- CONTEXT.md                # Self-contained handoff snapshot for future sessions.
|-- agent.js                  # Main CLI flow: JD input, eligibility, resume tailoring, outreach drafts, optional email, Mongo logging.
|-- package-lock.json         # Exact installed dependency versions from npm install.
|-- package.json              # Project metadata, scripts, Node version, and dependencies.
|-- data/
|   `-- base_resume.txt       # Base resume content used by the tailoring step.
|-- output/                   # Generated tailored resumes are saved here as resume_[timestamp].txt.
|-- prompts/
|   |-- coldEmailPrompt.js    # Builds the cold email drafting prompt.
|   |-- eligibilityPrompt.js  # Builds the eligibility scoring prompt.
|   |-- extractionPrompt.js   # Builds the job detail extraction prompt.
|   |-- profile.js            # Central Ritesh Kumar candidate profile for AI context.
|   |-- referralPrompt.js     # Builds the referral message prompt.
|   `-- resumePrompt.js       # Builds the resume tailoring prompt.
`-- services/
    |-- aiClient.js           # Gemini AI wrapper with JSON response parsing.
    |-- applicationStore.js   # MongoDB schema and application logging service.
    |-- emailService.js       # Nodemailer Gmail sending service.
    `-- json.js               # Robust helper for parsing JSON from AI responses.
```

`node_modules/` also exists after `npm install`; it is intentionally omitted from the tree above because it contains third-party package files.

## 3. KEY DECISIONS

- Used ESM (`"type": "module"`) because modern Node.js projects and the Gemini SDK work cleanly with import/export syntax.
- Used Gemini as the only active AI provider for Phase 1 because the requested default is Gemini free tier. `AI_PROVIDER` exists for future expansion, but non-Gemini providers intentionally throw a clear error for now.
- Kept all prompts in `prompts/*.js` as requested, each exporting prompt-builder functions or candidate profile text.
- Used `readline/promises` for CLI input so the flow remains async/await-based.
- Used Mongoose for MongoDB persistence because it gives a clear schema for the `applications` collection and keeps validation close to the data model.
- Used Nodemailer 8.x with Gmail app passwords because the requested Phase 1 email flow avoids OAuth and npm audit flagged older Nodemailer versions.
- Included BullMQ, Redis, and Playwright dependencies now because they are part of the stated tech stack, but Phase 1 does not use queueing or scraping yet.
- The CLI does not hardcode credentials. Missing `GEMINI_API_KEY`, `MONGO_URI`, or Gmail credentials produce explicit errors or warnings.
- If MongoDB logging fails, the CLI reports the failure instead of silently crashing after generating the resume and drafts.

## 4. PENDING TASKS

1. Create `.env` from `.env.example`.
2. Add `GEMINI_API_KEY` and keep `AI_PROVIDER=gemini`.
3. Add `MONGO_URI` and optionally `MONGO_DB_NAME`.
4. Add `GMAIL_USER` and `GMAIL_APP_PASSWORD` if cold emails should be sent from the CLI.
5. Replace `data/base_resume.txt` with the final resume text or structured resume content.
6. Run `npm start` and paste a real job description, ending input with two blank Enter presses.
7. Test MongoDB logging with a real local MongoDB or Atlas URI.
8. Add OpenRouter/Ollama provider support if Gemini is unavailable or rate-limited.
9. Add BullMQ pipeline and Playwright scraping in later phases.

## 5. KNOWN ISSUES

- Full CLI execution has not been tested yet because no Gemini API key, MongoDB URI, or Gmail app password has been provided.
- `package.json` cannot contain a top-of-file comment because JSON does not allow comments.
- `data/base_resume.txt` is a profile-derived starter resume, not necessarily the final resume Ritesh wants to use.
- Company research is currently extracted from the JD. The agent does not browse the web for company research in Phase 1.
- Email sending requires a recipient email in the JD. If no contact email is extracted, the send step fails with a clear message.
- MongoDB logging is skipped with a warning if `MONGO_URI` is missing.

Verification completed:
- `node --check` passed for `agent.js` and every source file in `prompts/` and `services/`.
- `npm audit --json` reports 0 low, 0 moderate, 0 high, and 0 critical vulnerabilities.

## 6. HOW TO RUN

```bash
npm install
copy .env.example .env
npm start
```

On PowerShell, create `.env` with:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and add the required credentials. When the CLI asks for a job description, paste the JD and press Enter twice on blank lines to finish input.

## 7. ENV VARIABLES NEEDED

- `AI_PROVIDER`: Use `gemini` for Phase 1.
- `GEMINI_API_KEY`: Gemini API key for AI calls.
- `GEMINI_MODEL`: Gemini model name. Default example is `gemini-1.5-flash`.
- `MONGO_URI`: MongoDB connection string for logging applications.
- `MONGO_DB_NAME`: MongoDB database name. Default example is `job_application_agent`.
- `GMAIL_USER`: Gmail address used by Nodemailer for sending approved cold emails.
- `GMAIL_APP_PASSWORD`: Gmail app password for `GMAIL_USER`.
- `REDIS_URL`: Redis connection string for future BullMQ pipeline work.
