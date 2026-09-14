# Fair Flow Booking QA

Isolated automated QA for Booking. This is not product code.

Canonical checkpoint: `c2ba63ed92faec884e5ab4e2beb0b76829ced251` (`c2ba63e`).

## NEVER run Booking browser QA without staging environment verification

The Playwright suite must prove Firebase `projectId === fair-flow-staging` **before** login or any Booking click.

- Local pages **must** use `?env=staging`.
- Plain `http://localhost/` / `http://127.0.0.1/` without that query talks to **production**. The suite refuses that.
- Production hosts (`fairflowapp-db841`, `app.fairflowapp.com`) are rejected.
- Do not use production credentials or production URLs.

If the project ID is anything other than `fair-flow-staging`, tests fail immediately with `QA SAFETY STOP` and do not log in.

## Environment

Required for authenticated browser smoke:

```
FF_STAGING_EMAIL
FF_STAGING_PASSWORD
```

Create the isolated staging QA user + salon (after a valid Firebase CLI login):

```bash
firebase login --reauth
node qa/scripts/setup-staging-qa-fixture.js
```

That writes `qa/fixtures/staging.env` (gitignored). Do not commit secrets. The script aborts unless Admin `projectId === fair-flow-staging`.

Optional:

```
FF_BASE_URL=https://fair-flow-staging.web.app
```

Browser QA always uses `https://fair-flow-staging.web.app/?env=staging` so staging Auth accepts the Referer. Playwright fulfills that origin from this worktree's `public/` and does **not** load the remotely deployed staging build. `FF_BASE_URL` pointing at `127.0.0.1` is upgraded to the staging origin for the same reason. Production hosts are rejected.

Authenticated login runs in a dedicated Playwright setup project with tracing, screenshots, and video **off**. Saved session files under `qa/.auth/` are gitignored credential artifacts. Do not print or commit them.

## Commands

From the repo root (`ff-booking-qa`):

```bash
# Static Booking contract tests (no browser, no Firestore writes)
npm run test:booking:static

# Policy self-check: runner exits 0 only for the exact c2ba63e CLASS A set
npm run test:booking:static:policy

# Playwright smoke (read-only, Chromium, America/New_York)
# Browser origin is https://fair-flow-staging.web.app/?env=staging
# Application files are fulfilled from local public/
npm run test:booking:e2e

# Appointment lifecycle (writes only inside salons/ffBookingQa)
npm run test:booking:lifecycle

# Client lifecycle (writes only FF-QA-CLIENT-* inside salons/ffBookingQa)
npm run test:booking:clients

# Smoke then appointment + client write suites. Smoke itself stays read-only.
npm run test:booking:staging-write
```

First Playwright run also needs browsers:

```bash
npx playwright install chromium
```

## What the suites do

### Static

Runs existing `scripts/test-booking-*.js` files without rewriting them.

Known **CLASS A — PRE-EXISTING AT c2ba63e** in `scripts/test-booking-clients-ui.js`:

- recent list is bounded to 50
- UI recent list uses getRecentClients
- drawer update uses repository

The runner labels those A and still exits 0. Any other static failure is unexpected.

Machine-readable output: `qa/baselines/last-static.json`  
Frozen checkpoint copy: `qa/baselines/c2ba63e-static.json`

### Playwright smoke (read-only)

Does **not** create, edit, drag, cancel, or delete appointments or clients.

Covers:

- staging origin + Firebase project guard + local-worktree proof
- dedicated setup login (not recorded in traces)
- Booking switch + `#ffBookingWorkspace`
- Day Calendar ready (provider columns **or** empty state)
- location switcher / active location report
- Clients / Reports / Sales / Settings smoke

Traces, screenshots, and video are kept on failure under `qa/test-results/` for post-login tests only.  
Auth setup never records traces/screenshots/video.  
Summary: `qa/baselines/last-e2e.json`.

Retries default to 0 so missing credentials or genuine failures are not hidden. Set `FF_E2E_RETRIES=1` only when diagnosing flake.

### Appointment lifecycle (staging writes, ffBookingQa only)

Separate from smoke. Creates appointments through the Booking UI in `salons/ffBookingQa` / `qaLoc1` only.

- Notes every created appointment as `FF-QA-<runId> <scenario>`
- Admin cleanup before and after the suite deletes only those QA-marked appointments
- Soft cancel in the product; Admin hard-delete is QA cleanup only
- Baseline: `qa/baselines/last-lifecycle.json` and `qa/baselines/c2ba63e-lifecycle.json`

Do not use `test:booking:e2e` for lifecycle. That command stays non-destructive.

Known **CLASS A — PRE-EXISTING AT c2ba63e** found during lifecycle (not product-fixed by QA):

- **A1.** Edit-drawer start-time save can fail with `INVALID_LINE` / “Please complete every service” even when the visible line looks complete. Time-only and time+service edits can fail; service-only edit succeeds. The suite therefore edits **service**, not start time.
- **A2.** Create drawer can throw `NotFoundError` while service search repaints `innerHTML` during blur handling. The appointment still persists.

QA-observed UI risk (not encoded as a passing product proof):

- Provider chip center can overlap an invisible start-time `<select>` hit area. Lifecycle QA clicks the lower chip edge because that is stable.

### Client lifecycle (staging writes, ffBookingQa only)

Separate from smoke and appointment lifecycle. Creates clients through the Booking UI in `salons/ffBookingQa` only.

- Search of `qaAppointmentClient` is read-only
- Browser-created clients use first name `QAClient`, last name = run id, notes `FF-QA-CLIENT-<runId> …`
- Admin cleanup deletes only those `FF-QA-CLIENT-*` notes and never `qaAppointmentClient`
- Baseline: `qa/baselines/last-clients.json` and `qa/baselines/c2ba63e-clients.json`

Known frozen **CLASS A — PRE-EXISTING AT c2ba63e** static clients-ui failures remain unchanged and are not product-fixed by this suite:

- recent list is bounded to 50
- UI recent list uses getRecentClients
- drawer update uses repository

Browser Client Lifecycle currently **PASSES** and does **not** independently reproduce those static failures as a broken Clients search/create/profile/edit flow. The static CLASS A set and the browser suite are separate evidence.

## Classification

- **A** — pre-existing at `c2ba63e`
- **B** — introduced by a product branch
- **C** — flaky / environmental (timezone, missing location, network)
- **D** — QA infrastructure (wrong project, missing creds, server, selectors we own)
