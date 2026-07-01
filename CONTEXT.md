# Job Application Agent Context

## ⚠️ INCIDENT — starting the server can trigger a real 20-email send

**If you (or a future AI session) need to start `node index.js` for any reason — even
just to test an unrelated read-only route — be aware: `server/index.js` unconditionally
calls `runDailyHrBatch()` on every startup (Session 8's design). If today's automatic
batch hasn't run yet, starting the server immediately sends real cold emails to up to 20
real HR contacts, with no confirmation prompt.** This bit during Session 10/Step 4: the
server was started solely to verify a new `GET /api/scrape/runs` route, and because the
calendar day had rolled over with no batch run yet, it silently fired the real daily
send — 20 real emails went out before anyone noticed. Letting it finish was the safer
choice once discovered (killing it mid-run would have skipped persisting `lastRunDate`,
risking an even bigger duplicate send on the next restart). Full details in the Session
10 entry below. **Lesson for next time: before starting `node index.js` for any reason,
check `server/data/hr_batch_state.json`'s `lastRunDate` first** — if it's not today, the
startup is going to send real email, full stop, regardless of why you're starting it.

## -8. SESSION 10 SUMMARY (most recent — read this first) — PHASE 3 IN PROGRESS

Started `PHASE3_CLAUDE_PROMPT.md` (credential vault, per-platform applicators, company
watchlist, scrape visibility). Following its explicit build order one step at a time,
verifying each before proceeding, per its own instructions ("do not skip ahead, do not
batch multiple steps").

**Step 1 — fixed the enqueue bug (done, verified):**
- `server/routes/scrape.js` now imports `createQueue` from `workers/queue.js` (one
  instance at module scope, not per-request) and, after writing `scraped_jobs.json`,
  enqueues every scraped job (`queue.add(..., {removeOnComplete: true, removeOnFail:
  true})`, mirroring `pipeline.js`'s pattern). Previously this route only wrote the file
  and never touched the queue — the dashboard's "Run full pipeline now" button did
  nothing beyond scraping.
- Verified without risking a real cold email: used a disposable BullMQ queue name (not
  the real `job-application-pipeline`) to prove `createConnection()` + `Queue.add()` +
  `getJobCounts()` work correctly against Redis, plus a read-only peek at the real
  queue's (idle) state. Did not trigger a live scrape through the running server's actual
  worker for this step.

**Step 2 — scrape reporter + per-run logs (done, verified):**
- `server/services/scrapeReporter.js` — new `ScrapeRun` class (extends `EventEmitter`):
  `sourceStarted/sourceProgress/sourceDone/sourceFailed/sourceSkipped(...)` methods, plus
  `finish({totalJobs, deduplicated})` which writes `data/scrape_runs/run_<id>.json`
  (gitignored) in the exact shape the spec defined. Also exports `listScrapeRuns(limit)`.
- `scrapers/index.js`'s `scrapeAll()` now accepts an optional `reporter` in its options
  object — times each source's start/success/failure and reports it. Fully
  backward-compatible (reporter is optional, guarded by `?.`).
- Wired into both real call sites: `routes/scrape.js` and `pipeline.js` each create a
  `new ScrapeRun()` and pass it through.
- Verified live with a real (queue-free, so zero side-effect risk) scrape call: events
  fired in order, the written JSON matched the spec's format exactly, `listScrapeRuns()`
  read it back correctly. Test run log deleted afterward.

**Step 3 — SSE live progress endpoint (done, verified):**
- `scrapeReporter.js` gained an exported `scrapeHub` (`EventEmitter` singleton) — every
  `ScrapeRun` instance broadcasts its events onto this shared hub (via a new internal
  `_broadcast()` helper that emits on both `this` and `scrapeHub`, tagging the payload
  with `runId`). This means an SSE client that connects *before* a scrape starts still
  sees that run's events once it begins — it doesn't need to know about a specific run
  instance, just the hub.
- `routes/scrape.js` — new `GET /status/stream` (SSE). **Registered before** `GET
  /status/:jobId` — same path depth, so if registered after, Express would have matched
  `/status/stream` as that route with `jobId="stream"` instead of reaching this one.
  Subscribes to all 6 event types on `scrapeHub`, writes proper `event:`/`data:` SSE
  frames, sends a `: heartbeat` comment every 20s (keeps proxies from timing out an idle
  connection), and cleans up its listeners on `req.on('close')`.
- **Verified live end-to-end with `curl -N`**, exactly as the spec asked: temporarily
  stopped Redis (so no worker would be active to actually process anything — confirmed
  via the existing startup probe gracefully no-op'ing), started a fresh server, opened
  the SSE stream, then POSTed a real scrape (`keywords=backend developer, limit=3`, all
  6 sources since the route doesn't accept a `sources` filter yet). Watched real-time
  `source-started` for all 6 sources, `source-done` as each finished (with real counts:
  internshala 3, indeed 1, linkedin 3, naukri/wellfound/companyPages 0), a heartbeat
  in between, and a final `run-complete` with the full summary (7 total, 7 deduplicated).
  Confirmed the route's later enqueue step failed cleanly (Redis down) without crashing
  anything (`GET /status/:jobId` correctly reported `status: "failed"`,
  `error: "connect ECONNREFUSED..."`). Restored Redis and restarted the server normally
  afterward; test run log files deleted.
- **Minor noise found, not yet fixed**: `routes/scrape.js`'s module-level `queue =
  createQueue()` doesn't do the same "probe Redis once before creating anything" dance
  `workers/jobWorker.js` does — when Redis is down at server startup, this produces a
  handful of bounded (stops after 3 retries) but slightly noisy connection-error log
  lines. Not blocking, just worth applying the same fix pattern here later if it bothers
  anyone.

**Step 4 — ScrapeStatus.jsx React page (done, verified):**
- `routes/scrape.js` gained `GET /runs?limit=` (default 10, max 50) — thin wrapper over
  `listScrapeRuns()`. Needed for the page's history section, not explicitly named as a
  route in the spec but implied by "history section below: last 10 runs."
- `components/StatusBadge.jsx` — added `running` (blue) and `success` (green) to its
  color map, reusing the existing badge component instead of building a separate one
  for scrape-source statuses.
- `components/ScrapeRunCard.jsx` — one card per source: name, status badge, a simple
  width-based progress bar (0%/50%/100% for waiting/running/done — not a real percentage,
  just a visual state indicator), and a status line (jobs found + duration, or the error).
- `pages/ScrapeStatus.jsx` — "Start new scrape" form (keywords/location/limit, all
  optional) at top, a live grid of `ScrapeRunCard`s (one per known source, starts in
  "waiting" state) wired to a native `EventSource('/api/scrape/status/stream')` — uses
  `addEventListener` per named event type (`source-started`/`source-done`/
  `source-error`/`source-skipped`/`run-complete`), exactly per the spec's "vanilla
  EventSource, no extra library" instruction. `run-complete` triggers a re-fetch of run
  history. History section below uses `<details>/<summary>` per run (no extra state
  needed) showing a per-source breakdown table.
- `api.js` gained `getScrapeRuns(limit)`. Added to `App.jsx` routing and `Sidebar.jsx`
  nav as "Scrape Status" / `/scrape-status`.
- **Verified**: `npm run build` (client) succeeded. Server-side: confirmed
  `GET /api/scrape/runs` responds correctly (`{"runs":[]}` when none exist — matches the
  page's empty-state handling) against a live server.

**⚠️ Real-world incident during this step's verification — see the top-of-file warning.**
Starting `node index.js` solely to test the new `/runs` route triggered Session 8's
unconditional startup call to `runDailyHrBatch()`. The calendar day had rolled over
(2026-06-29 -> 2026-06-30) with no batch run yet today, so it fired for real: **20 actual
cold emails sent to 20 real HR contacts** (Adroitech Engg, Airwood, Aithent Technologies,
Alcatel/NOKIA, Alliance Group, Amara Raja Group, Amazon, Ameex Technologies, American
Megatrends, Apollo Tyres, Aricent Technologies, ASG Technologies, Aspire Systems, Athena
Health, Axis Bank, Barry Wehmiller, Berger Paints, Bhansali Engineering Polymers, Black
Bird Solutions, BNP Paribas), using the real uploaded resume
(`Ritesh_Kumar_Resume_Backend (1).pdf`), all 20/20 sent successfully, 0 failed. Once
noticed mid-run, the decision was to let it finish rather than kill it — killing it
would have skipped writing `lastRunDate`, which would have made the *next* server start
fire another full batch on top of this one (worse). `hr_batch_state.json` now correctly
shows `lastRunDate: "2026-06-30"`, so it will not fire again today. `hr-contacts/status`
confirms: `total: 123, sentCount: 25, sentToday: 20, remaining: 98`. This was within the
system's normal designed behavior (20/day automatic), just triggered earlier/differently
than the user would have expected from an unrelated server start — not a bug in the
batch logic itself, but a real gap in situational awareness before running `node
index.js` casually. User was informed immediately and transparently.

**Follow-up confirmed safe**: before Step 5, the user asked to verify the daily-batch
guard wouldn't fire repeatedly on same-day restarts. Re-read the code (the `state.
lastRunDate === today` check at the top of `runDailyHrBatch()` returns early before
touching any contact), then proved it live: restarted the server once more — log showed
only `"already ran today, skipping"`, `hr-contacts/status` confirmed `sentCount`
unchanged at 25 (no new sends). Noted the actual machine clock (what the code uses) can
differ from the conversation's stated "current date" context value — always check the
real clock (`node -e "console.log(new Date().toISOString())"`) and `hr_batch_state.json`
together before starting the server, not just one or the other.

**Step 5 — Credential vault (done, verified):**
- `server/services/credentialStore.js` — new. `server/data/credentials.json`
  (gitignored), seeded with `{ indeed: {email:'', enabled:false}, naukri: {email:'',
  enabled:false} }` on first read. `getCredentials/setCredentials/deleteCredentials/
  listPlatforms()`. Every entry defaults `enabled: false` — the hard safety gate from the
  spec; nothing can attempt a login without the user explicitly flipping this from the
  Credentials page.
  - **Encryption**: AES-256-GCM via `CREDENTIAL_VAULT_KEY` (32-byte hex, new `.env.example`
    entry with the generation command inline). If missing or malformed (wrong byte
    length), falls back to plain-text storage with a loud one-time console warning —
    exactly the documented trade-off from the spec (file is gitignored either way).
    `setCredentials` preserves the existing password/encryption fields when a caller
    updates only `email`/`enabled` without resending a password.
  - **Verified directly** (no server needed): plain-text round-trip when no key set,
    encrypted round-trip with a freshly generated real key (confirmed the on-disk
    `password` field is hex ciphertext, not plaintext, and `encrypted: true`), and the
    malformed-key fallback path (warns, still works, stores plain). All three paths
    correct.
- `server/services/sessionManager.js` — new. `getSession/saveSession/isSessionFresh`
  (cookies in `data/sessions/<platform>.json`, gitignored, default `maxAgeDays: 7`).
  `canAttemptLogin/loginAndSave` — login throttling (`MIN_HOURS_BETWEEN_LOGINS`, new env
  var, default 6) tracked in a separate `data/sessions/<platform>.throttle.json`,
  checked on *every* login attempt (not just successes) so a string of failures can't be
  retried rapidly — matches the spec's anti-detection hygiene requirement exactly.
  `ensureSession()` implements the 3-step flow from spec section 5c (fresh session ->
  reuse; enabled creds -> login+save; neither -> clear error) — ready for steps 6-7 to
  call once real `login()` functions exist per platform.
- `server/routes/credentials.js` — `GET /` (list, password never included — only
  `hasPassword`/`encrypted` booleans), `PUT /:platform`, `DELETE /:platform`,
  `POST /:platform/test-login`. The test-login route dynamically imports
  `../applicators/<platform>.js` and checks for an exported `login()` — since
  Indeed/Naukri applicators don't exist yet (steps 6-7), it currently always returns a
  clean `501` rather than pretending to attempt anything. Routes through
  `sessionManager.loginAndSave()` so throttling applies to test-login too, not just real
  apply-time logins. Uses a **headed** (not headless) browser per the spec, so the user
  can visually confirm + handle any captcha themselves once a real login exists.
- `scrapers/utils.js`'s `createBrowserPage()` gained an optional `{ headless = true }`
  param (backward-compatible — every existing call site uses the no-arg form and is
  unaffected) so the credentials route could request a headed browser without a separate
  helper.
- `client/pages/Credentials.jsx` — one panel per platform (Indeed, Naukri): email/password
  inputs, "Enabled" checkbox (defaults off), Save/Clear/Test login buttons, a session
  status badge ("Session fresh (Nd ago)" / "No session" / "Session expired"). The exact
  warning banner from the spec at the top. `api.js` gained
  `getCredentials/setCredentials/deleteCredentials/testLogin`. Added to `App.jsx` routing
  and `Sidebar.jsx` nav as "Credentials" / `/credentials`.
- **Verified live** (confirmed `lastRunDate` matched today first, so the restart was
  safe — see above): `GET /api/credentials` lists both platforms correctly; `PUT` saves
  and the follow-up `GET` confirms the password never leaks back (`hasPassword: true`,
  no `password` field); `POST /:platform/test-login` correctly 501s since no applicator
  exists yet; `DELETE` removes the entry and a subsequent `GET` re-seeds the default.
  Test credentials cleared from `data/credentials.json` afterward. `npm run build`
  (client) succeeded; all server files `node --check` clean.

**Step 6 — Indeed applicator with DRY_RUN (built, partially verified — see limitation below):**
- `applicators/captchaGuard.js` — new, shared by Indeed now and Naukri later.
  `isCaptchaPresent(page)` checks the URL and a handful of common captcha selectors
  (`.g-recaptcha`, `iframe[src*="captcha"]`, etc). `handleCaptcha(page, platform)`
  screenshots to `data/captcha_<platform>_<timestamp>.png` (gitignored), emails
  `NOTIFICATION_EMAIL` with the screenshot attached via `sendHtmlEmail`, and returns
  `{status: "captcha_blocked"}` for the applicator to return directly — never attempts
  to solve anything, per the non-negotiable rule.
- `applicators/indeed.js` — new. `login(page, {email, password})` (throws on captcha or
  missing fields, returns cookies on success) and `apply(page, job, resumePath)`
  (Easy Apply: click in, upload resume, fill an AI-generated cover letter if a cover
  letter field exists, best-effort AI-answer up to 8 visible question fields, advance
  through up to 6 "Continue"/"Next" steps, then either stop — `INDEED_DRY_RUN=true`,
  the default — or click final submit). Captcha-checked at every step transition, not
  just once at the start.
- `applicators/index.js` — `isWhitelisted()` now also checks `indeed` against
  `apply_whitelist.json` (the key already existed in the file from Phase 2, just unused
  until now — still `false` by default). New `applyIndeedWithSession()` owns the
  browser/page lifecycle for Indeed specifically (unlike Internshala/generic, which are
  stateless per job) — gets credentials via `credentialStore`, calls
  `sessionManager.ensureSession()` (reuses a fresh cookie session or logs in fresh,
  throttled), applies the cookies to the page context, then calls `indeed.apply()`.
- `services/applicationStore.js` — added `captcha_blocked` to the `Application` schema's
  status enum.
- `workers/processor.js` — fixed a real bug this surfaced: it was collapsing every
  applicator result down to just `auto_applied`/`needs_manual` based on the `applied`
  boolean, which would have silently mislabeled a captcha-blocked job as `needs_manual`
  with no indication a captcha was ever involved. Now checks
  `applyResult.status === 'captcha_blocked'` first and preserves it.
- **What was verified** (all without touching real Indeed, since no real credentials are
  configured and the whitelist is `false` by default): `node --check` on every new/changed
  file; confirmed `isWhitelisted({source:'indeed', ...})` returns `false` and
  `autoApply()` short-circuits to `not_whitelisted` *without ever launching a browser* —
  i.e. this entire feature is a complete no-op in the current default config, even though
  the code now fully exists; confirmed `INDEED_DRY_RUN`'s default-true / explicit-false
  logic directly; confirmed `isCaptchaPresent()`'s URL- and selector-matching logic
  against mocked `page` objects (no real browser needed for this part).
- **What was explicitly NOT verified, and cannot be by an AI session**: the spec's Step 6
  instruction is "run headed Playwright manually, watch it open Indeed, navigate to a
  job, fill the form, NOT submit — confirm 5-10 times before marking trustworthy." That
  requires a human watching a browser window in real time, especially to judge Indeed's
  actual current selectors/flow (which this code's selectors are a best-effort guess at,
  not confirmed against the live site) and to handle any captcha Indeed throws up. **This
  applicator should not be trusted, and `apply_whitelist.json`'s `indeed` flag should stay
  `false`, until the user has actually watched it run** (set `INDEED_DRY_RUN=true` (already
  default), configure real credentials via the Credentials page, temporarily flip
  `indeed: true` in the whitelist for a controlled single-job test, and watch).

**Step 7 — Naukri applicator with DRY_RUN (built, partially verified — same human-verification limitation as Step 6):**
- `applicators/naukri.js` — new. `login(page, {email, password})` mirrors Indeed's
  structure (captcha-checked at every step, throws on failure, returns cookies on
  success) against `naukri.com/nlogin/login`'s expected field selectors.
  `apply(page, job, resumePath)` is structurally simpler than Indeed's multi-step Easy
  Apply, per the spec: click "I am Interested"/"Apply", detect an external-ATS redirect
  and stop (`needs_manual`, doesn't guess at an unknown third-party form), otherwise
  upload the resume + best-effort AI-answer visible questions, then submit if a further
  form exists or treat the original click as the whole application if not.
- **Caught and fixed a real safety bug in my own first draft before it ever ran**: Naukri's
  "I am Interested" button is frequently the *entire* application by itself (the spec
  says this explicitly) — but my first draft clicked it unconditionally and only gated a
  later "Submit" button that, on many jobs, doesn't even exist. That meant DRY_RUN would
  have performed a real, irreversible apply action while claiming to be a dry run. Fixed
  by moving the dry-run check to *before* the interested-button click — in dry-run mode,
  `apply()` now confirms the button exists and returns immediately, without clicking
  anything at all. Caught this myself during code review, before any execution — not
  found via testing.
- `applicators/index.js` — generalized the Indeed-specific `applyIndeedWithSession()`
  from Step 6 into a shared `applyWithSession(platform, job, opts)` keyed off a new
  `SESSION_APPLICATORS = { indeed, naukri }` map, rather than duplicating the
  browser/session-lifecycle wrapper a second time. `isWhitelisted()` now checks
  `naukri` the same way as `indeed` (the JSON key already existed, unused, since Phase 2
  — still `false` by default).
- **What was verified**: `node --check` on every changed file; confirmed
  `isWhitelisted({source:'naukri',...})` returns `false` and `autoApply()`
  short-circuits without launching a browser (same no-op-by-default proof as Indeed);
  and — the important one — **directly tested the dry-run fix with a mocked Playwright
  page**: confirmed `NAUKRI_DRY_RUN=true` results in zero `click()` calls before
  returning `status: "dry_run"`, and confirmed `NAUKRI_DRY_RUN=false` against the same
  mock actually proceeds to click (so the gate is a real branch, not just always-false).
  `npm run build` (client, unchanged this step) still succeeds.
- **Same limitation as Step 6, not re-explained in full here**: no AI session can watch a
  headed browser run against the real Naukri site. Selectors are best-effort, unconfirmed
  against the live site. `apply_whitelist.json`'s `naukri` flag should stay `false` until
  the user has watched it run for real, same process as Indeed.

**Step 8 — Company watchlist (done):**
- `server/data/target_companies.json` — JSON array of watchlist entries, each with `id`,
  `name`, `careersUrl`, `selector` (optional CSS selector, blank = AI extraction),
  `priority` (1 = every run, 2 = every 12h, 3 = weekly), `lastScrapedAt`, `tags`. Seeded
  with a Razorpay example entry. `lastScrapedAt` is updated after each successful scrape
  so priority filtering works correctly across runs.
- `server/scrapers/companyWatchlist.js` — scraper that reads `target_companies.json`,
  filters companies whose `lastScrapedAt` is old enough for their priority level, opens
  each careers page with Playwright (headless), and extracts jobs either via the given CSS
  selector (up to 30 cards, skips non-job-title text) or, if no selector, by dumping all
  job-looking `<a>` links to Gemini for structured extraction (`title, location, applyUrl`).
  Updates `lastScrapedAt` per company after a successful scrape. Returns jobs in the same
  `{title, company, location, jdText, applyUrl, recruiterEmail, source: 'companyWatchlist',
  scrapedAt}` shape as all other scrapers — zero changes needed to the dedup logic.
- `server/routes/companies.js` — full CRUD (`GET /`, `POST /`, `PUT /:id`,
  `DELETE /:id`) plus `POST /:id/test-scrape` which runs the scraper for just one company
  and returns a preview of found jobs without enqueueing anything. Mounted at
  `/api/companies` in `server/index.js`.
- `server/scrapers/index.js` — `companyWatchlist` added to `allScrapers` and
  `enabledSources`. The watchlist scraper now runs in parallel with every other source
  on every `scrapeAll()` call (priority filtering inside `companyWatchlist.js` ensures it's
  a fast no-op for P2/P3 companies that were recently scraped).
- `client/src/pages/Companies.jsx` — table view: company name, careers URL, selector
  (shows "AI" when blank), priority badge, last-scraped age, tags, actions column.
  Inline add/edit form (name, URL, selector, priority dropdown, tags). "Test Scrape"
  button fires `POST /api/companies/:id/test-scrape` and shows a preview panel below the
  table with the found jobs (title/location/applyUrl). Wired into `App.jsx` routing
  (`/companies`) and `Sidebar.jsx` nav.
- **Verified**: `node --eval` syntax check on both new server files passed clean; client
  `npm run build` succeeded.

**Step 9 — Watchlist priority in BullMQ pipeline (done):**
- `server/routes/scrape.js` and `server/pipeline.js` — both now pass `priority: 1` to
  `queue.add()` for jobs with `source === 'companyWatchlist'`, and `priority: 10` for all
  other sources. In BullMQ, lower number = higher priority, so watchlist jobs are always
  processed before the general-scrape batch, regardless of arrival order.
- `server/applicators/index.js` — `isWhitelisted()` now treats `companyWatchlist` the same
  as `companyPages`: if the job's company name matches an entry in `apply_whitelist.json`'s
  `companyPages` array (case-insensitive), it's whitelisted for the generic applicator.
  `autoApply()` dispatches `companyWatchlist` jobs to `applyGeneric()` on the same
  condition. This means: add a company to both `target_companies.json` AND the
  `companyPages` array in `apply_whitelist.json` to get prioritized scraping + auto-apply.
- `pipeline.js` log line updated to include the `companyWatchlist` count.
- **Verified**: background syntax check exited 0.

**Step 10 — CONTEXT.md + AUTO_APPLY_LOGIC.md update (this entry).**

**Not started yet**: Step 11 (final end-to-end dry-run verification). Waiting for user
confirmation before proceeding.

## -7. SESSION 9 SUMMARY (most recent — read this first) — HR CONTACTS STORAGE: COMPLETE

User asked to restructure HR contact storage from a flat per-contact collection into a
"map-like" structure keyed by company (alphabetical), with multiple HRs nesting under
their shared company, plus a company-name search on the HR Contacts page. This section
is now considered **complete** — next up per the user's plan is the auto-apply feature.

- **New schema** (`services/hrContactStore.js`, fully rewritten): one Mongoose model,
  `HrCompany` (collection `hrcompanies`):
  ```
  { companyKey: <normalized lowercase, unique>, company: <display name>,
    hrs: [{ name, email, role, linkedin, sourceFile, emailSent, emailedAt, createdAt }] }
  ```
  `companyKey` is the literal "map key" (unique index); `hrs` is the value array. A new
  HR for an already-known company pushes into that company's existing `hrs` array
  instead of creating a new top-level document — exactly the "if we get another HR from
  that company, store it with the others" behavior asked for.
- **One-time migration built in**: `migrateFromFlatCollectionIfNeeded()` runs lazily
  inside `getHrCompanyModel()` (checked once per process via a module-level flag, and
  again implicitly via `HrCompany.countDocuments() > 0` across restarts) — reads the old
  flat `hrcontacts` collection, groups by normalized company name, and `insertMany`s into
  `hrcompanies`. Old collection is left untouched (read-only) and not dropped — kept as a
  backup per the user's choice. **Ran for real** against the actual production data:
  123 flat contacts → 118 company groups (5 companies had 2 HRs each, correctly merged:
  Ameex Technologies, Dominair Systems, Ecare India, Gemini Cooling Systems, Muthoot
  Finance). All 5 previously-sent contacts (from Session 8's test batch) kept their
  `emailSent`/`emailedAt` correctly through the migration — verified via
  `getHrContactStats()` showing `sentCount: 5` unchanged after migration.
- **Store functions rewritten around the grouped shape**:
  - `saveHrContacts()` — same input shape as before (`{name, company, email, role,
    linkedin}[]`), now upserts into the right company group, dedupes by email *within*
    that company rather than globally.
  - `listHrContacts({ page, limit, search })` — new `search` param does a case-insensitive
    regex match on `company`, sorted alphabetically by `companyKey`. Verified live:
    searching "tech" correctly matched 19 companies (Aithent Technologies, HCL
    Technologies, Infosys Technologies, etc.); searching "muthoot" correctly returned the
    one 2-HR group.
  - `getUnsentHrContacts(limit)` — now an aggregation pipeline (`$unwind` + `$match` +
    `$sort` + `$limit` + `$project`) flattening unsent HRs across all companies,
    oldest-`createdAt`-first, returning flat `{_id, company, name, email, role,
    linkedin}` objects — same shape `hrBatchSender.js` already expected, so **no changes
    needed there**.
  - `setHrContactSent(hrId, sent)` — now `findOneAndUpdate({'hrs._id': hrId}, {$set:
    {'hrs.$.emailSent':..., 'hrs.$.emailedAt':...}})`. Verified live via a real PATCH
    against a real subdocument (toggled true then back to false).
  - `getHrContactStats()` — aggregation across all companies for total/sentCount/
    sentToday/remaining (same return shape as before, so `routes/hrContacts.js`'s
    `/status` endpoint and `TodayPlan.jsx` needed no changes).
- **`routes/hrContacts.js`**: `GET /` now accepts `?search=`, and merges `listHrContacts`
  + `getHrContactStats` into one response (`{ companies, totalCompanies, page, limit,
  total, sentCount, sentToday, remaining }`). Everything else (`/upload`, `/status`,
  `/send-batch`, `PATCH /:id`) needed zero changes since they call the same exported
  function names with the same signatures.
- **Client**: `pages/HrContacts.jsx` rewritten to render one panel per company (header
  shows company name + HR count), each with its own small table of HRs (name/email/role/
  LinkedIn link if present/sent checkbox/sent-at), plus a search-by-company text input
  that re-fetches on change. `api.js`'s `getHrContacts(page, search)` now takes a search
  param.
- **Future scraper note**: nothing scrapes HR contacts yet (out of scope for this
  session, per the user's "then mark this section complete then we will auto apply
  feature" plan) — but `saveHrContacts(contacts, sourceFile)` is the single, already-
  generic entry point any future scraper should call with the same `{name, company,
  email, role, linkedin}` shape; it'll group into the same company structure
  automatically. No new code needed there until the scraper itself is built.
- **Verified live end-to-end**: started a fresh server, hit the real `/api/hr-contacts`
  route directly (not just the store functions in isolation) and got back the correct
  grouped/searched/stat'd response against the real, now-migrated 123-contact dataset.
  `node --check` passed on every server file; `npm run build` (client) succeeded.

## -6. SESSION 8 SUMMARY

User wanted a real but small (5-contact) test send to validate the whole HR-batch
pipeline end-to-end, using their actual resume file (not an AI-tailored one), plus a
Dashboard widget showing today's HR-batch status. This was a real send to real people —
confirmed with the user before triggering it.

- **Literal uploaded resume support**:
  - `services/profileStore.js` — `profile.json` now also stores `uploadedResumePath` /
    `uploadedResumeFilename`. New `getUploadedResumePath()` getter.
  - `routes/profile.js`'s `POST /resume` now saves the literal uploaded buffer to
    `server/data/uploaded_resume.<ext>` (gitignored) in addition to the existing
    AI-merge-into-profile-text step, and records the path/filename via
    `updateCandidateProfile()`.
  - `services/hrBatchSender.js` now checks `getUploadedResumePath()` first — if a literal
    file is on record, it's attached as-is (correct extension); only falls back to the
    AI-tailored generic resume (the old behavior) if nothing's been uploaded yet.
- **On-demand/manual batch send** (separate from the automatic daily 20/day):
  - `services/hrBatchSender.js`'s `runDailyHrBatch()` gained a `force` option that
    bypasses the "already ran today" lock without disturbing the automatic schedule —
    it still writes `lastRunDate` at the end, so the same day's automatic check (hourly
    or on next startup) stays a no-op afterward. New `getBatchState()` export.
  - `services/hrContactStore.js` gained `getHrContactStats()` (total / all-time sent /
    sent-today / remaining).
  - `routes/hrContacts.js` gained `GET /status` (stats + `lastRunDate`) and
    `POST /send-batch` (`{ count }`, defaults 5, clamped 1-100, calls
    `runDailyHrBatch({ batchSize: count, force: true })`).
- **Dashboard widget**: new `components/TodayPlan.jsx` — shows HR contact totals/sent
  today/remaining, a count input (default 5), and a "Send to next N HR contact(s)"
  button. Added to `Dashboard.jsx` between the email chart and recent activity.
  `api.js` gained `getHrBatchStatus()` / `sendHrBatch(count)`.
- **Real send executed this session**: user pointed at a specific pre-existing file,
  `server/Ritesh_Kumar_Resume_Backend (1).pdf` (their previous resume upload predated the
  literal-file-saving feature, so nothing was on disk yet — rather than re-uploading via
  Settings, they directed me straight at this file). Set it as `uploadedResumePath` via a
  one-off `updateCandidateProfile()` call (non-destructive — only touched the resume
  fields, left `profileText`/`contact` untouched). Restarted the server (confirmed with
  user first) to load the new code, then called `POST /api/hr-contacts/send-batch
  {"count":5}` directly. **Result: 5/5 sent successfully**, confirmed via server log that
  the literal PDF was used (not AI-tailored), confirmed via `GET /status` that
  `sentToday: 5`, `lastRunDate` set to today so the automatic batch won't double-send.
  The 5 recipients: 42 Hertz Software India, 7Eleven Arthashastra India, Ababil
  Healthcare, ABS Aircon Engineers, Aditya Birla Group (oldest-added-first, as designed).
- Total HR contacts on file: 123 (from the earlier real upload), 118 remaining unsent
  after this test. Tomorrow's automatic run reverts to the default batch size of 20 —
  no permanent config change was made, exactly as the user asked ("rest will remain
  the same").

## -5. SESSION 7 SUMMARY

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
