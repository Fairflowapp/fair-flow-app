# Employee Onboarding Portal — Design Doc (Stage E)

**Status:** Product decisions approved — Pre-Portal Hardening in progress  
**Scope:** Secure public portal for completing an Onboarding Run without a Fair Flow login  
**Out of scope for Stage E:** Email, SMS, Reminder cron, E-sign provider, Production deploy  
**Environment later:** Staging only until explicit production approval  

### Approved product decisions (2026-08-08)

| Topic | Decision |
|-------|----------|
| Active tokens | **One active token per Run.** Reissue supersedes/revokes the previous token. |
| After Run completed | Employee may **open link read-only** (status + their documents/tasks). **No mutations.** |
| TTL | Default **30 days.** Manager may extend, revoke, or issue a new token. |
| Link delivery | **Copy Link** required in manager UI (WhatsApp/SMS/etc.). Email later. |
| Hosting | Same Fair Flow hosting: `…/onboarding/{token}` (staging + later production app host). Subdomain only if needed later. |

**Sequence:**
1. Pre-Portal Hardening ← current
2. Portal backend (tokens + Cloud Functions)
3. Portal UI + Copy Link
4. Later: Email → Reminder → E-sign

---

## 1. Goals

- Manager starts onboarding (existing Stage D Run).
- System issues a **Portal link** bound to that Run.
- Employee opens the link on any device, **without** Fair Flow account / salon membership.
- Employee sees Welcome → Progress → Tasks → Upload / Policy → Complete.
- All sensitive writes happen via **Cloud Functions** with server-resolved token context.
- Portal never reads Settings catalogs; only the Run snapshot + its tasks.

---

## 2. URL structure

### Preferred (v1)

```
https://fair-flow-staging.web.app/onboarding/{token}
https://app.fairflowapp.com/onboarding/{token}   # production later only
```

- `{token}` = high-entropy opaque secret (see §3). Appears **only in the URL / initial handoff**.
- Hosting rewrite: `/onboarding/**` → dedicated portal shell page (e.g. `onboarding-portal.html`), **not** the main app shell.
- Query params must **not** carry `salonId`, `staffId`, or `runId`. Those are resolved server-side from the token.

### Alternatives (deferred)

| Option | Notes |
|--------|--------|
| `portal.fairflowapp.com/o/{token}` | Cleaner brand separation; needs DNS + second hosting target. Defer unless desired in same Stage E. |
| `/p/{token}` | Shorter; less self-describing. OK as alias later. |

### Deep links inside Portal (client routing only)

After bootstrap, the SPA may use hash or path under the same token page:

- `#/` or `/onboarding/{token}` — Welcome + progress
- `#/tasks/{taskId}` — task detail (taskId from server payload only)
- `#/complete` — completion summary

Changing the URL path must **not** accept alternate salon/run IDs from the client.

---

## 3. Token model (full)

### 3.1 Generation (manager-authenticated callable)

Callable (manager only): `issueOnboardingPortalToken`

Inputs (authenticated manager context):

- `salonId` (must match caller’s salon)
- `staffId`
- `runId`
- optional `ttlDays` (default **30**, max **90**); manager may later extend

Server steps:

1. Verify caller is manager/admin/owner for `salonId` (same gate as run management).
2. Load Run; reject if missing / `cancelled` / `completed` (reissue policy below).
3. Generate raw token: **32+ bytes** from CSPRNG → URL-safe base64/base64url (~43 chars).
4. Compute `tokenHash = SHA-256(rawToken)` hex (or raw bytes stored as hex string).
5. Write token **doc** keyed by hash (see §4). **Never store raw token in Firestore.**
6. Return `{ url, expiresAt, tokenId }` to manager UI once.  
   - Raw token is returned **only in this response** (and put into clipboard/share UI).  
   - No raw token in logs, analytics, Firestore, or error messages.

### 3.2 Fields on token document

Path: `salons/{salonId}/onboardingPortalTokens/{tokenId}`

Recommended `tokenId` = first 16–32 hex chars of `tokenHash` (or full hash as doc id). Doc id must be derived from hash so lookup is O(1) by hash without scanning.

| Field | Type | Notes |
|-------|------|--------|
| `tokenHash` | string | SHA-256 hex of raw token; unique |
| `salonId` | string | Denorm; must match path |
| `staffId` | string | Bound staff |
| `runId` | string | Bound run |
| `status` | `'active' \| 'revoked' \| 'expired' \| 'superseded'` | |
| `expiresAt` | Timestamp | Absolute expiry |
| `createdAt` | Timestamp | |
| `createdByUid` | string | Manager who issued |
| `revokedAt` | Timestamp \| null | |
| `revokedByUid` | string \| null | |
| `revokeReason` | string \| null | e.g. `run_cancelled`, `manual`, `reissue` |
| `lastUsedAt` | Timestamp \| null | Updated on successful resolve (throttled) |
| `useCount` | number | Optional; increment on bootstrap |
| `replacedByTokenId` | string \| null | On reissue |
| `replacesTokenId` | string \| null | Previous token |
| `schemaVersion` | number | Start at `1` |

**Never store:** raw token, employee PII beyond what’s already on staff/run, Settings catalog copies.

### 3.3 Expiration

- Default TTL: 30 days from issue.
- On every Portal CF call: if `expiresAt < now` → treat as expired; set `status: expired` (best-effort) and deny.
- Expired tokens cannot be revived; manager must **reissue**.

### 3.4 Revoke

Triggers:

- Manager explicit “Revoke portal link”
- Run `cancelled`
- Reissue (old token → `superseded` / `revoked` with reason `reissue`)
- Optional: Run `completed` → revoke remaining active tokens (recommended)

Callable: `revokeOnboardingPortalToken` (by `tokenId` or by `runId` = revoke all active for run).

### 3.5 Reissue

Callable: `reissueOnboardingPortalToken` (`salonId`, `staffId`, `runId`)

1. Revoke/supersede all `active` tokens for that run.
2. Issue a new token (same as generate).
3. Return new URL once.

Product: old links die immediately; only latest link works (v1 single-active-token-per-run).

### 3.6 lastUsedAt

- Updated on successful `portalBootstrap` / authenticated portal action.
- Throttle writes (e.g. at most once per 5 minutes) to limit write amplification.
- Used for support/debug only; not a security boundary.

### 3.7 Logging rules

- Log `tokenId`, `salonId`, `staffId`, `runId`, `action`, `result` — **never** raw token or full URL with token.
- Strip `Authorization` / URL path secrets from CF request logs if the platform captures URLs.
- Client: do not send token to third-party analytics.

---

## 4. Where tokens live & relationship to Run

```
salons/{salonId}/onboardingPortalTokens/{tokenId}
        │
        ├── salonId
        ├── staffId  ──► salons/{salonId}/staff/{staffId}
        └── runId    ──► .../staff/{staffId}/onboardingRuns/{runId}
                              └── tasks/{taskId}
```

### Binding rules

- One Run can have a history of tokens; **at most one `active`** in v1.
- Token is useless without a live non-cancelled Run.
- Run document should denorm portal summary (optional, for manager UI):

```
portal: {
  activeTokenId: string | null,
  lastIssuedAt: Timestamp | null,
  lastIssuedByUid: string | null,
  revokedAt: Timestamp | null
}
```

No raw token on the Run.

### Why salon-scoped collection (not under staff/run)

- Lookup by hash without knowing `staffId`/`runId`.
- Revoke-all-for-run / security scanning / rate-limit buckets by salon are simpler.
- Avoids granting Portal clients any list permission under `staff/...`.

---

## 5. Server resolve: token → run (never trust client IDs)

### Bootstrap flow

1. Portal page extracts raw token from path.
2. Client calls HTTPS callable/request: `onboardingPortalBootstrap` with `{ token }` only.
3. Server:
   - `hash = SHA256(token)`
   - Load token doc by hash/docId
   - Validate `status === active`, `expiresAt > now`
   - Load Run at `salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}` from **token fields only**
   - Reject if Run missing / `cancelled` (and preferably if `completed` for further edits)
   - Load tasks subcollection server-side
   - Return **least-privilege DTO** (see §12)
4. Client stores a short-lived **portal session capability** returned by server (see below), not salon IDs as authority.

### Portal session (recommended)

After bootstrap, server returns:

- `sessionToken` (second opaque secret, TTL short e.g. 1–2 hours) **or** signed JWT/HMAC cookie with claims `{ tokenId, salonId, staffId, runId, exp }` using a server secret.
- Subsequent action calls send `sessionToken` (or cookie) — server re-validates signature/session store and **re-checks** underlying portal token still active + run still allowed.

v1 minimum acceptable: send raw portal token on every CF call (simpler) with rate limits; session token preferred to avoid putting long-lived secret on every request body after first paint. **Design choice for implementation: sessionToken HMAC, 2h, sliding optional.**

### Critical rule

Any client-supplied `salonId` / `staffId` / `runId` / `taskId` on mutating calls is treated as **hint at most**. Server always binds from token/session. `taskId` must exist under the bound run or the call fails.

---

## 6. Operations that go through Cloud Functions only

Portal client has **no** direct Firestore write access to runs/tasks/tokens/inbox.

| Operation | Callable / HTTP | Auth |
|-----------|-----------------|------|
| Issue / reissue / revoke token | `issue…` / `reissue…` / `revoke…` | Manager Firebase Auth |
| Bootstrap portal | `onboardingPortalBootstrap` | Portal token |
| Get fresh run/tasks snapshot | `onboardingPortalGetState` | Portal session |
| Acknowledge policy | `onboardingPortalAckPolicy` | Portal session |
| Start upload (get signed upload target) | `onboardingPortalCreateUpload` | Portal session |
| Finalize upload → create Inbox item + task waiting | `onboardingPortalFinalizeUpload` | Portal session |
| (Optional) skip — **not in Portal v1** | Manager-only in Fair Flow | Manager Auth |

Manager Fair Flow UI may keep client writes temporarily for in-app ack/upload **until Hardening moves completion server-side**; Portal path is CF-only from day one.

---

## 7. Immutable fields (Run / Task)

Once a Run is created, these must be immutable for **everyone except Admin SDK / privileged migration scripts**:

### Run

- `packageId`
- `packageNameSnapshot`
- `packageDescriptionSnapshot`
- `audienceSnapshot`
- `createdBy`
- `createdAt` / `createdAtMs`
- Add in hardening: `schemaVersion`, optional `packageItemsSnapshot`

### Task

- `templateId`
- `templateNameSnapshot`
- `taskType`
- `categoryId` / `categoryNameSnapshot`
- `required`
- `sortOrder`
- `configSnapshot` (entire map, including policy `bodyHtml` + `version`)

### Mutable (server-only for Portal; tight rules for app)

- Run: `status`, `progress`, `sentAt`, `completedAt`, `cancelledAt`, `updatedAt`, `portal.*`
- Task: `status`, `result`, `completedAt`, `completedBy`, `updatedAt`

Hardening (pre-Portal) should encode immutability in Firestore Rules for client SDK; Cloud Functions use Admin SDK and enforce immutability in code.

---

## 8. Operations that require a Transaction

All of the following must run in a **Firestore transaction** (or batched write with precondition reads in one transaction):

1. **Policy ack**  
   Read task + run → verify pending → write task `completed` + `result` → recompute progress from **transaction-read** tasks → update run `progress`/`status`/`completedAt`.

2. **Upload finalize**  
   Read task + run → verify allowed status → create inbox item (may be outside txn if needed) → update task `waiting_approval` + `result.inboxItemId` → recompute run progress/status.

3. **Inbox approve / reject hooks (manager path)**  
   Prefer moving onboarding task completion into the same server path as approve, or a transaction that:
   - verifies inbox item approved/denied
   - sets task completed/rejected idempotently
   - recomputes run progress

4. **Cancel run**  
   Set run `cancelled` + revoke all active portal tokens (token updates can be batch after run cancel in same CF).

5. **Issue/reissue token**  
   Transaction: ensure single active token (read active for run → supersede → create new).

**Idempotency keys inside txn:**

- Policy: if task already `completed` with same `policyVersion`, return success no-op.
- Approve: if task `completed` and `result.linkedDocumentId` matches, no-op.
- Finalize upload: include `uploadId` / storage path uniqueness so double-finalize doesn’t create two inbox items.

---

## 9. Upload without wide-open Storage

### Problem

Opening `salons/{salonId}/staff/{staffId}/documents/**` write to unauthenticated users is unacceptable.

### Design: signed / mediated upload

1. Portal calls `onboardingPortalCreateUpload` with `{ sessionToken, taskId, fileName, contentType, size }`.
2. Server validates session, run, task type (`document` \| `file_upload`), status, mime/size against `configSnapshot`.
3. Server creates an **upload slot** doc:

   `salons/{salonId}/onboardingPortalUploads/{uploadId}`

   Fields: `staffId`, `runId`, `taskId`, `tokenId`, `storagePath`, `contentType`, `maxSize`, `status: 'reserved'|'uploaded'|'finalized'|'expired'`, `expiresAt` (e.g. 30 minutes).

4. Server returns a **V4 signed URL** (PUT) to a dedicated path:

   ```
   salons/{salonId}/onboarding-portal/{staffId}/{runId}/{taskId}/{uploadId}_{safeName}
   ```

   Storage rules: **deny all client access**; only Admin/signed URL can write. No public read.

5. Client PUTs bytes to signed URL.
6. Portal calls `onboardingPortalFinalizeUpload`:
   - Server verifies object exists (Admin Storage getMetadata), size/contentType
   - Creates Inbox `document_upload` with additive fields (`onboardingRunId`, `onboardingTaskId`, `templateId`, `taskType`, `documentOwnerStaffId`)
   - Uses existing owner resolution / approve → Staff Documents flow
   - Updates task → `waiting_approval` inside transaction
   - Marks upload slot `finalized`

### Why keep Inbox

- Managers already approve/reject in Inbox.
- Staff Documents sync stays unchanged.
- Portal does not invent a second approval UI in v1.

---

## 10. Policy acknowledgement via Portal

1. Bootstrap DTO includes task list; for `policy_acknowledgement`, include:
   - `templateNameSnapshot`, `status`, `required`, `configSnapshot.version`
   - `configSnapshot.bodyHtml` (sanitized — §14)
   - flags: `requireTypedName`, `requireScrollToEnd`
2. Employee opens policy task → reads content → optional typed name → Confirm.
3. `onboardingPortalAckPolicy` with `{ sessionToken, taskId, typedName? }`:
   - Server loads `configSnapshot` from task (not client body)
   - Validates typed name if required
   - Optionally records `ackedPolicyVersion = configSnapshot.version`
   - Transaction: complete task + recompute run
4. Response returns updated progress DTO.

No client-side progress math is authoritative.

---

## 11. Document / file_upload → existing Inbox

Portal finalize creates the **same** inbox shape Stage D already uses:

- `type: 'document_upload'`
- `status: 'open'`
- `visibility: 'managers_only'`
- `data.documentOwnerStaffId = staffId` (from token)
- `data.onboardingRunId`, `data.onboardingTaskId`, `data.templateId`, `data.taskType`
- `data.filePath` / `fileUrl` / `fileName` pointing at portal storage path (or server copies into classic staff documents path on finalize — **prefer copy or single canonical path under staff documents written by Admin SDK** so approve sync path stays unchanged)

**Recommendation:** On finalize, Admin SDK writes the file (or copies) to the existing staff documents storage layout used by Inbox today, then creates inbox item with that path. Minimizes changes to `ffSyncStaffDocumentOnInboxApprove`.

Reject → existing deny path + onboarding reject hook (should also be hardened to CF/transaction in manager path).  
Resubmit → new upload slot + new inbox item; task returns to `waiting_approval`.

---

## 12. Revoke / cancel ⇒ Portal access ends

| Event | Effect |
|-------|--------|
| Run `cancelled` | CF/manager path sets run cancelled; **revoke all active tokens** for `runId`; portal session validation fails |
| Manual revoke link | Token `revoked`; sessions bound to `tokenId` fail |
| Reissue | Previous tokens `superseded`; only new URL works |
| Run `completed` | Token may remain valid until expiry; bootstrap returns **read-only** state (status + tasks/docs). All mutating Portal CFs deny. |

Every Portal CF call re-reads token status + run status. No long-lived “trust after bootstrap” without revalidation.

---

## 13. Server-side completion / progress

Single shared function (Admin SDK), used by Portal CFs and (after hardening) manager/inbox hooks:

```
computeOnboardingRunProgress(tasks) → { progress, status }
```

Rules (unchanged product logic from Stage D):

- Required tasks must be `completed` for run `completed`.
- Optional `skipped` / pending does not block.
- `cancelled` is sticky; never auto-overwritten to completed.

Authoritative writes:

- Only server updates `run.progress` / `run.status` / `run.completedAt`.
- Client Fair Flow UI becomes read-only for those fields after hardening (or manager CF wrappers).

---

## 14. Rate limiting / brute-force

| Surface | Protection |
|---------|------------|
| Bootstrap / actions with raw token | Per-IP + per-tokenHash bucket (e.g. 30 req / 10 min / IP; 60 / 10 min / token). On exceed → 429 |
| Token guessing | 32-byte entropy makes guessing impractical; still apply IP throttle + constant-time hash compare |
| Issue/reissue (manager) | Normal auth + per-uid rate limit |
| Upload create | Per-session limits (e.g. 20 uploads / hour / run) |
| Finalize | Must reference valid reserved `uploadId` |

Store counters in Memorystore/Firestore shard docs `rateLimits/{bucketId}` with TTL fields, or Cloud Armor later. v1: Firestore rate doc with transaction increment is acceptable on staging.

Failed auth: generic error `"Invalid or expired link"` (no existence oracle distinguishing missing vs revoked if avoidable).

---

## 15. CSRF / XSS / bodyHtml

### CSRF

- Prefer callable with App Check (staging optional, prod recommended) + custom session token in header.
- If cookie session is used: `SameSite=Strict`, `__Host-` cookie, CSRF token for cookie-based POST.
- v1 recommendation: **no cookies**; `sessionToken` in memory + `Authorization: Bearer` / request body; reduces CSRF.

### XSS

- Treat `configSnapshot.bodyHtml` as **untrusted HTML**.
- Server-side sanitize on bootstrap (allowlist tags: `p, br, ul, ol, li, strong, em, a[href], h1-h3`) before sending to Portal.
- Portal renders sanitized HTML only; never `eval`.
- Typed name and notes: text only, escaped in UI.
- CSP on portal HTML: strict `default-src 'self'`; allow Firebase/CF endpoints; disallow framer/foreign scripts.

### Clickjacking

- `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'` on portal page.

---

## 16. Least-privilege Portal DTO

Bootstrap / getState returns **only**:

```
{
  sessionToken,
  expiresAt,                 // portal token expiry
  salon: { name },           // display only
  staff: { displayName },    // first name / full name as product decides
  run: {
    id, status, progress, dueDate,
    packageNameSnapshot, packageDescriptionSnapshot
  },
  tasks: [{
    id, templateNameSnapshot, taskType, categoryNameSnapshot,
    required, sortOrder, status,
    config: { /* task-type allowlisted fields only */ },
    resultPublic: { /* non-sensitive subset, e.g. rejectionReason */ }
  }]
}
```

**Never return:**

- Settings catalogs / other packages / other staff
- Other runs
- Manager uids beyond necessity
- Raw token hash
- Full inbox items
- Internal storage signed URLs except short-lived upload PUT URL for the active task

---

## 17. Data model + indexes

### Collections

```
salons/{salonId}/onboardingPortalTokens/{tokenId}
salons/{salonId}/onboardingPortalUploads/{uploadId}
# existing
salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}
salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}/tasks/{taskId}
```

### Indexes required

| Query | Index |
|-------|--------|
| Active tokens for a run (reissue/revoke-all) | Collection `onboardingPortalTokens`: `runId` ASC + `status` ASC + `createdAt` DESC |
| Optional: expire job | `status` ASC + `expiresAt` ASC |
| Uploads by task (debug) | `runId` ASC + `taskId` ASC + `createdAt` DESC |

Token bootstrap: **get by doc id/hash** — no composite index.

Salon-wide dashboards still out of Portal Stage E; denorm on Run (`salonId`, `status`, `dueDate`) remains a later Hardening/Dashboard item, not required for Portal bootstrap.

---

## 18. Rules changes required before Portal

### Must (Pre-Portal Hardening + Portal launch)

1. **Lock snapshot fields** on Run/Task updates (client SDK cannot change snapshots).
2. **Remove employee ability to write `run.progress` / `run.status`** freely — either deny client updates entirely for progress fields, or allow only Manager + Admin SDK.
3. **Deny all client access** to `onboardingPortalTokens` and `onboardingPortalUploads` (read/write false); only Admin SDK.
4. **Do not** grant Portal users membership-based read on Settings catalogs for portal operation (already unused by portal DTO).
5. Storage: deny client write to `onboarding-portal/**`; signed URL / Admin only.
6. Keep Inbox create rules as-is for managers/staff app; Portal creates inbox **only via Admin SDK** in CF (bypasses client create rules).

### Should

7. Align manager gates (client vs `users.role` vs `settings_manage`) documentation; Portal issue token uses Rules-equivalent server check.
8. Policy HTML not required in client-readable catalogs for portal employees (they only get snapshot via CF).

---

## 19. Pre-Portal Hardening checklist

Do this **before** Portal UI implementation.

### A. Rules hardening

- [x] Task immutable fields enforced on update (`templateId`, names, `taskType`, `required`, `sortOrder`, `category*`, `configSnapshot`)
- [x] Run immutable fields enforced (`package*Snapshot`, `audienceSnapshot`, `packageId`, `createdBy`, `createdAt*`)
- [x] Employee cannot set run to `completed` / forge `progress` (no employee run updates)
- [x] Manager updates cannot rewrite snapshots (cancel/sent/dueDate/portal only; cannot forge `completed`)
- [x] No broad write on `staff/.../onboardingRuns`

### B. Immutable snapshots

- [x] Create-run path remains snapshot-at-create
- [x] Add `schemaVersion` on new runs
- [x] Document which fields are frozen (this doc §7)
- [x] Policy body used at ack time always from `task.configSnapshot`

### C. Transactional completion / progress

- [x] Client task mutations use `runTransaction`; run progress via `onOnboardingTaskWrite` (Admin txn)
- [x] Idempotent complete/reject helpers
- [x] Module `Set` locks remain as UX guard only — not sole protection

### D. Lazy Settings listeners

- [x] Do not subscribe categories/templates/packages for every signed-in user
- [x] Subscribe on Settings → Onboarding via `ffEnsureOnboardingSettingsSubscribed` (ref-counted)
- [x] Clear caches on salon change immediately

### E. Naming / folder separation from owner onboarding

- [x] Owner wizard modules left untouched
- [x] Employee OD under `public/employee-onboarding/` (+ thin stubs at old paths)
- [ ] Portal later: `public/onboarding-portal/` + `onboarding-portal.html`
- [x] `safe-loader.js` points at employee-onboarding paths

### F. Out of hardening (explicitly later)

- Email send of portal link
- Reminder scheduler
- E-sign provider
- Salon-wide runs dashboard indexes (unless needed for manager “copy link” UI)

---

## 20. Stage E implementation slices (for later approval)

Suggested PR slices after Hardening:

1. **Token CFs** — issue / revoke / reissue / bootstrap + rules deny on token collection  
2. **Portal actions CFs** — ack + upload signed URL + finalize→Inbox + transactional progress  
3. **Portal UI** — static shell + pages (Welcome / Tasks / Policy / Upload / Complete)  
4. **Manager UI** — “Copy portal link” / Revoke / Reissue on Run panel (no email yet)  
5. Staging verify checklist (below)

---

## 21. Staging verification plan (when implementing)

- Issue token → open URL logged-out → bootstrap shows correct package/tasks only  
- Raw token not in Firestore / functions logs  
- Expired / revoked / cancelled run → generic failure  
- Reissue invalidates old link  
- Policy ack completes task + server progress; double-submit idempotent  
- Upload → Inbox item with onboarding fields → manager approve → Staff Document + task completed  
- Reject → resubmit via portal  
- Optional skip remains manager-only (not in portal)  
- Settings catalogs not readable via portal network tab payloads  
- Regression: in-app Stage D manager flows still work  
- **No production deploy**

---

## 22. Product decisions

All open items from the prior draft are **approved** — see header table.

---

## 23. Approval gate

Product direction approved. **Pre-Portal Hardening** proceeds next on staging only; Portal UI only after Hardening completes.
