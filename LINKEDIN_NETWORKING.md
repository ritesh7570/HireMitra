# LinkedIn Networking Module — How It Works

## What it does
When the pipeline processes a job, it automatically tries to find people at that company on LinkedIn and either messages existing connections or sends connection requests with a referral note.

## Flow (in order)

### 1. Login
- Uses `LINKEDIN_NETWORKING_EMAIL` + `LINKEDIN_NETWORKING_PASSWORD` from `.env`
- Saves session cookies to `data/sessions/linkedin-networking.json` — reused across runs
- Throttle: won't re-login within 6h (shared with sessionManager)
- Browser is **headed** (visible) so you can watch and kill if needed

### 2. Company home page — 1st-degree connections first
- Navigates to `linkedin.com/company/<slug>`
- Looks for the **"X works here"** badge (LinkedIn highlights your connections)
- For each 1st-degree connection found → **sends a referral message** directly:
  > "Hi [Name]! I came across the [Role] opening at [Company] and am very interested as a fresher. Would you be open to referring me if my profile is a good fit? Thank you!"

### 3. People tab — 2nd-degree connections
- If daily cap not reached, navigates to `/people/` tab
- Finds employee cards with **Connect** button
- Sends connection request with personalised note:
  > "Hi [Name]! I came across the [Role] opening at [Company] and am exploring it as a fresher. Would you be open to referring me if my profile is a good fit? Thank you!"
- Falls back to **"Send without a note"** if note modal doesn't appear

## Safety limits
| Setting | Default | Where |
|---------|---------|--------|
| `LINKEDIN_DRY_RUN` | `true` | `.env` — set `false` to actually send |
| `LINKEDIN_MAX_REQUESTS_PER_DAY` | `3` | `.env` — hard daily cap |
| `LINKEDIN_MAX_PER_COMPANY` | `3` | `.env` — max per job/company |
| Never re-contact same profile | always | tracked in `data/linkedin_network_state.json` |
| 5–15s random delay between actions | always | human-like pacing |

## State file
`server/data/linkedin_network_state.json` — tracks who was contacted and when. Resets daily count but keeps full history so same person is never contacted twice.

## Running manually (test)
```bash
cd server
node --env-file=.env scripts/testLinkedInNetworking.js
```

## Enabling live mode
In `server/.env`:
```
LINKEDIN_DRY_RUN=false
```
Run the test script once to verify, then set back to `true`.

## Known issues (to fix)
1. **Douglas Dietrich** (US-based) — message box not found after clicking Message. Possibly InMail-only or different LinkedIn UI for accounts outside India.
2. **People tab connect Send button** — `Send invitation` / `Send without a note` button not found after clicking Connect. Need debug screenshot to identify the modal state.
3. **Name from "works here" badge** — sometimes picks up the logged-in user's name. Workaround: `sendMessageToConnection` always fetches the real name from the profile h1 before composing.

## Pipeline integration
`server/workers/processor.js` calls `runNetworkingForJob(job)` automatically after each job is processed (non-blocking). Set `LINKEDIN_NETWORKING_ENABLED=true` in `.env` to activate in the pipeline.
