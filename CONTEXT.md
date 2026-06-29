# Job Application Agent Context

## -5. SESSION 7 SUMMARY (most recent — read this first)

User uploaded a real large HR list (14493-char prompt, 100+ contacts) and hit two
compounding failures: a JSON-parse error ("Expected ',' or ']' after array element") and,
after the Session 6 fallback fix, the *entire* OpenRouter fallback chain also failing
(429s on some free models, "terminated" connection errors on others).

- **Root cause**: nothing ever set `maxOutputTokens` (Gemini) or `max_tokens`
  (OpenRouter), so a 100+ entry contact list response got cut off mid-array at whatever
  small default the provider used. Stacking more fallback models doesn't fix a
  fundamentally-too-large single request — small free models in particular choke or get
  killed by the provider on big prompts+outputs ("terminated" is a dropped connection,
  likely the provider's proxy giving up on a slow/large generation).
- **Fix #1 — raise the ceiling**: `services/aiClient.js` now sets
  `maxOutputTokens: 8192` on Gemini and `max_tokens: 8000` on OpenRouter calls. Helps,
  but doesn't fully solve it for very large lists.
- **Fix #2 — salvage truncated JSON instead of failing**: `services/json.js` gained
  `repairTruncatedJson()` — walks the response tracking string/bracket depth, finds the
  last *fully closed* array element, and returns everything up to there instead of
  throwing the whole result away. Verified against a synthetic truncated response
  (correctly recovered 2 of 3 entries) and confirmed zero regression on normal responses,
  markdown-fenced JSON, and noise-wrapped JSON.
- **Fix #3 — the real fix — chunk the input before sending to AI**: `routes/hrContacts.js`
  now splits the extracted raw text into ~4000-char chunks (`chunkText()`, splits on line
  boundaries only — never mid-line, so one contact's details can't be torn across two
  chunks) and runs `buildHrListExtractionPrompt` once per chunk sequentially (1.5s delay
  between chunks), merging all `contacts` arrays before saving. `MAX_RAW_TEXT_CHARS`
  raised from 20000 to 60000 since chunking makes large input safe to process. One
  chunk failing (rate limit, truncation, whatever) no longer kills the whole upload —
  it's logged and skipped, and the response now includes `chunks` (total) and
  `chunkFailures` (count) so the UI can show e.g. "Found 87 contacts across 24 chunks —
  added 87, skipped 0 duplicates (2/24 chunks failed and were skipped)."
  `pages/HrContacts.jsx` updated to surface this.
- **Verified**: chunking logic tested directly (50 synthetic contact lines -> 6 chunks,
  zero lines lost, no chunk split mid-line, no chunk exceeds the size cap). `node --check`
  passed on every server file; `npm run build` (client) succeeded. Did NOT re-test the
  full live upload flow against a real large PDF in this session (the user's server was
  left running and not restarted at their request) — next real upload attempt is the
  actual end-to-end verification of this fix.
- User declined to have their running server restarted this turn — they'll restart it
  themselves before retrying the upload. If a future report says "still failing" with
  this exact same OpenRouter-429/terminated pattern, check whether the server process
  predates this fix before assuming the fix itself is wrong (this is the third time in
  this conversation a "fix didn't work" turned out to be a stale process — see Sessions
  5 and 6 for the same gotcha with `.env` edits).

## -4. SESSION 6 SUMMARY

User added `OPENROUTER_API_KEY` to `server/.env` and reported the HR Contacts upload
still showing a raw Gemini 429 error in the UI.

- **Root cause #1 (the actual bug)**: the hardcoded default OpenRouter model
  (`meta-llama/llama-3.3-70b-instruct:free`) was itself upstream-rate-limited at the time
  — OpenRouter's free models share a *global* pool per model, not per account, so any
  single one can 429 regardless of your own usage. Fixed by making
  `generateWithOpenRouter()` try a short list of free models in sequence
  (`FALLBACK_FREE_MODELS` in `services/aiClient.js`: `openai/gpt-oss-20b:free`,
  `nvidia/nemotron-nano-9b-v2:free`, `meta-llama/llama-3.3-70b-instruct:free`,
  `qwen/qwen3-coder:free`), with whatever `OPENROUTER_MODEL` is configured tried first.
  Verified live by querying `GET https://openrouter.ai/api/v1/models` for the current
  free-model catalog (it changes — several previously-known slugs like
  `meta-llama/llama-3.1-8b-instruct:free` now 404) and confirming individual models'
  real-time availability before picking the fallback list.
- **Root cause #2 (recurring environment gotcha)**: the server process the user had
  running predated their `.env` edit — `dotenv/config` only reads the file once at
  process startup, so adding a key to `.env` has zero effect until the process restarts.
  This is the second time in this conversation a "fix isn't working" turned out to be a
  stale running process (see Session 5's stray port-3001 process). Worth proactively
  checking `netstat -ano | grep :3001` before debugging "why didn't my fix work" reports.
  Confirmed with the user before killing their running process and restarting it.
- **Verified live end-to-end**: rebuilt a test PDF (same LaTeX-via-ytotech trick as
  Session 5), uploaded it to `/api/hr-contacts/upload` against the restarted server —
  Gemini hit its 429 again (quota still exhausted from this session's heavy testing),
  `generateWithOpenRouter` correctly fell through to a working free model, and all 3 real
  contacts were extracted correctly (skipping the line with no email, as designed). Test
  contacts and the test PDF were deleted afterward. Left a clean server running on `:3001`
  for the user since they were actively using the dashboard.
- Also added a couple of `console.log` lines to `hrBatchSender.js`'s no-op paths
  ("already ran today" / "no unsent contacts") for consistency with this session's
  broader "log everything" request — these were previously silent successes.

## -3. SESSION 5 SUMMARY

Four features added in one go: job posted/deadline dates, an HR-contact-list upload +
daily auto cold-email batch, full request/response + AI-call debug logging, and a UI
polish pass (status badges, loading/empty states).

- **Job dates**: `Application` schema gained `postedDate` / `applicationDeadline`
  (`Date`, default `null`). `prompts/extractionPrompt.js` now also asks the AI to
  resolve phrases like "Posted 3 weeks ago" / "APPLY BY 17 Jul' 26" into ISO dates,
  defaulting to `null` when it can't tell. `applicationProcessor.js` parses these via a
  new `parseDateOrNull()` helper before saving. Shown on the Applications page (new
  Posted/Deadline columns in `AppRow.jsx`). Scraped-job-list entries (`scraped_jobs.json`)
  do NOT carry these — they're only populated when a job is actually processed
  (manual apply / pipeline), since that's when the JD extraction step runs.
- **HR contact list feature** (the "upload a PDF of HR names, daily-send 20" request):
  - `services/applicationStore.js` gained a shared `ensureConnected()` export (factored
    out of `connectApplicationStore`) so other models can reuse the same mongoose
    connection singleton.
  - `services/hrContactStore.js` — new `HrContact` model (`name`, `company`, `email`
    [unique], `role`, `linkedin`, `sourceFile`, `emailSent`, `emailedAt`, `createdAt`).
    `saveHrContacts()` dedupes by email (catches Mongo's `11000` duplicate-key error
    rather than failing the whole batch), `listHrContacts()`, `getUnsentHrContacts(limit)`,
    `setHrContactSent(id, sent)`.
  - `prompts/hrListExtractionPrompt.js` — freeform-text-to-JSON-array extraction (no
    fixed column format assumed, per the user's "not sure yet" answer); only keeps
    entries with an email, doesn't invent one.
  - `routes/hrContacts.js` — `GET /` (paginated list + total/sentCount), `POST /upload`
    (multer memory storage, 15MB limit, reuses `resumeParser.extractResumeText` for
    PDF/DOCX, truncates raw text at 20000 chars with a `truncated` flag in the response),
    `PATCH /:id` (manual sent/unsent toggle, for the UI checkbox).
  - `prompts/genericColdEmailPrompt.js` + `services/hrBatchSender.js` — the daily batch.
    Generates ONE generic tailored resume (via the existing `tailorResume()`, using a
    fixed generic "no specific posting" JD string) and ONE generic cold-email template
    with literal `{{name}}`/`{{company}}` placeholders, **per batch**, then does simple
    string substitution per contact instead of an AI call per contact — deliberately
    light on Gemini usage given the free-tier quota problems this session also hit.
    State (`server/data/hr_batch_state.json`, gitignored) tracks `lastRunDate` so it only
    runs once per calendar day. 2-second delay between sends. Wired into `server/index.js`:
    runs once on startup, then every hour via `setInterval` (so a long-running server
    picks up a new day without a restart) — both are no-ops if already run today.
  - Client: `pages/HrContacts.jsx` (upload button, stats row, table with a real checkbox
    that PATCHes sent/unsent), added to `Sidebar.jsx` and `App.jsx` routing.
    `api.js` gained `getHrContacts`, `uploadHrList`, `setHrContactSent`, and a shared
    `uploadFile()` helper (`uploadResume` now reuses it too).
- **Debug logging**: `server/index.js` has a request-logging middleware on every
  `/api/*` route (method, path, status, timing — `-> GET /api/x` then `<- GET /api/x 200
  (42ms)`). `services/aiClient.js`'s `generateJson()` logs the label + prompt length
  before each call and a truncated response snippet after. Verified live — both fire
  correctly in the server log captured during this session's testing.
- **UI polish**: new `components/StatusBadge.jsx` (color-coded: green=success states,
  blue=in-progress/informational, amber=needs_manual, red=rejected/failed, gray=neutral)
  and `components/Spinner.jsx`. Wired into `AppRow.jsx` (badge + select), `Dashboard.jsx`
  (recent activity feed), plus empty-state messages and spinners replacing bare "Loading..."
  text on `Applications.jsx`, `Jobs.jsx`, `Dashboard.jsx`. New CSS: `.badge*`, `.status-cell`,
  `.empty-state`, `.spinner*` in `styles.css`.
- **Verified live**: killed a stale leftover `node index.js` process that was still bound
  to port 3001 from earlier in the session and silently serving old code (a good reminder
  to always check `netstat`/kill before assuming a fresh start) — restarted with current
  code and confirmed `/api/hr-contacts` returns real JSON, request logging fires, and the
  AI-extraction upload returns a clean 500 (not swallowed) when Gemini's daily quota
  (20/day free tier) was already exhausted from earlier testing in this same session, with
  no `OPENROUTER_API_KEY` configured to fall back to. Verified the DB layer directly
  (insert/dedupe/list/toggle) without AI, since quota was gone for the day — all passed.
  Test contacts and generated test PDF were deleted afterward. `node --check` passed on
  every server `.js` file; `npm run build` (client) succeeded.
- **Not live-tested due to quota exhaustion**: the actual AI-driven HR-list PDF parsing
  end-to-end (route logic is sound and mirrors the already-proven resume-upload pattern,
  but hasn't been observed succeeding against a real PDF with real extracted contacts —
  worth doing once quota resets, or with `OPENROUTER_API_KEY` configured), and the daily
  batch's actual email-sending loop (only the zero-contacts no-op path was observed).

## -2. SESSION 4 SUMMARY

Triggered by a real run hitting two production bugs at once: Gemini free-tier 429s
("Quota exceeded... limit: 5... model: gemini-2.5-flash") and a Mongo error ("Client must
be connected before running operations") under concurrent BullMQ jobs.

- **Fixed the Mongo bug**: `services/applicationStore.js`'s `saveApplication()` defaulted
  to `disconnect: true`, calling `mongoose.disconnect()` (a process-wide singleton) after
  *every* save. Under concurrency > 1, one job's save closing the connection broke every
  other job mid-flight. Changed the default to `disconnect: false`. The one-shot CLI
  scripts that relied on the old auto-disconnect to let the process exit
  (`agent.js`, `autoApply.js`) now call `disconnectApplicationStore()` explicitly in their
  own `finally` block instead — `pipeline.js` already did this correctly.
- **Added an AI fallback provider**: `services/aiClient.js`'s `generateText()` now catches
  Gemini 429/503 errors and retries via OpenRouter if `OPENROUTER_API_KEY` is set,
  instead of failing the whole job. New `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` (default
  `meta-llama/llama-3.3-70b-instruct:free`) env vars in `.env.example`. `createAiClientFromEnv()`
  in `applicationProcessor.js` passes these through. Verified the branch logic with a
  mocked Gemini failure (no real OpenRouter key available to test an actual live call) —
  confirmed it falls back when a key is configured and rethrows cleanly when not.
- **Reduced BullMQ concurrency from 5 to 1** in both `workers/jobWorker.js` and
  `pipeline.js` (`limiter: { max: 4, duration: 60000 }`). Each job makes 5+ sequential
  Gemini calls; running 5 jobs in parallel was instantly exceeding the free tier's
  5-requests/minute cap regardless of any fallback. This is the real fix for the rate
  limiting — the OpenRouter fallback is a safety net for occasional spikes, not a
  substitute for respecting the quota.
- Not yet done: no global cross-job Gemini rate limiter exists (only the BullMQ
  per-job-start limiter) — a single job's 5+ calls back-to-back can still trip Gemini's
  free tier if it's already near the per-minute cap from CLI/manual-apply usage outside
  the worker. Acceptable for now given concurrency is 1, but worth knowing if quota errors
  reappear even with OpenRouter configured.

## -1. SESSION 3 SUMMARY

- **Ran the real pipeline live** against 17 actually-scraped jobs (Naukri/Wellfound
  returned 0 — likely bot-blocked; LinkedIn/Indeed/Internshala returned real jobs). Only
  1 job (RRR, "Web And App Developer", Internshala, score 75) cleared the eligibility
  threshold; the other 16 scored below `MIN_ELIGIBILITY_SCORE` and were correctly skipped
  (no DB record, by design).
- **Found and fixed a real bug while watching that run**: in both
  `applicators/internshala.js` and `applicators/generic.js`, `createBrowserPage()` was
  called *outside* the `try` block. When it failed, the error propagated uncaught,
  crashing the BullMQ job — which left the MongoDB application record permanently stuck
  at `drafted` instead of reflecting the real outcome (`needs_manual`/`auto_applied`).
  Fixed by moving browser creation inside `try` with `let browser` declared outside so
  `finally` can safely guard `if (browser) await browser.close()`. Manually corrected the
  one record this affected (`6a41704d189fd47bd6a42ee5`) from `drafted` to `needs_manual`.
- **Hardened `workers/processor.js`**: the whitelisted auto-apply branch is now wrapped in
  its own try/catch (falls back to `needs_manual` on any unexpected error) so a future
  applicator bug can degrade gracefully instead of crashing the whole job and stranding
  the record again.
- **Added HR-contact finder** (`server/services/hrFinder.js`) — when a scraped job has no
  recruiter email in its JD (common for newly founded startups), the worker now tries, in
  order: (1) find the company's official website via a DuckDuckGo HTML search, then check
  `/`, `/about`, `/about-us`, `/contact`, `/contact-us`, `/team`, `/careers` for a plain
  email; (2) search the company's public GitHub org (org-level email, then up to 5
  members' public profile emails via the unauthenticated GitHub REST API). Deliberately
  does **not** scrape LinkedIn people-search — out of scope per user's explicit choice,
  to stay clear of LinkedIn's anti-scraping posture on individual profiles. Wired into
  `workers/processor.js`: runs before the cold-email decision, so a found email is
  treated exactly like a JD-extracted one (auto cold-emailed). Falls back to the existing
  notification-email behavior when nothing is found.
- **Verified live**: tested `findHrContact` against "Vercel" — confirmed website-finding
  works (`vercel.com` found correctly), but neither the site nor its GitHub org expose a
  public email, which is expected/correct behavior for an established company that
  intentionally hides direct contact info. This feature's real hit rate will be highest
  for small/sparse-presence startups, which is exactly the case it was built for.
- Fixed Playwright ("Executable doesn't exist") by running
  `npx playwright install chromium` — one-time local setup, now documented in README.

## 0. SESSION 2 SUMMARY

This session fixed three live bugs and added a resume-upload feature:
- **Fixed**: `client/index.html` pointed at a non-existent `/src/main.ts` (actual entry is
  `main.jsx`) — caused a white screen in dev. Also removed the `tsc &&` step from
  `client/package.json`'s `build` script since there are no `.ts` files in this project.
- **Fixed**: `workers/jobWorker.js` now probes Redis once before starting a BullMQ
  `Worker`, instead of letting BullMQ's internal duplicate connections retry forever and
  flood the console when Redis isn't running.
- **Fixed**: `server/agent.js` (Phase 1 CLI) was silently broken by an earlier session's
  LaTeX resume change — it still called the old `buildResumePrompt({ baseResume, jdText })`
  shape and read `resumeResult.tailoredResume`, neither of which exist anymore. Switched it
  to the shared `tailorResume()` service, matching every other entry point.
- **Added**: candidate profile is no longer a hardcoded constant. It now lives in
  `server/data/profile.json` (seeded from defaults in `prompts/profile.js`), with a new
  `POST /api/profile/resume` upload endpoint — upload a PDF/DOCX resume, the AI merges it
  into the structured profile, and every future job's eligibility check / tailored resume
  / cold email / cover letter reads the updated profile immediately, no restart needed.
  See section 1 "Resume upload" below for full details.

## 1. PROJECT STATUS

Phase 1 (CLI paste-JD flow) is complete. **Phase 2 restructure into `server/` + `client/`
monorepo is already done** — this section reflects that, since the previous CONTEXT.md
snapshot predated the move and was stale.

Done:
- Repo restructured per `PHASE2_CODEX_PROMPT_v2.md` into:
  - `server/` — Express backend (formerly project root).
  - `client/` — Vite + React frontend.
  - Root `package.json` orchestrates both (`dev`, `dev:server`, `dev:client`, `build`, `start`).
- `server/index.js` — single Express server: mounts all API routes under `/api/*`,
  serves `client/dist` as static build, falls back to `index.html` for client-side routing.
- API routes implemented and working against MongoDB:
  - `GET /api/stats` — totals, today/week email counts, avg eligibility score, 7-day
    email chart data, last 10 recent applications.
  - `GET /api/applications`, `GET /api/applications/:id`, `GET /api/applications/:id/resume`,
    `POST /api/applications/:id/send-email`, `PATCH /api/applications/:id/status`.
  - `GET /api/jobs` — reads `server/data/scraped_jobs.json`.
  - `POST /api/apply` — manual single-job flow via `applicationProcessor.processApplication()`.
  - `POST /api/scrape` + `GET /api/scrape/status/:jobId` — fire-and-forget scrape job with
    in-memory status map (not persisted, resets on server restart).
  - `DELETE /api/reset` — `{ scope: "applications" | "jobs" | "all" }`.
- `server/services/`: `aiClient.js` (Gemini wrapper), `applicationProcessor.js` (shared
  one-job pipeline reused by CLI/auto/dashboard/pipeline), `applicationStore.js` (Mongoose
  model + connection helpers), `emailService.js` (Nodemailer, supports attachments),
  `json.js` (robust AI JSON parsing).
- `server/prompts/`: profile, eligibility, resume, extraction, coldEmail, referral prompt
  builders — all still plain-text/JSON output, **not yet LaTeX-aware** (see Pending).
- `server/scrapers/`: `index.js` (parallel run + dedupe), `naukri.js`, `wellfound.js`,
  `linkedin.js` (logged-out public pages only), `indeed.js`, `internshala.js`,
  `companyPages.js` (reads `data/company_pages.json`), `utils.js` (delays, UA, dedupe,
  email extraction).
- `server/pipeline.js` — BullMQ + Redis orchestrator: loads cached `scraped_jobs.json`
  (reused if <6h old unless `--fresh`), filters by `MIN_ELIGIBILITY_SCORE`, tailors +
  drafts + optionally emails + logs to MongoDB.
- `server/autoApply.js` — processes `server/data/job_queue.json` directly (no scrape step).
- `server/agent.js` — original Phase 1 interactive CLI, unchanged.
- `server/data/`: `job_queue.json`, `apply_whitelist.json`, `company_pages.json`,
  `base_resume.txt`. `scraped_jobs.json` is generated at runtime (gitignored).
- Client (`client/`): Vite + React 19 + react-router-dom + recharts. Pages: Dashboard,
  Jobs, Applications, ManualApply, Settings. Components: Layout, Sidebar, StatsCard,
  EmailChart, AppRow, ResetButton. `client/src/api.js` centralizes fetch calls.
- `.gitignore` (root and `server/`) excludes `node_modules/`, `.env`, generated
  `output/*.txt|*.tex|*.pdf`, `*.log`, `client/dist/`.

Done (this session):
- **LaTeX resume tailoring** is built and verified end-to-end:
  - `server/templates/resume.tex` — placeholder-based ATS template (no fontawesome dep,
    keeps it portable). Placeholders: `EMAIL`, `LINKEDIN_URL`, `GITHUB_URL`,
    `PORTFOLIO_URL`, `SUMMARY`, `SKILLS`, `EXPERIENCE`, `PROJECTS`, `EDUCATION`,
    `ACHIEVEMENTS`.
  - `server/prompts/resumePrompt.js` rewritten to take `{ profile, jdText }` and require
    LaTeX-escaped JSON sections (`summary`/`skills`/`experience`/`projects`/`education`/
    `achievements`/`changesMade`), with explicit honesty + escaping rules.
  - `server/prompts/profile.js` gained a `candidateContact` export (email/LinkedIn/GitHub/
    portfolio URLs) used verbatim in the resume header — not AI-generated, since contact
    info shouldn't be subject to model drift.
  - `server/services/resumeTailor.js` — `tailorResume({ jdText, profile, aiClient,
    outputDir })` fills the template, writes `output/resume_<timestamp>.tex`, then calls
    `compileLatex()` which tries `pdflatex` -> `tectonic` -> the hosted
    `https://latex.ytotech.com/builds/sync` API in order and returns whichever succeeds.
  - `server/services/applicationProcessor.js` now calls `tailorResume()` instead of the
    old plain-text `buildResumePrompt`/`base_resume.txt` flow; `tailoredResumePath` is now
    the PDF path when compilation succeeds (falls back to the `.tex` path with
    `compileError` set if no compiler worked).
  - **Verified live**: ran a real Gemini call + compile with no local LaTeX installed —
    the ytotech fallback produced a valid 71KB PDF (`PDF document, version 1.7`). Test
    script and output were deleted after verification; nothing test-related was committed.
  - `server/data/base_resume.txt` is no longer read by the pipeline (the AI now generates
    all sections directly from `candidateProfile` in `prompts/profile.js`); the file can be
    deleted later, left for now in case anything else still references it.
- **Notifier email** is built and verified live:
  - `server/services/emailService.js` gained a generic `sendHtmlEmail()` export (separate
    from `sendColdEmail()`, which stays plain-text for actual cold outreach).
  - `server/services/notifier.js` exports `sendJobNotification({ company, role, location,
    source, eligibilityScore, eligibilityReason, applyUrl, changesMade, coldEmailSubject,
    coldEmailBody, referralMessage, applicationId, tailoredResumePath, ... })`. Builds a
    dark-themed HTML email (job details table, "Why it matched", Apply now button, key
    changes list, cold email + referral draft boxes in monospace, "Mark as applied" button
    linking to `${DASHBOARD_URL}/applications?highlight=<id>`) and sends it via
    `sendHtmlEmail` with the tailored resume PDF attached.
  - Defaults: `notificationEmail` from `NOTIFICATION_EMAIL` (falls back to `GMAIL_USER`),
    `dashboardUrl` from `DASHBOARD_URL` (falls back to `http://localhost:5173`).
    `DASHBOARD_URL` is a new env var not yet in `.env.example` — add it when wiring this
    into the pipeline.
  - **Verified live**: sent one real test notification (sample job, real Gemini-tailored
    PDF attached) to the inbox configured in `.env`. Confirmed delivered. Test script and
    generated resume artifacts were deleted after verification.
  - Now wired into the hybrid auto-apply decision in `workers/processor.js` (see below).
- **Applicators** — built:
  - `server/prompts/coverLetterPrompt.js` — `buildCoverLetterPrompt()` (120-180 word
    honest cover letter for a form field) and `buildFormAnswerPrompt()` (short answer to
    an arbitrary custom application question), both AI-generated from `candidateProfile`.
  - `server/applicators/internshala.js` — Playwright flow: open `job.applyUrl`, click
    "Apply now", fill the cover-letter textarea, best-effort answer any custom question
    blocks via `buildFormAnswerPrompt`, submit. Gated by `INTERNSHALA_DRY_RUN` (default
    `true` — fills but does not click submit until explicitly set to `false`).
  - `server/applicators/generic.js` — heuristic filler for whitelisted simple company
    pages: matches common input name/id/placeholder text (email, LinkedIn, GitHub,
    portfolio, name) against `candidateContact`, fills the cover letter, attaches the
    tailored resume PDF to a file input if present. Gated by a new `AUTO_APPLY_DRY_RUN`
    env var (default `true`, same semantics as `INTERNSHALA_DRY_RUN`).
  - `server/applicators/index.js` — `loadWhitelist()` / `isWhitelisted(job)` read
    `data/apply_whitelist.json` (source `internshala` -> boolean; source `companyPages`
    -> case-insensitive match against `job.company` in the `companyPages` array).
    `autoApply(job, { aiClient, profile, tailoredResumePath })` is the single entry point:
    refuses (`status: "not_whitelisted"`) unless the source/company is whitelisted, then
    dispatches to the right applicator.
- **BullMQ worker wiring** — done:
  - `server/workers/queue.js` — shared `queueName`, `createConnection()` (ioredis, with a
    `retryStrategy` that gives up after 3 attempts instead of retrying forever and
    spamming logs when Redis isn't running), `createQueue()`.
  - `server/workers/processor.js` — pure `processJob(job)` with no import side effects:
    checks eligibility, calls `processApplication()` (tailors resume, always cold-emails
    if a recruiter email was found), then independently checks `isWhitelisted()` — if
    whitelisted, calls `autoApply()` and sets status to `auto_applied`/`needs_manual`;
    otherwise calls `sendJobNotification()` and sets status to `notified`. This is the
    hybrid logic from spec section 7, now actually wired end-to-end.
  - `server/workers/jobWorker.js` — imports `processor.js` and starts a real BullMQ
    `Worker` as a module-load side effect, wrapped in try/catch so a missing Redis only
    logs a warning rather than crashing the host process.
  - `server/index.js` now does `import('./workers/jobWorker.js')` after `app.listen()`,
    exactly per the spec skeleton, with `.catch()` so a load failure doesn't take down
    the API.
  - `server/pipeline.js` refactored to reuse `workers/queue.js` + `workers/processor.js`
    instead of duplicating Queue/Worker setup and hybrid logic inline. Behavior is
    unchanged from the user's perspective (`npm run pipeline` / `pipeline:fresh`).
  - **Verified live**: started `server/index.js` with no Redis running — server stayed up,
    `GET /api/stats` responded correctly, worker logged connection-refused warnings but
    did not crash the process. `node --check` passed on every `.js` file in the repo.
  - **Found and fixed an unrelated pre-existing bug** while verifying: `server/index.js`'s
    catch-all route used `app.get('*', ...)`, which crashes immediately on Express 5 +
    path-to-regexp v6 (`Missing parameter name at index 1: *`). Changed to
    `app.get('/*splat', ...)`, the Express 5-compatible wildcard syntax. The server could
    not start at all before this fix — worth knowing if anything else still assumes the
    old Express 4 `'*'` syntax elsewhere.
- `server/output/` currently only contains plain-text resumes from earlier (pre-LaTeX) runs.
- **Resume upload** (new this session):
  - `server/prompts/profile.js` now only exports defaults (`DEFAULT_PROFILE_TEXT`,
    `DEFAULT_CONTACT`) — it is no longer the runtime source of truth.
  - `server/services/profileStore.js` — seeds `server/data/profile.json` from those
    defaults on first run (gitignored — contains personal data). Exports
    `getCandidateProfile()`, `getCandidateContact()`, `getProfileMeta()`, and
    `updateCandidateProfile({ profileText, contact })`. All in-memory, cached after first
    read, updated synchronously on write — no restart needed after an upload.
  - `server/services/resumeParser.js` — `extractResumeText(buffer, mimetype, filename)`
    using `pdf-parse` v2's class-based `PDFParse` API (`new PDFParse({ data: buffer
    }).getText()` — NOT the old v1 `pdfParse(buffer)` function call, which doesn't exist
    in the installed version) for PDFs, and `mammoth.extractRawText({ buffer })` for DOCX.
  - `server/prompts/profileExtractionPrompt.js` — merges newly extracted resume text into
    the existing profile via Gemini, keeping the same compact label-value style and
    honesty rules as the rest of the prompts.
  - `server/routes/profile.js` — `GET /api/profile` (current profile + `updatedAt`),
    `POST /api/profile/resume` (multipart `resume` field, `multer` memory storage, 10MB
    limit) → extract text → AI merge → persist → return updated profile.
  - Every consumer that used to `import { candidateProfile / candidateContact } from
    '../prompts/profile.js'` was switched to call `getCandidateProfile()` /
    `getCandidateContact()` from `profileStore.js` instead: `applicationProcessor.js`,
    `resumeTailor.js`, `applicators/generic.js`, `workers/processor.js`, and `agent.js`.
  - `client/src/pages/Settings.jsx` — added a Resume section: file input (PDF/DOCX),
    upload status, last-updated timestamp, and a read-only preview of the current profile
    text. `client/src/api.js` gained `getProfile()` and `uploadResume(file)` (the latter
    posts `FormData`, deliberately not using the shared `api()` helper since that forces
    a JSON content-type header which would break the multipart boundary).
  - New dependencies added at the repo root: `multer`, `pdf-parse` (v2.4.5), `mammoth`.
  - **Verified live**: ran the full flow — tailored a sample resume to PDF, uploaded it
    through `POST /api/profile/resume` against a running server, confirmed the AI merged
    it into `profile.json` correctly (added a "DevOps & Containerization: Docker,
    Kubernetes" line and a new project from the test PDF), then restored the real
    profile.json from a backup taken before the test. `node --check` passed on every
    `server/*.js` file; `npm run build` (client) succeeded.

Pending (carried over, still true):
- Flip `INTERNSHALA_DRY_RUN` / `AUTO_APPLY_DRY_RUN` to `false` only after watching the
  dry-run fill behavior 5-10 times, per the spec's non-negotiable rule 4.
- Run `npm run auto` (now `cd server && npm run auto`, or via root scripts once added)
  against a real queued job.
- Run scrape and inspect `server/data/scraped_jobs.json`; selectors may need tuning.
- Run Redis locally before using the pipeline or expecting `POST /api/scrape` to actually
  process jobs end-to-end (currently only triggers scraping; queueing scraped jobs for
  the worker still needs to be wired into `routes/scrape.js` — see Known Issues).
- Fill in real `SCRAPE_KEYWORDS`, `SCRAPE_LOCATION`, `SCRAPE_LIMIT`,
  `MIN_ELIGIBILITY_SCORE` in `server/.env`.
- Replace `server/data/base_resume.txt` with Ritesh's final resume, or delete it now that
  nothing reads it.

## 2. FOLDER STRUCTURE

```text
e:\agent
|-- package.json                 # Root orchestration: dev/build/start scripts for server+client.
|-- package-lock.json
|-- .gitignore
|-- CONTEXT.md
|-- PHASE2_CODEX_PROMPT_v2.md     # Master restructure spec (source of truth for remaining work).
|
|-- server/
|   |-- .env                      # Real credentials; ignored by git.
|   |-- .env.example
|   |-- .gitignore
|   |-- package.json              # Server's own deps (express, mongoose, bullmq, playwright, etc.).
|   |-- index.js                  # Express entry point; serves API + client/dist.
|   |-- agent.js                  # Phase 1 interactive CLI, unchanged.
|   |-- autoApply.js              # Processes data/job_queue.json directly.
|   |-- pipeline.js               # BullMQ scrape->filter->tailor->apply/email orchestrator.
|   |-- scrape.js                 # Scrape-only entry point.
|   |-- routes/
|   |   |-- stats.js
|   |   |-- applications.js
|   |   |-- jobs.js
|   |   |-- apply.js
|   |   |-- scrape.js             # Writes scraped_jobs.json; does NOT enqueue to BullMQ yet.
|   |   `-- reset.js
|   |-- scrapers/
|   |   |-- index.js              # scrapeAll() — parallel + dedupe.
|   |   |-- naukri.js
|   |   |-- wellfound.js
|   |   |-- internshala.js
|   |   |-- linkedin.js           # Public pages only, no login.
|   |   |-- indeed.js
|   |   |-- companyPages.js       # Reads data/company_pages.json.
|   |   `-- utils.js
|   |-- applicators/
|   |   |-- index.js              # loadWhitelist()/isWhitelisted()/autoApply() router.
|   |   |-- internshala.js        # Dry-run by default (INTERNSHALA_DRY_RUN).
|   |   `-- generic.js            # Dry-run by default (AUTO_APPLY_DRY_RUN).
|   |-- workers/
|   |   |-- queue.js              # Shared BullMQ Queue/connection factory.
|   |   |-- processor.js          # Pure processJob() — hybrid auto-apply decision.
|   |   `-- jobWorker.js          # Side-effect: starts the in-process Worker.
|   |-- services/
|   |   |-- aiClient.js           # Gemini wrapper, default model gemini-2.5-flash.
|   |   |-- applicationProcessor.js  # Shared one-job pipeline used everywhere.
|   |   |-- applicationStore.js   # Mongoose schema + connection helpers.
|   |   |-- emailService.js       # Nodemailer; sendColdEmail (text) + sendHtmlEmail.
|   |   |-- resumeTailor.js       # LaTeX fill + pdflatex/tectonic/ytotech compile chain.
|   |   |-- notifier.js           # sendJobNotification() HTML email.
|   |   `-- json.js               # Robust AI JSON response parser.
|   |-- prompts/
|   |   |-- profile.js            # candidateProfile text + candidateContact object.
|   |   |-- eligibilityPrompt.js
|   |   |-- resumePrompt.js       # LaTeX-aware JSON sections.
|   |   |-- coverLetterPrompt.js  # Cover letter + form-answer prompts for applicators.
|   |   |-- coldEmailPrompt.js
|   |   |-- referralPrompt.js
|   |   `-- extractionPrompt.js
|   |-- templates/
|   |   `-- resume.tex            # Placeholder-based LaTeX resume template.
|   |-- data/
|   |   |-- job_queue.json
|   |   |-- apply_whitelist.json  # Read by applicators/index.js.
|   |   |-- company_pages.json
|   |   |-- base_resume.txt       # No longer read by anything; safe to delete/replace.
|   |   `-- scraped_jobs.json     # Generated at runtime; gitignored.
|   `-- output/                   # Tailored resume .tex/.pdf (gitignored) + old .txt files.
|
`-- client/
    |-- package.json              # React 19, react-router-dom, recharts, vite, typescript.
    |-- vite.config.* 
    |-- index.html
    `-- src/
        |-- main.jsx
        |-- App.jsx
        |-- api.js                # Centralized fetch helpers.
        |-- pages/
        |   |-- Dashboard.jsx
        |   |-- Jobs.jsx
        |   |-- Applications.jsx
        |   |-- ManualApply.jsx
        |   `-- Settings.jsx
        |-- components/
        |   |-- Layout.jsx
        |   |-- Sidebar.jsx
        |   |-- StatsCard.jsx
        |   |-- EmailChart.jsx
        |   |-- AppRow.jsx
        |   `-- ResetButton.jsx
        `-- styles.css
```

All Phase 2 spec files listed above now exist. Remaining gap: `POST /api/scrape` does not
yet enqueue scraped jobs onto the BullMQ queue for `workers/jobWorker.js` to process — it
only writes `scraped_jobs.json`. Today the queue is only fed by running `pipeline.js`
directly (which both scrapes/loads cache and enqueues). Wiring `routes/scrape.js` to also
enqueue would let "Run full pipeline now" in the dashboard trigger the complete hybrid flow.

`node_modules/` (root, `server/`, `client/`) exist after install; omitted above.

## 3. KEY DECISIONS

- Kept `server/agent.js` (old Phase 1 CLI) unchanged — restructure only moved its location,
  did not touch its logic, per the non-negotiable rule in `PHASE2_CODEX_PROMPT_v2.md`.
- `services/applicationProcessor.js` remains the single shared pipeline for CLI/auto/
  dashboard-replacement-API/pipeline, avoiding duplicated eligibility/tailor/draft logic.
- Express (`server/index.js`) is the "one common server" — serves `/api/*` and the built
  React app from the same origin/port in production, eliminating the CORS issue the old
  vanilla-JS dashboard had (that dashboard has been removed entirely).
- Scrape jobs run in-memory status tracking (`Map` in `routes/scrape.js`) rather than
  persisted state — acceptable for single-user local use, resets on restart.
- `apply_whitelist.json` and `company_pages.json` were created as data files ahead of the
  applicators/scrapers that will consume them, so the schema is locked in early.
- LaTeX resume generation, notifier emails, applicators, and BullMQ worker wiring were
  built in spec build-order across this and the prior session (steps 4-10 of section 11
  in `PHASE2_CODEX_PROMPT_v2.md` are now functionally complete; step 9 — remaining
  scrapers — was already done before this session).
- Split `workers/processor.js` (pure, no side effects) from `workers/jobWorker.js` (starts
  the actual `Worker` as an import side effect) so `pipeline.js` could reuse the exact
  same hybrid-decision logic without triggering a second competing worker instance.
- `applicators/generic.js` uses its own `AUTO_APPLY_DRY_RUN` flag rather than reusing
  `INTERNSHALA_DRY_RUN`, since the spec's dry-run rule applies to all auto-apply, not just
  Internshala, and the two site types fail very differently (a wrong generic submit on an
  arbitrary company page is riskier than on Internshala's known form).
- Fixed `app.get('*', ...)` -> `app.get('/*splat', ...)` in `server/index.js`: Express 5
  (already a dependency) ships path-to-regexp v6, which rejects the old bare `'*'`
  wildcard. This was a pre-existing bug, not something introduced this session, but it
  meant `server/index.js` could not start at all — caught while verifying worker wiring.

## 4. PENDING TASKS (next, in spec build-order priority)

1. ~~Build LaTeX resume tailoring~~ — done.
2. ~~Wire tailored PDF into `POST /api/apply` and ManualApply page~~ — already worked
   with no changes needed: `routes/applications.js` `:id/resume` route already serves
   `.pdf` with the right content-type, and `ManualApply.jsx` already links to it.
3. ~~Build `server/services/notifier.js`~~ — done, and now wired into the hybrid decision.
4. ~~Build `server/applicators/`~~ — done, dry-run by default.
5. ~~Move BullMQ setup into `server/workers/`, started in-process from `server/index.js`~~
   — done.
6. Wire `routes/scrape.js` to enqueue scraped jobs onto the BullMQ queue (currently it
   only writes `scraped_jobs.json`) so the dashboard's "Run full pipeline now" button can
   trigger the complete hybrid scrape -> eligibility -> tailor -> email/apply/notify flow
   without needing to run `pipeline.js` from a terminal.
7. Add Settings page wiring for whitelist/company-pages/keyword edits (UI exists, needs
   to confirm it's actually calling real endpoints — verify before assuming done).
8. Start Redis locally (e.g. via Docker) and do a real end-to-end dry run of
   `npm run pipeline` against 1-2 real scraped jobs to watch the hybrid decision and
   dry-run form fills before considering this production-ready.
9. Verify `npm run build` (root) produces `client/dist/` and `server/index.js` serves it
   with no CORS issues end-to-end.
10. Carried over: run scrape/pipeline against real data, tune scraper selectors, fill in
    real `.env` values, delete or replace `base_resume.txt` (nothing reads it anymore).

## 5. KNOWN ISSUES

- `readline/promises` with piped/non-TTY stdin is broken on this Windows/Node setup —
  always run `agent.js` interactively, never via shell piping.
- Scrapers may return few/zero jobs depending on bot detection, auth walls, or markup
  changes — expected, handle via selector tuning, not a regression.
- LinkedIn scraper is read-only, logged-out only; skips anything behind a login wall.
- `pipeline.js` and `workers/jobWorker.js` both require Redis at `REDIS_URL` to actually
  process anything; without it, `server/index.js` still starts fine (the worker module
  catches the connection failure and just logs warnings) but no queued job ever runs.
- Dashboard reset only clears MongoDB `applications`; never deletes `server/output/` files.
- Resend email requires `recruiterEmail` + `coldEmailSubject`/`coldEmailBody` on the
  record; very old Phase 1-style records may lack these fields.
- MongoDB Atlas cluster is shared with an unrelated personal project — keep
  `MONGO_DB_NAME=job_application_agent` to avoid collisions.
- `gemini-1.5-flash` is retired (404) — use `gemini-2.5-flash` or newer.
- `GET /api/scrape/status/:jobId` state is in-memory only and lost on server restart.
- `POST /api/scrape` does not enqueue jobs onto the BullMQ queue — only `pipeline.js`
  does. The dashboard's "Run full pipeline now" button (if/when built on Settings/Jobs)
  will need `routes/scrape.js` updated to also enqueue, or it will silently do nothing
  beyond writing `scraped_jobs.json`.
- `applicators/internshala.js` and `applicators/generic.js` are unverified against real
  pages (no Playwright run was performed against a live Internshala/company page this
  session, since that would risk an unintended real submission) — selectors are
  best-effort and should be watched closely in dry-run mode before trusting them.
- `applicators/generic.js`'s field-matching is heuristic (label/name/id/placeholder regex)
  and will miss or mis-fill fields on company pages with non-standard markup — expected,
  not a bug; that's why it always stays in dry-run until manually verified per page.

## 6. HOW TO RUN

Install dependencies (root, server, client each have their own `package.json`):

```bash
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

Create `server/.env` from the template:

```powershell
Copy-Item server/.env.example server/.env
```

Dev mode (Express on :3001 + Vite on :5173, proxied):

```bash
npm run dev
```

Production-style single-port run (build client, then serve from Express):

```bash
npm run build
npm start
```

Phase 1 interactive CLI (run from `server/`):

```bash
cd server
npm run cli
```

Auto mode from queue:

```bash
cd server
npm run auto
```

Scrape jobs only:

```bash
cd server
npm run scrape
```

Full BullMQ pipeline (requires Redis running locally):

```bash
cd server
npm run pipeline
npm run pipeline:fresh   # force a new scrape instead of using cached scraped_jobs.json
```

## 7. ENV VARIABLES NEEDED (`server/.env`)

- `PORT` — Express port, default `3001`.
- `NODE_ENV` — `development` | `production`.
- `AI_PROVIDER` — `gemini`.
- `GEMINI_API_KEY` — Gemini API key.
- `GEMINI_MODEL` — default `gemini-2.5-flash` (1.5-flash is retired).
- `MONGO_URI`, `MONGO_DB_NAME` — default DB name `job_application_agent`.
- `GMAIL_USER`, `GMAIL_APP_PASSWORD` — cold-email + notifier sender (`riteshkr0759@gmail.com`).
- `GMAIL_REFERRAL_USER`, `GMAIL_REFERRAL_APP_PASSWORD` — referral sender, still not consumed
  by any service code (reserved for a future dual-sender split).
- `SCRAPE_KEYWORDS`, `SCRAPE_LOCATION`, `SCRAPE_LIMIT`, `MIN_ELIGIBILITY_SCORE`.
- `REDIS_URL` — required for `pipeline.js` and `workers/jobWorker.js` to actually process
  jobs (server still starts without it, just logs warnings).
- `INTERNSHALA_DRY_RUN` — gates `applicators/internshala.js`; must stay `true` until the
  dry-run fill has been watched 5-10 times.
- `AUTO_APPLY_DRY_RUN` — gates `applicators/generic.js`; same default-`true` rule. New
  this session — added to `server/.env.example`.
- `NOTIFICATION_EMAIL` — destination for notifier emails (defaults to `GMAIL_USER` if unset).
- `DASHBOARD_URL` — base URL used for the "Mark as applied" link in notifier emails;
  defaults to `http://localhost:5173`.
- `LATEX_COMPILER` — `auto | pdflatex | tectonic | ytotech`. `auto` (the default) tries
  `pdflatex` -> `tectonic` -> the hosted ytotech API in order.

## 8. VERIFICATION COMPLETED

- Confirmed via direct filesystem inspection that the `server/` + `client/` restructure
  matches `PHASE2_CODEX_PROMPT_v2.md` section 3.
- Confirmed all 6 API route files contain real Mongoose/scraper-backed logic, not stubs.
- Confirmed client has all 5 pages and 6 components scaffolded with recharts/router deps.
- LaTeX tailoring: ran a real Gemini call with no local LaTeX installed; the ytotech
  fallback produced a valid 71KB PDF. Test script and artifacts deleted afterward.
- Notifier: sent one real HTML notification email (with a real tailored PDF attached) to
  the configured inbox and confirmed delivery with the user. Test script and artifacts
  deleted afterward.
- Worker wiring: ran `node index.js` with no Redis running — server stayed up,
  `GET /api/stats` responded with real MongoDB data, worker logged connection-refused
  warnings without crashing the process.
- `node --check` passed on every `.js` file in the repo (root excluding `node_modules/`)
  after all changes in this session.
- Not yet verified live: a real Playwright run of either applicator against a live page,
  and a full `pipeline.js` run with Redis actually running.
