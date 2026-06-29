# PHASE 2 — JOB APPLICATION AGENT (RESTRUCTURED)
## Master Prompt for Codex / GPT-4o / Gemini / any AI coding assistant

> **How to use this file:**
> 1. Paste everything below the divider into your AI coding assistant.
> 2. Also paste the latest `CONTEXT.md` from your project root after this prompt so the AI has full Phase 1 history.
> 3. Let the AI ask you for `.env` keys it needs (Gemini, MongoDB, Gmail) — do not paste secrets into the chat.

---

You are a senior full-stack engineer continuing work on my autonomous job application agent.
Phase 1 (CLI-only paste-JD flow) is complete and working. Phase 2 is a major restructure:
the project becomes a real full-stack app with a React frontend and one common Express
backend that handles scraping, auto-applying, emailing, and serving the dashboard.

Write real, runnable, production-quality code. After every file you create or modify,
update `CONTEXT.md` so any future AI session can continue without context loss.

If anything below is ambiguous, ASK before coding.

---

## 1. THE VISION (read this first)

I am Ritesh Kumar, final-year B.Tech IT student, actively job hunting. I want one common
local server (will be deployed free later) that:

1. **Scrapes** matching jobs from Naukri, Wellfound, Internshala, LinkedIn (public pages
   only), Indeed, and specific company career pages I provide.
2. **Filters** by AI eligibility check (Gemini free tier).
3. **Tailors** my resume per job — generates a fresh PDF from a LaTeX template (not text).
4. **Hybrid action** for each eligible job:
   - ALWAYS auto-send a cold email to the recruiter if email is found.
   - AUTO-FILL the application form ONLY on whitelisted simple sites (Internshala, basic
     company career pages).
   - For everything else: send me a notification email with the job link, JD, tailored
     resume PDF attached, and cold-email + referral drafts ready to one-click send.
5. **Dashboard** in React (hostable free on Vercel later) showing daily emails sent,
   scraped jobs, applications, manual apply form, and reset.

I do NOT want auth yet — I'll add it later. Build everything assuming single-user.

---

## 2. EXISTING PHASE 1 STATE (DO NOT BREAK)

At `e:\agent` we already have:

```
e:\agent
├── .env                      # Real credentials (DO NOT TOUCH)
├── .env.example
├── .gitignore
├── CONTEXT.md
├── agent.js                  # Old Phase 1 CLI — KEEP WORKING
├── autoApply.js              # Phase 2A — already built (auto from job_queue.json)
├── package.json
├── data/
│   ├── base_resume.txt       # Will be replaced with LaTeX template
│   └── job_queue.json
├── output/                   # Tailored resumes
├── prompts/                  # Profile + AI prompt builders
└── services/                 # aiClient, applicationStore, emailService, json
```

Phase 1 works: `npm start` runs the CLI, `npm run auto` processes `data/job_queue.json`.
**These must continue to work after the restructure.**

There's also a partial dashboard at `dashboard/public/index.html` (plain HTML) that
throws "Request failed" because of CORS — it's served by Live Server on port 5500
while the API is on a different port. **Delete the entire `dashboard/` folder** — we're
replacing it with a proper React app.

---

## 3. PHASE 2 ARCHITECTURE

Restructure into a monorepo with two folders:

```
e:\agent
├── package.json              # Root — npm scripts to run server + client together
├── CONTEXT.md
├── .gitignore
│
├── server/                   # Express backend (was project root in Phase 1)
│   ├── .env
│   ├── .env.example
│   ├── package.json          # Server's own deps
│   ├── index.js              # Express server entry point — THE common server
│   ├── agent.js              # Old CLI — moved here, still works
│   ├── autoApply.js          # Moved here
│   ├── pipeline.js           # NEW — full scrape→filter→apply orchestrator
│   ├── routes/
│   │   ├── stats.js          # GET /api/stats
│   │   ├── applications.js   # CRUD on applications collection
│   │   ├── jobs.js           # Scraped jobs endpoints
│   │   ├── apply.js          # POST /api/apply (manual single-job flow)
│   │   ├── scrape.js         # POST /api/scrape (trigger scraping)
│   │   └── reset.js          # DELETE /api/reset
│   ├── scrapers/
│   │   ├── index.js          # scrapeAll() — runs all enabled scrapers
│   │   ├── naukri.js
│   │   ├── wellfound.js
│   │   ├── internshala.js
│   │   ├── linkedin.js       # PUBLIC PAGES ONLY, no login
│   │   ├── indeed.js
│   │   └── companyPages.js   # Reads data/company_pages.json
│   ├── applicators/          # Auto-apply form-fillers (whitelisted sites only)
│   │   ├── index.js          # Routes job → applicator by source
│   │   ├── internshala.js    # Form-fill logic for Internshala
│   │   └── generic.js        # Heuristic form-fill for simple company pages
│   ├── workers/
│   │   ├── queue.js          # BullMQ queue setup
│   │   └── jobWorker.js      # Processes each scraped job
│   ├── services/
│   │   ├── aiClient.js       # Existing — Gemini wrapper
│   │   ├── applicationStore.js
│   │   ├── emailService.js   # Enhanced — supports attachments + dual sender accounts
│   │   ├── resumeTailor.js   # NEW — LaTeX-based tailored PDF generation
│   │   ├── notifier.js       # NEW — sends "I couldn't apply" notification emails
│   │   └── json.js
│   ├── prompts/              # Existing — Ritesh's profile + AI prompt builders
│   │   ├── profile.js
│   │   ├── eligibilityPrompt.js
│   │   ├── resumePrompt.js   # MODIFIED — outputs LaTeX-safe content fields
│   │   ├── coldEmailPrompt.js
│   │   ├── referralPrompt.js
│   │   └── extractionPrompt.js
│   ├── templates/
│   │   └── resume.tex        # NEW — LaTeX template with placeholders
│   ├── data/
│   │   ├── job_queue.json
│   │   ├── scraped_jobs.json # Cached scraper output
│   │   ├── company_pages.json # User-provided list of company career URLs
│   │   └── apply_whitelist.json # Sites where auto-apply is allowed
│   └── output/               # Generated resume PDFs
│
└── client/                   # React frontend (Vite)
    ├── package.json
    ├── vite.config.js        # With proxy to localhost:3001 in dev
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── api.js            # Centralized fetch helpers
        ├── pages/
        │   ├── Dashboard.jsx       # Stats + chart + recent activity
        │   ├── Jobs.jsx            # Scraped jobs table + trigger scrape
        │   ├── Applications.jsx    # All applications + status update
        │   ├── ManualApply.jsx     # Paste JD form (Phase 1 dashboard's main feature)
        │   └── Settings.jsx        # Scrape keywords, whitelist, base config
        ├── components/
        │   ├── Layout.jsx
        │   ├── Sidebar.jsx
        │   ├── StatsCard.jsx
        │   ├── EmailChart.jsx       # recharts bar chart
        │   ├── AppRow.jsx
        │   └── ResetButton.jsx
        └── styles.css
```

---

## 4. THE COMMON SERVER (server/index.js)

ONE Express server that does everything. No separate processes.

```js
// server/index.js (skeleton — you fill it in properly)
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '5mb' }));

// API routes
app.use('/api/stats', (await import('./routes/stats.js')).default);
app.use('/api/applications', (await import('./routes/applications.js')).default);
app.use('/api/jobs', (await import('./routes/jobs.js')).default);
app.use('/api/apply', (await import('./routes/apply.js')).default);
app.use('/api/scrape', (await import('./routes/scrape.js')).default);
app.use('/api/reset', (await import('./routes/reset.js')).default);

// Serve built React app in production
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientBuild = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientBuild));
app.get('*', (_, res) => res.sendFile(path.join(clientBuild, 'index.html')));

// Start BullMQ worker in same process
import('./workers/jobWorker.js');

app.listen(PORT, () => console.log(`✓ Server on http://localhost:${PORT}`));
```

Root `package.json` adds:
```json
{
  "scripts": {
    "dev": "concurrently \"npm:dev:server\" \"npm:dev:client\"",
    "dev:server": "node --watch server/index.js",
    "dev:client": "cd client && npm run dev",
    "build": "cd client && npm run build",
    "start": "node server/index.js",
    "scrape": "node server/pipeline.js --scrape-only",
    "pipeline": "node server/pipeline.js"
  }
}
```

In dev: React on `:5173`, Express on `:3001`, Vite proxies `/api` to `:3001`.
In prod (after `npm run build`): Express serves React build + API on one port.
**This is the "one common server" — solves the CORS issue from Phase 1.**

---

## 5. LATEX RESUME TAILORING (the big new piece)

Replace `data/base_resume.txt` workflow with a LaTeX template system.

### 5a. The template — `server/templates/resume.tex`

Build a clean, single-page A4 LaTeX template matching standard ATS-friendly tech-resume
conventions. Use placeholders like `<<SUMMARY>>`, `<<SKILLS>>`, `<<PROJECTS>>`, etc.
A starting template (you should refine for ATS optimization):

```latex
\documentclass[10pt,a4paper]{article}
\usepackage[margin=0.5in]{geometry}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{titlesec}
\titleformat{\section}{\large\bfseries\uppercase}{}{0em}{}[\titlerule]
\setlist{nosep,leftmargin=*}
\pagenumbering{gobble}

\begin{document}
\begin{center}
{\huge\bfseries Ritesh Kumar}\\[2pt]
\href{mailto:<<EMAIL>>}{<<EMAIL>>} $\cdot$ +91-XXXXXXXXXX $\cdot$
\href{https://linkedin.com/in/ritesh-kumar-919b0121b}{LinkedIn} $\cdot$
\href{https://github.com/ritesh7570}{GitHub}
\end{center}

\section*{Summary}
<<SUMMARY>>

\section*{Skills}
<<SKILLS>>

\section*{Experience}
<<EXPERIENCE>>

\section*{Projects}
<<PROJECTS>>

\section*{Education}
<<EDUCATION>>

\section*{Achievements}
<<ACHIEVEMENTS>>

\end{document}
```

### 5b. The tailoring service — `server/services/resumeTailor.js`

Flow:
1. Read template `server/templates/resume.tex` as a string.
2. Call Gemini with `resumePrompt(jobDescription, profile)` — prompt MUST return JSON:
   ```json
   {
     "summary": "...",
     "skills": "LaTeX-formatted skills section content",
     "experience": "LaTeX-formatted experience section content",
     "projects": "LaTeX-formatted projects section content",
     "education": "LaTeX-formatted education section content",
     "achievements": "LaTeX-formatted achievements section content",
     "changesMade": ["change 1", "change 2", ...]
   }
   ```
   The AI MUST escape LaTeX special chars (`&`, `%`, `$`, `#`, `_`, `{`, `}`, `\`, `~`, `^`).
3. Replace `<<PLACEHOLDER>>` tokens in the template with AI output.
4. Write to `server/output/resume_<timestamp>.tex`.
5. Compile to PDF.

### 5c. LaTeX compilation — three fallback strategies (try in order)

```js
async function compileLatex(texPath) {
  // 1. Local pdflatex if installed
  try { return await runLocal('pdflatex', texPath); } catch {}

  // 2. Local tectonic (lightweight portable binary) if installed
  try { return await runLocal('tectonic', texPath); } catch {}

  // 3. Free online API: https://latex.ytotech.com/builds/sync
  //    POST with file as multipart; returns PDF binary.
  return await compileViaYtotech(texPath);
}
```

The online fallback means Ritesh doesn't need LaTeX installed to get started.
Document this clearly in `CONTEXT.md` and in a `server/templates/README.md`.

### 5d. Update the resume prompt — `server/prompts/resumePrompt.js`

Tell Gemini explicitly:
- Output ONLY valid JSON.
- Each section value must be LaTeX-safe (escape special chars, use `\\` for line breaks
  inside paragraphs, use `\\begin{itemize}...\\end{itemize}` for lists).
- Be honest — never invent skills the profile doesn't have.
- Reorder/reword to emphasize keywords from the JD.
- `changesMade` is a plain-English bullet list for Ritesh to study before interviews.

---

## 6. SCRAPERS

All scrapers share this interface:

```js
// server/scrapers/<source>.js
export default async function scrapeJobs({ keywords, location, limit = 20 }) {
  // returns array of:
  // { title, company, location, jdText, applyUrl, recruiterEmail, source, scrapedAt }
}
```

### Per-scraper notes

- **Naukri** (`jobs.naukri.com/jobs-listings?k=<kw>&l=<loc>`) — list page has cards; click
  into each to get full JD. Use Playwright `chromium.launch({ headless: true })`.
- **Wellfound** (`wellfound.com/jobs?role=<kw>`) — public listings work without login.
  Try to extract company recruiter email from "About the team" section if present.
- **Internshala** (`internshala.com/internships/keywords-<kw>`) — easiest to scrape AND
  easiest to auto-apply. Mark all Internshala jobs as `autoApplyEligible: true`.
- **LinkedIn** (`linkedin.com/jobs/search?keywords=<kw>&location=<loc>`) — PUBLIC PAGES ONLY.
  If page redirects to login wall, log warning and skip. NEVER log in. NEVER scroll-load
  more than 10 jobs per session. Use 3–5s random delays.
- **Indeed** (`in.indeed.com/jobs?q=<kw>&l=<loc>`) — Indeed has aggressive bot detection;
  use random delays + realistic UA + accept-language header. If blocked, log and skip
  gracefully.
- **Company pages** — reads `server/data/company_pages.json`:
  ```json
  [
    { "company": "Razorpay", "url": "https://razorpay.com/jobs/", "selector": ".job-card" },
    { "company": "Zerodha", "url": "https://zerodha.com/careers/", "selector": null }
  ]
  ```
  If `selector` is null, dump all visible job links and let Gemini extract titles + URLs.

### Common scraper utilities — `server/scrapers/utils.js`

- `randomDelay(min=1500, max=3500)`
- `getUserAgent()` — returns realistic Chrome UA
- `dedupe(jobs)` — by `title+company`
- `extractRecruiterEmail(jdText)` — regex for emails in JD body

### Trigger via API

`POST /api/scrape` with body `{ keywords, location, sources: ["naukri","wellfound"] }`
→ starts scraping in background, returns `{ jobId, status: "started" }`.
`GET /api/scrape/status/:jobId` → polls progress.

---

## 7. HYBRID AUTO-APPLY LOGIC

For each scraped + eligible job, the worker decides:

```
if (recruiterEmail exists) {
  → send cold email automatically from riteshkr0759@gmail.com
  → save tailored resume PDF, attach to email
  → log status: "email_sent"
}

if (job.source is in apply_whitelist.json) {
  → run applicators/<source>.js to fill the form via Playwright
  → on success: log status: "auto_applied"
  → on failure: send notification + log "needs_manual"
}

else {
  → send notification email to Ritesh with:
    - Job title, company, link
    - JD summary (Gemini-generated, 3 sentences)
    - Tailored resume PDF attached
    - Cold email draft (ready to copy)
    - Referral message draft (ready to copy)
    - One-click "Mark as applied" button → links to dashboard
  → log status: "notified"
}
```

### `server/data/apply_whitelist.json`

```json
{
  "internshala": true,
  "companyPages": ["razorpay", "zerodha"],
  "wellfound": false,
  "naukri": false,
  "linkedin": false,
  "indeed": false
}
```

### Internshala applicator — `server/applicators/internshala.js`

Internshala has a relatively simple application flow:
1. Navigate to job URL.
2. Click "Apply now".
3. Fill cover letter textarea with AI-generated cover letter.
4. Answer any custom questions using AI.
5. Submit.

**CRITICAL:** Add a "dry run" mode — `INTERNSHALA_DRY_RUN=true` in `.env` means it
fills the form but doesn't click submit. Default to dry run for the first week so
Ritesh can verify the flow visually before letting it loose.

---

## 8. NOTIFICATION EMAILS

When the agent can't auto-apply, send Ritesh a notification email.

### `server/services/notifier.js`

```
Subject: 🎯 Job found: <Role> at <Company> — score <X>/100

Body (HTML, dark-mode friendly):
─────────────────────────────────────────
NEW JOB MATCH

Company: Razorpay
Role: Backend Engineer (1-2 yrs)
Location: Bangalore (Remote)
Eligibility score: 87/100
Source: Naukri

Why it matched:
[Gemini's 3-sentence eligibility reason]

Apply link:
[BIG BUTTON → applyUrl]

I tailored your resume — see attached PDF.
Key changes I made (study these before interview):
• added Node.js scalability keyword
• reworded Sarthi to emphasize backend pipeline
• reordered skills section

I drafted a cold email for you (copy/paste):
[email body in monospace box]

I drafted a referral message for you (copy/paste):
[referral body in monospace box]

[BUTTON: Mark as applied →]  (links to dashboard with prefilled status)
─────────────────────────────────────────
```

Send from `riteshkr0759@gmail.com` to `riteshkr0759@gmail.com`.
Use Nodemailer with the existing Gmail app password.
Attach the tailored resume PDF.

---

## 9. REACT DASHBOARD (client/)

Use **Vite + React + recharts + plain CSS** (no Tailwind — keeps the bundle small for
free hosting). Dark theme matching the screenshot — bg `#0f0f0f`, cards `#1a1a1a`,
accent green `#4ade80`.

### Routes
- `/` — Dashboard (stats + chart + recent activity)
- `/jobs` — Scraped jobs table with filters
- `/applications` — All applications, status updates, "view resume PDF" button
- `/manual-apply` — Paste JD form (the Phase 1 dashboard's main use case)
- `/settings` — Edit scrape keywords, whitelist toggles, company pages list

### Dashboard page features
- StatsCards: Total applications, emails sent today, emails sent this week, avg score
- EmailChart (recharts bar chart): last 7 days of cold email sends
- Recent activity feed: last 10 events (scraped, applied, email sent, notified)
- "Run full pipeline now" button → POST `/api/scrape` then triggers worker

### ManualApply page (KEEP this — it was the most valuable Phase 1 dashboard feature)
- Textarea for JD
- Optional inputs: recruiter email, recruiter name, company, role
- "Process" button → POST `/api/apply`
- Shows: eligibility score badge, change list, cold email preview, referral preview
- Buttons: "Send Email Now", "Save Draft Only", "Download Resume PDF"

### Settings page
- Edit `SCRAPE_KEYWORDS`, `SCRAPE_LOCATION`, `MIN_ELIGIBILITY_SCORE`
- Toggle scrapers on/off
- Edit `apply_whitelist.json` via UI
- Add/remove company pages (writes to `company_pages.json`)
- Reset all data button (red, confirm modal)

### Reset feature
`DELETE /api/reset` body `{ scope: "applications" | "jobs" | "all" }`
- "applications" → clears applications collection only
- "jobs" → clears `scraped_jobs.json`
- "all" → clears both, keeps `output/` PDFs on disk

---

## 10. ENV VARIABLES (server/.env.example)

```ini
# Server
PORT=3001
NODE_ENV=development

# AI
AI_PROVIDER=gemini
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

# Database
MONGO_URI=
MONGO_DB_NAME=job_application_agent

# Gmail (for cold emails + notifications)
GMAIL_USER=riteshkr0759@gmail.com
GMAIL_APP_PASSWORD=
GMAIL_REFERRAL_USER=ritesh7882@gmail.com
GMAIL_REFERRAL_APP_PASSWORD=

# Scraping
SCRAPE_KEYWORDS=backend developer node.js
SCRAPE_LOCATION=India
MIN_ELIGIBILITY_SCORE=60

# Queue
REDIS_URL=redis://localhost:6379

# Auto-apply safety
INTERNSHALA_DRY_RUN=true
NOTIFICATION_EMAIL=riteshkr0759@gmail.com

# LaTeX
LATEX_COMPILER=auto   # auto | pdflatex | tectonic | ytotech
```

---

## 11. BUILD ORDER (do exactly this sequence)

1. **Restructure first** — move existing Phase 1 files into `server/`. Verify `npm start`
   and `npm run auto` still work after the move. Update `CONTEXT.md`.
2. **Create Express server** — `server/index.js`, with `/api/stats`, `/api/applications`,
   `/api/reset` first (these use existing services). Verify in browser/Postman.
3. **Scaffold React client** — `npm create vite@latest client -- --template react`,
   set up Vite proxy, build basic Dashboard page hitting `/api/stats`.
4. **LaTeX resume tailor** — `services/resumeTailor.js` + `templates/resume.tex` +
   updated `resumePrompt.js`. Test by tailoring for one sample JD via direct function
   call before wiring to API. **Get the LaTeX compiling reliably before moving on.**
5. **Manual Apply page** — connect the React form to `POST /api/apply` and show the
   tailored PDF as a download link. This delivers immediate value.
6. **Notifier** — `services/notifier.js`. Send a test notification to Ritesh's email
   manually before wiring into the pipeline.
7. **First scraper — Internshala** — easiest, no aggressive bot detection. Get scrape
   → save to MongoDB → display on `/jobs` page working end-to-end.
8. **Internshala applicator** with `INTERNSHALA_DRY_RUN=true` default. Test the flow
   visually 5–10 times before flipping the switch.
9. **Remaining scrapers** — Naukri, Wellfound, then Indeed, LinkedIn, company pages.
10. **BullMQ pipeline** — wire everything together. `POST /api/scrape` triggers full
    flow asynchronously.
11. **Settings page + reset feature**.
12. **Production build path** — verify `npm run build` produces `client/dist/` and that
    `npm start` serves the React app + API from `:3001` with no CORS issues.

---

## 12. HOSTING NOTES (for later, do not deploy yet)

- **MongoDB**: Atlas free tier — already configured.
- **Backend + frontend**: Render free tier (one web service running `npm run build && npm start`).
  Render free spins down after 15 min idle — fine for personal use.
- **Playwright on Render**: works but needs `playwright install chromium` in build step
  and ~512MB memory. Add a `render.yaml` later.
- **Cron scraping**: Render free doesn't support cron. Use a free external pinger like
  `cron-job.org` to hit `POST /api/scrape` on schedule.
- **LaTeX in production**: use the `ytotech.com` API fallback — no install needed.

Do not write deployment configs yet. Local first, deploy after Ritesh confirms.

---

## 13. RULES (NON-NEGOTIABLE)

1. **Never break `npm start` or `npm run auto` from Phase 1.** They must keep working
   after the restructure (paths inside them will update to `server/...` but commands stay).
2. **Update `CONTEXT.md` after every meaningful change.** Sections required:
   PROJECT STATUS / FOLDER STRUCTURE / KEY DECISIONS / PENDING TASKS / KNOWN ISSUES /
   HOW TO RUN / ENV VARIABLES NEEDED.
3. **Auth is OUT of scope for Phase 2.** Single-user, local only. Ritesh will add later.
4. **Auto-apply defaults to DRY RUN** until Ritesh explicitly flips the env flag.
5. **Never hardcode credentials.** All secrets via `.env`.
6. **Use ESM only** (`import/export`), Node 18+, async/await everywhere, proper try/catch.
7. **AI prompts stay in `server/prompts/`** as editable `.js` files.
8. **Ask before installing anything heavy** (e.g. Tailwind, shadcn, Redis-as-service).
   Stick to: express, cors, mongoose, playwright, bullmq, ioredis, nodemailer, dotenv,
   @google/generative-ai, recharts, react-router-dom.
9. **Test every piece in isolation** before wiring to the next. Don't build 5 things
   and try to debug them together.

---

## 14. START INSTRUCTION

Begin Phase 2 by:

1. Reading the current `e:\agent` folder structure and `CONTEXT.md`.
2. Confirming with me which files to move where (show me the move plan first).
3. Creating the `server/` and `client/` folders and migrating Phase 1 files.
4. Updating `CONTEXT.md` immediately to reflect the restructure.
5. Running `npm start` and `npm run auto` from the new structure to verify nothing broke.
6. THEN proceeding to step 2 of the build order.

If you need any `.env` value I haven't given you (LATEX_COMPILER preference, etc.),
ask. Do not guess.

Begin.
