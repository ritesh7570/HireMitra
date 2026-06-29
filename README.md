# Job Application Agent

An autonomous job-application assistant for Ritesh Kumar. It checks job descriptions for
eligibility against a candidate profile, tailors a LaTeX resume into a PDF per job, drafts
cold emails and referral messages, optionally auto-applies on whitelisted sites, and
notifies you by email when it can't apply automatically. A React dashboard shows stats,
scraped jobs, and applications.

## How it works

1. **Scrape** matching jobs from Naukri, Wellfound, Internshala, LinkedIn (public pages
   only), Indeed, and company career pages you list.
2. **Filter** by an AI eligibility check (Gemini).
3. **Tailor** a resume per job — LaTeX template filled by AI, compiled to a real PDF.
4. **Act** on each eligible job:
   - Always send a cold email to the recruiter if an email address was found in the JD.
   - If not, try to find one: check the company's official website (about/contact/team
     pages) and its public GitHub org before giving up. Works best for small or newly
     founded startups with a sparse web presence — established companies usually hide
     direct contact info on purpose, so a miss there is expected, not a bug.
   - Auto-fill the application form only on whitelisted sites (Internshala, or company
     pages you've explicitly whitelisted) — and only submit for real once you flip the
     dry-run flag off.
   - Otherwise, email you a notification with the job link, a 3-sentence summary, the
     tailored resume PDF, and ready-to-copy cold-email/referral drafts.
5. **Dashboard** (React) shows stats, scraped jobs, applications (with posted/deadline
   dates extracted from the JD where findable), a manual paste-JD form, an HR contacts
   list, a resume upload, and a reset button.

Your profile (skills, experience, projects, contact info) lives in
`server/data/profile.json`, generated on first run from defaults. Upload your resume any
time from the Settings page — the AI merges it into your profile, and every job from then
on is tailored against the updated version. No restart needed.

### HR contact list + daily batch send

Upload a PDF/DOCX list of HR/recruiter contacts (any freeform format — a table, a bullet
list, whatever you have) on the **HR Contacts** page. The AI extracts name/company/email
triples and saves them. Every time the server starts (and every hour after, so a
long-running server picks up a new day without a restart), it checks for up to 20
not-yet-emailed contacts and cold-emails them automatically with one shared generic
tailored resume + cold-email template for that day's batch. The HR Contacts page shows a
checkbox per contact (auto-ticked once sent, or toggle manually).

Single-user, no auth, runs locally. See `PHASE2_CODEX_PROMPT_v2.md` for the full original
spec and `CONTEXT.md` for a detailed log of what's built vs. still pending.

## Project layout

```text
e:\agent
├── server/        Express API + scrapers + AI prompts + LaTeX resume pipeline
├── client/        Vite + React dashboard
└── package.json   Root scripts that orchestrate both
```

## Prerequisites

- Node.js 18+
- A MongoDB connection string (e.g. a free MongoDB Atlas cluster)
- A Gemini API key (free tier works)
- A Gmail account + [app password](https://myaccount.google.com/apppasswords) for sending
  cold emails and notifications
- Redis, only if you want to run the full scrape → apply pipeline (`npm run pipeline`).
  Not required for the dashboard, manual apply, or `npm run cli`/`npm run auto`.
- LaTeX is **not required** — if no local `pdflatex`/`tectonic` is found, resumes compile
  via the free [latex.ytotech.com](https://latex.ytotech.com) API automatically.
- Run `npx playwright install chromium` once after `npm install` (scrapers and the
  auto-apply applicators are Playwright-driven; without this they fail with
  "Executable doesn't exist").

## Setup

```bash
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

Create your env file and fill in the values described in [Environment variables](#environment-variables):

```bash
# Windows PowerShell
Copy-Item server/.env.example server/.env
```

## Running it

**Dashboard + API in dev mode** (Express on `:3001`, Vite on `:5173`, proxied):

```bash
npm run dev
```

Then open `http://localhost:5173`.

**Production-style single-port run** (build the client, serve everything from Express):

```bash
npm run build
npm start
```

Then open `http://localhost:3001`.

**Interactive CLI** (Phase 1 — paste one JD at a time):

```bash
npm run cli
```

**Process a batch of jobs from `server/data/job_queue.json`:**

```bash
npm run auto
```

**Scrape jobs only** (writes `server/data/scraped_jobs.json`):

```bash
npm run scrape
```

**Full pipeline** — scrape (or reuse a recent cache) → eligibility filter → tailor resume
→ cold-email/auto-apply/notify → log to MongoDB. Requires Redis running locally:

```bash
npm run pipeline          # reuses scraped_jobs.json if it's under 6 hours old
npm run pipeline:fresh    # forces a new scrape first
```

## Auto-apply safety

Auto-filling application forms is **off by default** for real submissions. Both
applicators fill the form but stop short of clicking submit until you explicitly opt in:

- `INTERNSHALA_DRY_RUN=true` (default) — controls the Internshala applicator
- `AUTO_APPLY_DRY_RUN=true` (default) — controls the generic company-page applicator

Watch the dry-run behavior several times before setting either to `false` in
`server/.env`. Only sites listed in `server/data/apply_whitelist.json` are ever attempted;
everything else gets a notification email instead.

## Environment variables (`server/.env`)

| Variable | Purpose |
|---|---|
| `PORT` | Express port (default `3001`) |
| `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Gemini API access (`gemini-2.5-flash` default) |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Optional fallback when Gemini's free tier (5 req/min) hits a 429/503 — get a free key at [openrouter.ai/keys](https://openrouter.ai/keys) |
| `MONGO_URI`, `MONGO_DB_NAME` | MongoDB connection for applications/stats |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Sends cold emails and notification emails |
| `GMAIL_REFERRAL_USER`, `GMAIL_REFERRAL_APP_PASSWORD` | Reserved for a future referral-sender split (not yet used) |
| `SCRAPE_KEYWORDS`, `SCRAPE_LOCATION`, `SCRAPE_LIMIT` | What/where to scrape |
| `MIN_ELIGIBILITY_SCORE` | Pipeline skips jobs scoring below this (0-100) |
| `REDIS_URL` | Required for `npm run pipeline` / the background worker |
| `INTERNSHALA_DRY_RUN`, `AUTO_APPLY_DRY_RUN` | Auto-apply safety switches — see above |
| `NOTIFICATION_EMAIL` | Where "couldn't auto-apply" emails are sent (defaults to `GMAIL_USER`) |
| `DASHBOARD_URL` | Used for the "Mark as applied" link in notification emails |
| `LATEX_COMPILER` | `auto` (default) tries `pdflatex` → `tectonic` → ytotech.com |

See `server/.env.example` for the full template.

## Known limitations

- Gemini's free tier is only 5 requests/minute and 20/day per model. The pipeline runs
  jobs one at a time (not in parallel) to respect this, so processing many scraped jobs
  is slow by design. Configure `OPENROUTER_API_KEY` for a fallback when you hit a 429/503,
  but the real fix for heavy usage is a paid Gemini tier or a different primary provider.
- Scrapers may return few or zero jobs depending on bot detection/auth walls/markup
  changes on the target site — this is expected, not a bug.
- LinkedIn scraping is read-only and never logs in.
- `POST /api/scrape` (used by the dashboard) only writes `scraped_jobs.json` — it does not
  yet enqueue jobs for the background worker. Use `npm run pipeline` for the full
  end-to-end flow until that's wired up.
- Auto-apply applicators are heuristic and best-effort; always verify in dry-run mode
  before trusting a site's auto-fill.
- The daily HR-list batch send hasn't been observed against a real upload yet (only the
  zero-contacts no-op path was tested) — Gemini's daily quota ran out during development.
  Worth watching closely the first time it actually sends.

## Debugging

Every `/api/*` request and AI call is logged to the server console: request method/path
on the way in, status code + timing on the way out, and for AI calls, the prompt label,
length, and a truncated response snippet. If something's misbehaving, check this log first.

For a full, current account of what's built vs. pending, see `CONTEXT.md`.
