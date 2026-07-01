# PHASE 3 — JOB APPLICATION AGENT
## Expand Auto-Apply, Add Credential Vault, Company Watchlist, and Scrape Visibility

> **How to use this file:**
> 1. Paste everything below the divider into Claude / Codex / Gemini as your first message.
> 2. Also paste the latest `CONTEXT.md` AND `AUTO_APPLY_LOGIC.md` from `e:\agent` so the AI has full project history.
> 3. The AI will ask you for credentials (Indeed login, Naukri login). Provide them only when it explicitly needs them; never paste secrets into the chat.

---

You are a senior full-stack engineer continuing work on my autonomous job application
agent. Phase 1 (CLI), Phase 2 (React dashboard + LaTeX resume + Internshala applicator)
are complete and working. Phase 3 expands auto-apply to more platforms, adds a credential
vault, a company watchlist, and fixes the broken scrape visibility.

Write real, runnable, production-quality Node.js + React code. Update `CONTEXT.md` and
`AUTO_APPLY_LOGIC.md` after every meaningful change. If anything is ambiguous, ASK.

---

## 1. EXISTING STATE (READ FIRST — DO NOT BREAK)

Project lives at `e:\agent` with the monorepo split:
- `server/` — Express backend, scrapers, applicators, services, prompts
- `client/` — React + Vite frontend on port 5173 (dev), served by Express in prod

Working today:
- CLI: `npm start`, `npm run auto`
- Pipeline: `npm run pipeline` (scrape → filter → tailor → email/apply/notify)
- Dashboard pages: Dashboard, Jobs, Applications, Manual Apply, Settings, HR Contacts
- LaTeX resume tailoring (pdflatex → tectonic → ytotech fallback)
- Internshala applicator (DRY_RUN default)
- Hybrid decision logic in `server/workers/processor.js`
- HR Contacts: separate batch cold-email channel

**Known bug to fix in this phase:** `POST /api/scrape` only saves `scraped_jobs.json`
but does NOT enqueue jobs onto BullMQ. The dashboard's "Run full pipeline now" button
appears to do nothing because the worker never picks the jobs up. See Section 6 below.

**Files you must read before writing code:**
- `e:\agent\CONTEXT.md`
- `e:\agent\AUTO_APPLY_LOGIC.md`
- `server/workers/processor.js`
- `server/applicators/index.js`
- `server/applicators/internshala.js`
- `server/routes/scrape.js`
- `server/scrapers/index.js`

---

## 2. STRATEGIC DECISIONS (locked in — do not deviate)

These are deliberate scope decisions. The AI should NOT propose alternatives unless asked.

| Decision | Reason |
|---|---|
| **LinkedIn auto-apply: NEVER** | LinkedIn has the most aggressive anti-bot system. Risk of permanent account ban is too high. Scrape public pages only — read-only, no login. |
| **Indeed auto-apply: YES, with login** | "Easy Apply" works. Captcha risk acceptable for now. DRY_RUN default. |
| **Naukri auto-apply: YES, with login** | "I'm Interested" + simple form flow. DRY_RUN default. |
| **Glassdoor: NO** | Most postings redirect to other ATS. Not worth the engineering effort. |
| **Workday / Greenhouse / Lever / iCIMS: NO** | Each company's instance is custom. 2-3 days work per company. Out of scope. |
| **Company career pages: YES (whitelist only)** | Use the generic applicator + per-company tweaks where needed. |
| **Cold email = primary channel** | Highest signal-to-noise. ATS auto-apply is secondary support. |

---

## 3. WHAT PHASE 3 ADDS

Four parts. Build in order.

### Part A — Credential Vault (foundational)
A secure way to store and use login credentials for Indeed, Naukri, and any future
platform — with session reuse so we don't log in every run (which triggers bot detection).

### Part B — Per-Platform Applicators
- `applicators/indeed.js` — Indeed Easy Apply
- `applicators/naukri.js` — Naukri quick apply

Both default to DRY_RUN. Both reuse saved sessions from Part A.

### Part C — Company Watchlist
A user-editable list of target companies. Scraped more frequently and prioritized in
the pipeline. Edit from the Settings page in the dashboard.

### Part D — Scrape Visibility + Bug Fix
Fix the `/api/scrape` enqueue bug. Add a live "Scraping" status page so the user can
see what's happening, per source, in real time.

---

## 4. PROJECT STRUCTURE CHANGES

```
server/
├── data/
│   ├── credentials.json        # NEW — gitignored, encrypted-at-rest optional
│   ├── target_companies.json   # NEW — company watchlist
│   ├── sessions/               # NEW — saved cookies per platform
│   │   ├── indeed.json
│   │   └── naukri.json
│   ├── scrape_runs/            # NEW — per-run scrape logs for visibility
│   │   └── run_<timestamp>.json
│   ├── apply_whitelist.json    # existing — extended (see Part C)
│   └── company_pages.json      # existing
├── services/
│   ├── credentialStore.js      # NEW — read/write credentials.json safely
│   ├── sessionManager.js       # NEW — login + cookie save/load/expire
│   └── scrapeReporter.js       # NEW — writes run logs, emits SSE events
├── applicators/
│   ├── indeed.js               # NEW
│   ├── naukri.js               # NEW
│   ├── internshala.js          # existing
│   ├── generic.js              # existing
│   └── index.js                # MODIFIED — adds indeed/naukri routing
├── scrapers/
│   ├── companyWatchlist.js     # NEW — dedicated scraper for target_companies.json
│   └── index.js                # MODIFIED — runs watchlist scraper too
├── routes/
│   ├── credentials.js          # NEW — CRUD for credentials.json
│   ├── companies.js            # NEW — CRUD for target_companies.json
│   ├── scrape.js               # MODIFIED — enqueue jobs after scraping
│   └── scrapeStatus.js         # NEW — SSE endpoint for live scrape progress
└── .gitignore                  # MODIFIED — add data/credentials.json, data/sessions/

client/src/
├── pages/
│   ├── ScrapeStatus.jsx        # NEW — live scrape progress page
│   ├── Credentials.jsx         # NEW — login manager UI
│   ├── Companies.jsx           # NEW — watchlist editor
│   └── Settings.jsx            # MODIFIED — add links to above pages
└── components/
    └── ScrapeRunCard.jsx       # NEW — shows per-source status
```

---

## 5. PART A — CREDENTIAL VAULT

### 5a. `server/data/credentials.json` format

```json
{
  "indeed": {
    "email": "...",
    "password": "...",
    "enabled": false
  },
  "naukri": {
    "email": "...",
    "password": "...",
    "enabled": false
  }
}
```

**Default `enabled: false` for every entry.** User must explicitly enable from the
dashboard before any login attempt happens. This is a hard safety gate.

### 5b. `server/services/credentialStore.js`

Functions to export:
- `getCredentials(platform)` → returns `{email, password, enabled}` or null
- `setCredentials(platform, {email, password, enabled})` → writes to file
- `listPlatforms()` → returns all configured platforms

Encrypt the password field at rest using `crypto.createCipheriv('aes-256-gcm', ...)`
with a key derived from a new `.env` variable `CREDENTIAL_VAULT_KEY` (32-byte hex).
If `CREDENTIAL_VAULT_KEY` is missing on startup, log a clear warning and skip
encryption (store plain — file is gitignored anyway). Document this trade-off in
`CONTEXT.md`.

### 5c. `server/services/sessionManager.js`

Functions to export:
- `getSession(platform)` → returns cookies array or null if expired/missing
- `saveSession(platform, cookies)` → writes to `data/sessions/<platform>.json` with timestamp
- `isSessionFresh(platform, maxAgeDays = 7)` → boolean
- `loginAndSave(platform, page)` → performs the login flow, saves cookies

Each platform implements its own login function inside its applicator (`indeed.js`
exports `login(page, credentials)`, etc.) and `sessionManager` orchestrates.

Flow at apply time:
```
1. Is session fresh? → load cookies into Playwright context → done
2. Are credentials enabled? → loginAndSave() → reuse cookies for next run
3. Neither? → throw clear error: "Credentials not configured for <platform>"
```

### 5d. API routes — `server/routes/credentials.js`

```
GET  /api/credentials              → list platforms (passwords masked as "•••")
PUT  /api/credentials/:platform    → set email/password/enabled
DELETE /api/credentials/:platform  → clear
POST /api/credentials/:platform/test-login → spawn Playwright headed, attempt login, return success/fail
```

### 5e. React page — `client/src/pages/Credentials.jsx`

Simple form per platform:
- Email input
- Password input (type="password")
- "Enabled" toggle (defaults OFF — explicit opt-in)
- "Test login" button — runs headed Playwright so user can visually confirm + handle any captcha
- Status badge: "Session fresh (3 days ago)" / "No session" / "Login failed"

Warn prominently at the top:
> ⚠️ Your credentials are stored locally in `data/credentials.json`. This file is
> gitignored. Auto-login carries a small risk of account flagging on Indeed/Naukri.
> Toggle "Enabled" only after you've reviewed the applicator behavior in DRY_RUN mode.

---

## 6. PART B — PER-PLATFORM APPLICATORS

### 6a. `server/applicators/indeed.js`

Functions:
- `login(page, {email, password})` — opens `indeed.com/account/login`, fills, submits,
  returns cookies on success or throws if captcha encountered
- `apply(page, job, resumePath)` — opens `job.applyUrl`, clicks "Easy Apply", uploads
  resume, fills any visible fields using heuristic matching, submits if not DRY_RUN

Env flag: `INDEED_DRY_RUN=true` (default).

### 6b. `server/applicators/naukri.js`

Functions:
- `login(page, {email, password})` — opens `naukri.com/nlogin/login`, fills, submits
- `apply(page, job, resumePath)` — opens `job.applyUrl`, handles Naukri's "I'm Interested"
  flow (often no separate apply form — sometimes redirects to external site, in which case
  log "external redirect" and stop)

Env flag: `NAUKRI_DRY_RUN=true` (default).

### 6c. Modify `server/applicators/index.js`

Routing logic by source:
```js
const routes = {
  internshala: () => import('./internshala.js'),
  indeed: () => import('./indeed.js'),
  naukri: () => import('./naukri.js'),
  generic: () => import('./generic.js'),
};
```

Update `isWhitelisted()` to check the new sources against `apply_whitelist.json`:
```json
{
  "internshala": true,
  "indeed": false,
  "naukri": false,
  "companyPages": []
}
```

User flips these to `true` only after watching the applicator dry-run 5–10 times on
each platform.

### 6d. Captcha handling

If `page.url()` contains `captcha` or a captcha selector is detected:
- Take a screenshot to `data/captcha_<platform>_<timestamp>.png`
- Send notification email to `NOTIFICATION_EMAIL` with subject "Captcha encountered on
  <platform> — manual intervention needed" and attach the screenshot
- Mark application status `captcha_blocked`
- Skip this job, continue with the queue

Never attempt to solve captchas. Do not integrate third-party captcha-solving services.

### 6e. Login throttling (safety)

In `sessionManager.js`, track last login time per platform. Refuse to log in more than
once per 6 hours per platform. Even on session expiry, wait. This is anti-detection
hygiene.

---

## 7. PART C — COMPANY WATCHLIST

### 7a. `server/data/target_companies.json` format

```json
[
  {
    "name": "Razorpay",
    "careersUrl": "https://razorpay.com/jobs/",
    "selector": ".job-listing",
    "priority": 1,
    "lastScrapedAt": null,
    "tags": ["fintech", "remote-friendly"]
  }
]
```

`priority`: 1 = scrape every run, 2 = scrape every 2 runs, 3 = scrape weekly.

### 7b. `server/scrapers/companyWatchlist.js`

- Reads `target_companies.json`
- Filters by priority + last-scraped time
- For each enabled company:
  - Playwright opens `careersUrl`
  - If `selector` provided: extract job cards via selector
  - If not: dump all `<a>` tags with text matching "engineer|developer|sde|intern", feed
    to Gemini with prompt "Extract job listings from this HTML: title, location, applyUrl"
- Returns the same job shape as other scrapers: `{title, company, location, jdText, applyUrl, recruiterEmail, source: "companyWatchlist", scrapedAt}`
- Updates `lastScrapedAt` for each company after a successful scrape

### 7c. Modify `server/scrapers/index.js`

Add company watchlist to the parallel `Promise.allSettled` list. Watchlist jobs get a
priority bump in the pipeline — process them FIRST in the queue.

### 7d. API routes — `server/routes/companies.js`

```
GET    /api/companies          → list all watchlist entries
POST   /api/companies          → add new entry
PUT    /api/companies/:id      → update entry
DELETE /api/companies/:id      → remove entry
POST   /api/companies/:id/test-scrape → run scraper for just this company, return preview
```

### 7e. React page — `client/src/pages/Companies.jsx`

Table view:
| Company | Careers URL | Selector | Priority | Last Scraped | Actions |

Add/edit row inline. "Test scrape" button shows preview of what was found in a modal.
Link to this page from Settings.

### 7f. Whitelist integration

If a company in `target_companies.json` is also in `apply_whitelist.json`'s
`companyPages` array, jobs from that company go through the generic applicator
automatically (existing behavior, just confirming it still works).

---

## 8. PART D — SCRAPE VISIBILITY + BUG FIX

### 8a. Fix the enqueue bug

In `server/routes/scrape.js`, after writing `scraped_jobs.json`:

```js
import { createQueue } from '../workers/queue.js';

const queue = createQueue();
for (const job of scrapedJobs) {
  await queue.add('processJob', job);
}
```

Now the dashboard's "Run full pipeline now" button actually runs the full pipeline.

### 8b. Per-run scrape logs — `server/services/scrapeReporter.js`

Every time `scrapeAll()` runs, write a JSON file to `data/scrape_runs/run_<timestamp>.json`:

```json
{
  "runId": "2026-06-30T12-30-00",
  "startedAt": "2026-06-30T12:30:00Z",
  "finishedAt": "2026-06-30T12:33:45Z",
  "sources": {
    "internshala": { "status": "success", "jobsFound": 23, "durationMs": 12000, "error": null },
    "naukri":       { "status": "failed",  "jobsFound": 0,  "durationMs": 8000,  "error": "Selector .jobTuple not found — page structure may have changed" },
    "wellfound":    { "status": "success", "jobsFound": 7,  "durationMs": 15000, "error": null },
    "linkedin":     { "status": "skipped", "jobsFound": 0,  "durationMs": 0,     "error": "Login wall detected, skipping" },
    "companyWatchlist": { "status": "success", "jobsFound": 4, "durationMs": 9000, "error": null }
  },
  "totalJobs": 34,
  "deduplicated": 31
}
```

### 8c. Live scrape progress — SSE endpoint

`GET /api/scrape/status/stream` — Server-Sent Events stream.

Events emitted:
```
event: source-started   data: {"source": "internshala"}
event: source-progress  data: {"source": "internshala", "found": 5}
event: source-done      data: {"source": "internshala", "found": 23, "durationMs": 12000}
event: source-error     data: {"source": "naukri", "error": "..."}
event: run-complete     data: {"runId": "...", "totalJobs": 34}
```

`scrapeReporter.js` exposes an EventEmitter; each scraper calls `reporter.emit('source-progress', {...})` as it works. The route subscribes and pipes events to the SSE response.

### 8d. React page — `client/src/pages/ScrapeStatus.jsx`

Layout:
- "Start new scrape" button at top → POST `/api/scrape` with keyword/location form
- Live status panel below, one card per source:
  ```
  ┌─────────────────────────────────────┐
  │ Internshala            ✓ 23 jobs    │
  │ ━━━━━━━━━━━━━━━━━━━━━━━ 100%       │
  │ 12.0s                              │
  └─────────────────────────────────────┘

  ┌─────────────────────────────────────┐
  │ Naukri                 ✗ Failed     │
  │ ━━━━━━━━━━━━━━━━━━━━━━━ -          │
  │ Error: Selector .jobTuple not found │
  └─────────────────────────────────────┘
  ```
- History section below: last 10 scrape runs, expandable to show per-source details

The SSE stream updates the cards in real time. EventSource API in vanilla React, no
extra library needed.

### 8e. Dashboard updates

Add to the main Dashboard page:
- "Last scrape" widget — timestamp, total jobs, link to ScrapeStatus page
- "Queue status" widget — jobs waiting / processing / completed / failed (from BullMQ)

---

## 9. ENV VARIABLES (additions)

Add to `server/.env.example`:

```ini
# Credential vault
CREDENTIAL_VAULT_KEY=                  # 32-byte hex, generate via: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Per-platform dry-run flags (default true, flip only after watching dry-run work)
INDEED_DRY_RUN=true
NAUKRI_DRY_RUN=true
INTERNSHALA_DRY_RUN=true
AUTO_APPLY_DRY_RUN=true

# Login throttling
MIN_HOURS_BETWEEN_LOGINS=6
```

---

## 10. BUILD ORDER (do exactly this sequence)

1. **Fix the enqueue bug first** — `routes/scrape.js`. Verify the dashboard's "Run
   full pipeline now" button now actually processes jobs. Smallest, highest-impact change.
2. **Scrape reporter + run logs** — write logs to `data/scrape_runs/`, no UI yet.
3. **SSE endpoint** — `/api/scrape/status/stream`. Verify with `curl -N` from terminal.
4. **ScrapeStatus.jsx React page** — wire up SSE, show live cards. This delivers the
   biggest UX win — Ritesh finally sees what scraping does.
5. **Credential vault** — `credentialStore.js` + `sessionManager.js` + routes + React page.
   Test by storing/retrieving fake creds; do NOT log in yet.
6. **Indeed applicator** with DRY_RUN. Run headed Playwright manually, watch it open
   Indeed, navigate to a job, fill the form, NOT submit. Confirm 5–10 times before
   marking trustworthy.
7. **Naukri applicator** with DRY_RUN. Same verification.
8. **Company watchlist** — `target_companies.json` + scraper + routes + React page.
9. **Wire it all into the pipeline** — `workers/processor.js` routes jobs to the correct
   applicator. Watchlist jobs get priority.
10. **Update `CONTEXT.md` and `AUTO_APPLY_LOGIC.md`** to reflect Phase 3 state.
11. **Final verification** — `npm run pipeline` end-to-end with sample data, all sources
    DRY_RUN. Confirm no real submissions happen.

---

## 11. NON-NEGOTIABLE RULES

1. **DRY_RUN defaults to true for every applicator.** Flipping requires explicit env
   change by the user — never default to false in code.
2. **Never log in to LinkedIn.** Public scraping only, as today.
3. **`data/credentials.json` and `data/sessions/` MUST be in `.gitignore`.** Verify
   before committing anything.
4. **Login throttling is mandatory.** Never log in to the same platform more than once
   per 6 hours, even on session-fresh failure.
5. **Captcha = stop + notify.** Never attempt to solve. Never integrate captcha-solving
   services.
6. **Don't break existing Phase 1/2 functionality.** Verify `npm start`, `npm run auto`,
   `npm run pipeline`, the existing Manual Apply flow, and the HR Contacts batch sender
   all still work after every step.
7. **Update `CONTEXT.md` and `AUTO_APPLY_LOGIC.md` after every meaningful change.** Both
   files together must let any future AI continue without context loss.
8. **Ask before installing new dependencies.** Stick to: playwright, bullmq, ioredis,
   nodemailer, mongoose, express, dotenv, @google/generative-ai, recharts, react-router-dom.
   For SSE the native `EventSource` and `res.write` are enough — no extra libs.

---

## 12. START INSTRUCTION

1. Read `CONTEXT.md`, `AUTO_APPLY_LOGIC.md`, and the existing
   `workers/processor.js` + `applicators/index.js` + `routes/scrape.js`.
2. Show me your understanding of the current state in 5–10 bullets before writing code.
3. Start with Step 1 of the build order (fix the enqueue bug). Show me the diff before
   committing.
4. Wait for confirmation, then proceed to Step 2.

Do not skip ahead. Do not batch multiple steps. Do not write credentials or applicator
code until I've verified Steps 1–4 work.

Begin.
