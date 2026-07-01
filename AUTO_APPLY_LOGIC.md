# Auto-Apply Logic — Current Design

This documents the scraping → eligibility → tailoring → apply/email/notify pipeline as it
exists in the code today, so you can review and edit the logic before further work. It's
a description of what's built, not a new proposal — most of this already runs end-to-end;
a few pieces (marked below) are wired but unverified against a live run, or intentionally
not yet automated.

If you want something here to work differently, the easiest way is to edit this file
directly (cross out / rewrite the rule you want changed) and hand it back — that's faster
and less ambiguous than describing it in chat.

---

## 0. Phase 3 status (Steps 1-10 complete — Step 11 pending)

All Phase 3 code is built and wired. Steps done: fixed `/api/scrape` not enqueueing jobs
(Step 1), per-run scrape logging (Step 2), SSE live-progress endpoint + history (Steps
3-4), credential vault (Step 5), Indeed + Naukri applicators (Steps 6-7), company
watchlist scraper + CRUD + React page (Step 8), watchlist BullMQ priority (Step 9), and
this doc update (Step 10). See `CONTEXT.md`'s Session 10 entry for full per-step details.

**Still pending**: Step 11 — final end-to-end dry-run verification (`npm run pipeline`
with all sources, DRY_RUN=true, confirm zero real submissions).

**Human-verification still required before enabling**: Indeed and Naukri applicators are
built and wired but have never been watched against the real sites. Both `apply_whitelist.
json`'s `indeed` and `naukri` flags remain `false` until the user has watched each one
run through at least 5-10 dry runs (see section 7 below for the full checklist).

---

## 1. The pipeline, end to end

```
Scrape jobs  →  Eligibility filter  →  Tailor resume  →  Resolve recruiter email  →  Decide action
   (per source)    (score >= MIN)        (LaTeX → PDF)      (JD text, then HR lookup)        ↓
                                                                              ┌───────────────┼───────────────┐
                                                                       cold email        auto-fill form    notify me
                                                                    (if email found)   (if whitelisted)   (otherwise)
```

Entry points that run this pipeline:
- `npm run pipeline` (`server/pipeline.js`) — standalone CLI run, scrapes (or reuses a
  <6h cache) then processes every job through the queue.
- `server/workers/jobWorker.js` — same processing logic, running in-process inside
  `server/index.js`, started automatically if Redis is reachable.
- Both feed the same queue (`server/workers/queue.js`) and the same per-job logic
  (`server/workers/processor.js` — this is the file to edit if you want to change the
  decision logic itself).

**Known gap**: `POST /api/scrape` (what the dashboard's "Run full pipeline now" button
calls) only scrapes and saves `scraped_jobs.json` — it does **not** enqueue those jobs
onto the BullMQ queue. Only `npm run pipeline` actually processes jobs end-to-end today.
If you want the dashboard button to trigger the full flow, `server/routes/scrape.js`
needs to also call `createQueue().add(...)` for each scraped job.

---

## 2. Stage 1 — Scraping

File: `server/scrapers/index.js`, calling one function per source in parallel.

| Source | File | Notes |
|---|---|---|
| Internshala | `internshala.js` | Easiest to scrape, marks jobs `autoApplyEligible: true` |
| Naukri | `naukri.js` | Often returns 0 — bot detection, selectors may need tuning |
| Wellfound | `wellfound.js` | Often returns 0 — same reason |
| Indeed | `indeed.js` | Aggressive bot detection, best-effort |
| LinkedIn | `linkedin.js` | **Public job listing pages only — never logs in, never scrapes profiles.** Skips anything behind a login wall. |
| Company pages | `companyPages.js` | Reads `server/data/company_pages.json` (currently empty — add `{ "company": "...", "url": "...", "selector": "..." }` entries to enable) |
| Company watchlist | `companyWatchlist.js` | Reads `server/data/target_companies.json`. User-maintained list of target companies. Priority-filtered (P1=every run, P2=every 12h, P3=weekly). CSS selector or Gemini AI extraction. **Watchlist jobs get BullMQ priority 1 — processed before all other jobs.** Manage via the Companies dashboard page. |

Each job becomes: `{ title, company, location, jdText, applyUrl, recruiterEmail, source,
scrapedAt }`. `recruiterEmail` here is whatever plain-text email (if any) was visible on
the job posting itself — this is **not** the HR-contacts list (that's a separate manually
uploaded dataset, see `HR_CONTACTS` doc / the HR Contacts dashboard page).

Output: deduplicated (`scrapers/utils.js`'s `dedupe()`, by `title+company`) and saved to
`server/data/scraped_jobs.json`. Config: `SCRAPE_KEYWORDS`, `SCRAPE_LOCATION`,
`SCRAPE_LIMIT` in `.env`. `npm run pipeline` reuses this file if it's <6h old unless
`--fresh` is passed.

**To change**: which sources run — edit the `enabledSources` array in
`scrapers/index.js`, or pass `{ sources: [...] }` to `scrapeAll()`.

---

## 3. Stage 2 — Eligibility filter

File: `server/workers/processor.js` → `checkEligibility()` in
`services/applicationProcessor.js` → `prompts/eligibilityPrompt.js`.

Gemini (or the OpenRouter fallback) scores the job 0-100 against your profile
(`server/data/profile.json`). Jobs scoring below `MIN_ELIGIBILITY_SCORE` (env var,
default 60) are skipped entirely — no resume tailoring, no email, logged as `status:
"skipped"`.

**To change**: the scoring rubric — edit `prompts/eligibilityPrompt.js`. The cutoff —
edit `MIN_ELIGIBILITY_SCORE` in `.env`.

---

## 4. Stage 3 — Resume tailoring

File: `services/resumeTailor.js`, called from `services/applicationProcessor.js`.

For jobs that pass the eligibility filter: fills `templates/resume.tex` with
AI-generated, LaTeX-escaped sections (summary/skills/experience/projects/education/
achievements) built from your profile + this job's JD, honesty-constrained (never invents
skills not in your profile). Compiles to PDF via `pdflatex` → `tectonic` → the hosted
`latex.ytotech.com` API, whichever succeeds first.

**To change**: the resume template/layout — edit `templates/resume.tex`. The tailoring
rules/tone — edit `prompts/resumePrompt.js`. The compiler order — `LATEX_COMPILER` env
var (`auto | pdflatex | tectonic | ytotech`).

---

## 5. Stage 4 — Recruiter email resolution

File: `services/hrFinder.js`, called from `workers/processor.js` only when the scraped
job itself had no `recruiterEmail`.

Order of attempts:
1. Email already present in the JD text (from scraping) — used as-is, no lookup needed.
2. `findCompanyWebsite()` — DuckDuckGo HTML search for `"<company> official website"`,
   takes the first result.
3. `searchCompanySiteForEmail()` — fetches that site's `/`, `/about`, `/about-us`,
   `/contact`, `/contact-us`, `/team`, `/careers` pages, regex-extracts the first email
   found.
4. `searchGithubOrgForEmail()` — tries the company's GitHub org (slugified name), checks
   the org's public email, then up to 5 members' public profile emails.
5. If nothing found, `recruiterEmail` stays empty → falls through to the "notify me"
   branch in Stage 5.

**Deliberately does not** search LinkedIn profiles (ToS/anti-scraping risk is much higher
for person-search than the existing public-job-listing scraper). Public GitHub API is
rate-limited to 60 requests/hour per IP — this stays silent/best-effort on failure, never
retries.

**To change**: which sources it checks, or the contact-page paths it tries — edit
`CONTACT_PATHS` / the functions in `services/hrFinder.js`.

---

## 6. Stage 5 — The hybrid decision

File: `workers/processor.js`. This is the core logic — **edit this file if you want to
change what happens after tailoring**.

```
if (recruiterEmail found, from JD or hrFinder):
    → send cold email automatically (via processApplication's sendEmail flag)
    → status becomes "email_sent" (or stays "drafted" if send failed)

separately, regardless of the above:
    if (job.source/company is on the whitelist — server/data/apply_whitelist.json):
        → run the matching applicator (Internshala or generic company-page filler)
        → status becomes "auto_applied" (success) or "needs_manual" (dry-run/failure)
    else:
        → send yourself a notification email (job link, JD summary, tailored resume,
          cold-email + referral drafts ready to copy)
        → status becomes "notified"
```

Both branches can fire for the same job — emailing the recruiter and attempting
auto-apply are independent actions; only the "whitelisted vs notify" choice is
either/or.

**To change**: the whole decision tree lives in this one function — reorder, add a third
branch (e.g. always notify regardless of whitelist), change what counts as "found an
email", etc.

---

## 7. Applicators (the actual form-filling)

Files: `applicators/index.js` (router), `applicators/internshala.js`,
`applicators/generic.js`, `applicators/indeed.js`, `applicators/naukri.js`,
`applicators/captchaGuard.js`.

- **Gate**: `applicators/index.js`'s `isWhitelisted()` checks
  `server/data/apply_whitelist.json` — `internshala: true/false`, `indeed: true/false`,
  `naukri: true/false`, and `companyPages: [<company names...>]` (case-insensitive match
  against the job's company). Currently: `internshala: true`, everything else
  `false`/empty — nothing else whitelisted yet.
- **Internshala** (`internshala.js`): Playwright — opens the job, clicks "Apply now",
  fills the cover letter (AI-generated) and any custom question fields (best-effort, AI
  per question), then either submits or stops short, depending on `INTERNSHALA_DRY_RUN`
  (`.env`, defaults `true`).
- **Generic** (`generic.js`): heuristic field-matching (email/LinkedIn/GitHub/portfolio/
  name by label text) for whitelisted company career pages, attaches the tailored resume
  to a file input if present, gated by `AUTO_APPLY_DRY_RUN` (defaults `true`).
- **Indeed** (`indeed.js`, Phase 3): different from the other two — needs a *persistent
  logged-in session* rather than a fresh anonymous visit, since Easy Apply requires being
  logged in. `applicators/index.js`'s `applyIndeedWithSession()` owns the browser/page
  lifecycle: pulls credentials from `credentialStore.js`, reuses a fresh cookie session
  or logs in (throttled to once per `MIN_HOURS_BETWEEN_LOGINS`) via
  `sessionManager.ensureSession()`, applies cookies, then calls `indeed.apply()` (Easy
  Apply flow: upload resume, AI cover letter + question answers, advance multi-step
  screens, stop or submit per `INDEED_DRY_RUN`, default `true`). Every step checks for a
  captcha via `captchaGuard.js` first — if one appears, screenshots it, emails
  `NOTIFICATION_EMAIL`, and the job gets status `captcha_blocked` (never attempts to
  solve it).
- **Naukri** (`naukri.js`, Phase 3): same session-reuse pattern as Indeed (shares
  `applicators/index.js`'s generalized `applyWithSession()`), but a structurally simpler
  flow — usually a single "I am Interested"/"Apply" click rather than a multi-step form.
  **Important quirk**: that click is frequently the *entire application by itself*, so
  `NAUKRI_DRY_RUN` (default `true`) gates the click itself, not some later "submit" step
  that may not exist — `apply()` confirms the button exists and returns without clicking
  anything when in dry-run. If the click leads to a redirect off `naukri.com` (an
  external ATS), it stops and returns `needs_manual` rather than guessing at an unknown
  third-party form.
- **Credentials & sessions**: `services/credentialStore.js` (`server/data/
  credentials.json`, gitignored, AES-256-GCM encrypted if `CREDENTIAL_VAULT_KEY` is set)
  and `services/sessionManager.js` (`server/data/sessions/<platform>.json`, gitignored,
  7-day freshness window). Manage from the Credentials dashboard page.

**Known gap, Internshala/generic**: neither has been run against a real live page in this
project yet (intentionally avoided, to not risk an accidental real submission while
still in development) — only dry-run form-fill behavior should be trusted until you've
watched it fire 5-10 times per the safety rule below.

**Known gap, Indeed and Naukri — more serious, read before enabling either**: the code
exists and is wired in for both, but **no AI session has ever watched either run against
the real site** — that requires a human watching a headed browser window, which an AI
session structurally cannot do. The form selectors in `indeed.js`/`naukri.js` are
best-effort guesses, not confirmed against either site's actual current markup. Both are
currently inert by default (`apply_whitelist.json`'s `indeed`/`naukri` both `false`),
which is exactly how they should stay until, per platform: (1) you've added real
credentials via the Credentials page, (2) you've watched it run via a manual test
(temporarily flip that platform's whitelist on for one job and watch the headed-browser
`test-login` flow plus a real apply attempt), and (3) you've done that 5-10 times per the
non-negotiable rule before trusting it with `INDEED_DRY_RUN=false` /
`NAUKRI_DRY_RUN=false`. For Naukri specifically, also double-check the dry-run behavior
in particular — the "apply" action is often a single click with no separate submit step,
so it's worth confirming the dry-run message ("did not click it") actually matches what
you see on screen before ever flipping the flag.

**Non-negotiable safety rule** (carried over from the original spec): don't flip
`INTERNSHALA_DRY_RUN` or `AUTO_APPLY_DRY_RUN` to `false` until you've watched the dry-run
fill behavior enough times to trust it on a given site.

**Company watchlist + auto-apply**: `companyWatchlist` jobs use the generic applicator
(`applicators/generic.js`) when their company name appears in `apply_whitelist.json`'s
`companyPages` array. To get a watchlist company fully wired: add it to
`target_companies.json` (via the Companies page) **and** add its name to `companyPages`
in `apply_whitelist.json`. The scraper runs on every pipeline call (for P1 companies);
the applicator only fires if it's also whitelisted.

**To change**: which sites are whitelisted — edit `server/data/apply_whitelist.json`
directly. The fill logic itself — edit the relevant applicator file.

---

## 8. Where this overlaps with the HR Contacts feature

The HR Contacts list (uploaded PDF/DOCX → `hrcompanies` MongoDB collection → daily
batch sender) is a **separate, parallel** outreach channel from the scrape pipeline
above — it doesn't go through eligibility/tailoring/whitelist logic per-job; it's a flat
"cold-email N contacts/day with one shared generic resume" loop
(`services/hrBatchSender.js`). The two systems don't currently share contacts — a company
found via the HR list isn't automatically considered "whitelisted" for the scrape
pipeline's auto-apply, and vice versa. If you want them to inform each other (e.g. an HR
contact found via `hrFinder.js` during the scrape pipeline gets added to the HR Contacts
list, or a company in the HR Contacts list gets auto-whitelisted for company-page
auto-apply), that's a deliberate design decision to make, not something already wired.

---

## 9. Config quick-reference

| What | Where |
|---|---|
| Eligibility cutoff | `MIN_ELIGIBILITY_SCORE` (.env) |
| Scrape keywords/location/limit | `SCRAPE_KEYWORDS`, `SCRAPE_LOCATION`, `SCRAPE_LIMIT` (.env) |
| Which sites can auto-fill | `server/data/apply_whitelist.json` |
| Company career pages to scrape | `server/data/company_pages.json` |
| Company watchlist | `server/data/target_companies.json` (manage via /companies dashboard page) |
| Auto-apply dry-run switches | `INTERNSHALA_DRY_RUN`, `AUTO_APPLY_DRY_RUN`, `INDEED_DRY_RUN`, `NAUKRI_DRY_RUN` (.env) |
| Indeed/Naukri login credentials | `/credentials` dashboard page → `server/data/credentials.json` (gitignored) |
| Login throttle gap | `MIN_HOURS_BETWEEN_LOGINS` (.env, default 6) |
| Where notification emails go | `NOTIFICATION_EMAIL` (.env) |
| LaTeX compiler preference | `LATEX_COMPILER` (.env) |
| The decision tree itself | `server/workers/processor.js` |
| HR-email-finder sources | `server/services/hrFinder.js` |
