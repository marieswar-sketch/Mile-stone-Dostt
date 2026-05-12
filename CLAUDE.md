# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Dostt Free Rewards — a WebView page embedded inside the Dostt app (Behtar Technology Pvt. Ltd.). Users earn "Dostt Points" by spending coins on audio/video calls, then claim free coin rewards at 17 milestone tiers. Resets every 30 days.

## Running Locally

```bash
# Serve the frontend (from project root)
python3 -m http.server 8080
# → http://localhost:8080

# Start backend + Postgres
docker compose up -d

# First-time DB setup
cd backend && npm install && npm run migrate

# Backend dev (hot reload)
cd backend && npm run dev

# pgAdmin UI
# → http://localhost:5050  (admin@dostt.com / admin)
```

## Architecture

### Frontend (`/`)
Vanilla JS SPA — no build step, no framework. Everything is in `app.js` (single file), styled with Tailwind CDN + `styles.css`.

- **Rendering**: `render()` sets `root.innerHTML` based on `state.view` (`login` → `otp` → `rewards` → `terms`). No virtual DOM — full re-render on state change.
- **State**: single `state` object at top of `app.js`. `rewardsRendered` flag prevents the progress bar sweep animation from re-firing on every render.
- **Demo mode**: `DEMO_PHONE = "9988818731"` bypasses all API calls. OTP screen accepts any 6 digits. Claim works offline. Controlled by `if (state.phone === DEMO_PHONE)` guards in login, OTP verify, and claim handlers.
- **API**: `api(path, options)` helper reads JWT from `localStorage("dostt_token")` and prefixes `API_BASE`. Auth is JWT Bearer token.
- **Session persistence**: `localStorage("dostt_session")` stores `{ phone, country }`. On page load, if session + token exist (or demo phone), skip login and go straight to rewards.
- **Scroll architecture**: Outer `h-[100svh] overflow-y-auto` div allows the page to scroll. Inner `h-[100svh] flex flex-col` div fills exactly one screen. Logout/T&C sit *outside* the inner div — only reachable by scrolling down past the viewport.

### Backend (`/backend`)
Node.js + Express. Entry: `src/index.js`.

**DB layer** (`src/db/`): Generic adapter pattern. `client.js` exports either the postgres or supabase adapter based on `DB_ADAPTER` env var. Both implement identical interface: `findOne`, `findMany`, `insert`, `upsert`, `update`, `delete`, `query`.

**Key env vars** (see `backend/.env.example`):
- `DB_ADAPTER` — `postgres` (default) or `supabase`
- `OTP_PROVIDER` — `twilio` (default) or `2factor`
- `GO_LIVE_DATE` — ISO timestamp; points before this date count as 0
- `CYCLE_DAYS` — default `30`; controls reset cadence
- `REDASH_VERIFY_PHONE_QUERY_ID` — Redash query that checks if phone is a registered Dostt customer
- `REDASH_ADD_COINS_QUERY_ID` — Redash query that credits coins to wallet on claim

**30-day cycle logic** (`src/services/cycle.js`): Cycle number = `floor(days_since_go_live / 30) + 1`. Claims are scoped per cycle — `claimed_rewards` has `cycle_number` column. Points reset because the Google Sheet query filters transactions to the current cycle window.

**Google Sheets sync** (`src/jobs/syncSheets.js`): Runs on startup + every 2 hours via `node-cron`. Reads sheet → upserts `user_points` table. Sheet columns: `user_id | mobile_no | wallet_balance | spent_on_audio | spent_on_video | total_spent | last_refreshed_at_ist | ltv`.

**Redash client** (`src/services/redash.js`): Handles async job polling pattern. `runQuery(queryId, params, maxAge)` → rows array.

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | Registered users (phone + country_code) |
| `otp_sessions` | OTP codes with expiry + used flag |
| `user_points` | Synced from Google Sheet every 2h; mirrors sheet columns |
| `claimed_rewards` | One row per claim; scoped by `cycle_number` |
| `ltv_eligibility` | Tracks LTV gate (500–1500); records when user becomes ineligible |
| `claim_notifications` | Audit log of every claim attempt — success or failure |

## Tier Data

17 tiers defined identically in `app.js` (frontend) and `backend/src/routes/rewards.js` (backend). If tiers change, update both. Capped at 24,350 coins per legal requirement.

## Key Gotchas

- **Cache-busting**: `index.html` references `app.js?v=...` and `styles.css?v=...`. Bump the version query string when deploying changes.
- **WebKit input text**: OTP inputs use `type="text" inputmode="numeric"` (not `type="number"`). `-webkit-text-fill-color` is required in CSS for text to be visible in WebView.
- **Supabase adapter** uses `findOne` with `.single()` which throws on not-found — returns `null` via error code `PGRST116` check.
- **`max_age: 0`** is always passed to Redash for the add-coins query to prevent caching write operations.
- The `GO_LIVE_DATE` check in `sheets.js` guards against null `last_refreshed_at_ist` rows (pre-launch data) — it does NOT subtract a baseline because the sheet query already filters to post-go-live transactions only (Option A).
