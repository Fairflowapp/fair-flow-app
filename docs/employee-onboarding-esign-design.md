# Employee Onboarding — Electronic Signature Design + Implementation Plan

**Status:** Direction approved (2026-08-09) — implementation plan ready; coding not started  
**Environment:** Staging only until explicit production approval  
**Out of scope:** SMS · production · manager countersign · regulated tax/I-9 flows in generic e-sign

**Depends on (already shipped in staging):** Package → Run → Tasks · Portal token/session · Email · Reminders · Staff Documents / Inbox upload path

### Approved product decisions (2026-08-09)

| Topic | Decision |
|-------|----------|
| Provider | **Fair Flow internal e-sign** for v1 |
| Manager countersign | **No** in v1 |
| Completed signed docs | **Never mutate.** New document version does **not** auto-reject or alter sealed signatures. Re-sign = **new signing task** when needed. |
| PDF limits | **20 MB / 50 pages** |
| Signer IP | Stored in **secure audit + certificate**; **not** shown in default manager/portal UI |
| Tier C / regulated | **Blocked by default** in v1 (not warning-only) |
| v1 document types | NDA, handbook acknowledgement, policies, agreements, custom non-regulated docs |
| W-4 / W-9 / I-9 | **Not allowed** via generic e-sign; classification guard for future separate regulated flows |

---

## 1. Recommendation (v1)

| Option | Verdict |
|--------|---------|
| **Fair Flow internal e-sign (v1)** | **Recommended for v1** for salon HR onboarding (handbooks, policies, simple acknowledgements, internal agreements). |
| DocuSign / Dropbox Sign / Adobe Sign | **Defer** unless counsel requires provider-grade ESIGN/UETA evidence for specific forms, or you need third-party identity proofing. |

**Why internal first**
- Fits Workflow Engine + Portal (same token, same CF boundary, same Storage tenant).
- Lower cost, no per-envelope fees, no OAuth/provider ops on staging.
- Full control of audit fields, versioning, and Staff Documents sync.
- Matches current Fair Flow security pattern: **no public Firestore/Storage writes**.

**Why not provider-first**
- Integration complexity (webhooks, envelope state, remapping task status).
- Cost and vendor lock-in before product-market fit of onboarding.
- Portal already anonymous-token based; providers add a second identity model.

**Hard limit:** Internal e-sign is **not** a guarantee of IRS/state acceptance for every tax form. Treat W-4 / W-9 / I-9 as a **compliance tier** (see §11), not as “any PDF + canvas signature.”

---

## 2. Task type in the Workflow Engine

### 2.1 New task type

```
electronic_signature
```

Registered like `policy_acknowledgement` / `file_upload`:
- Settings: Task Template + Package item
- Run creation: snapshot into `…/onboardingRuns/{runId}/tasks/{taskId}`
- Portal: only sees `configSnapshot` + public result fields via CF DTO

### 2.2 Lifecycle (task status)

| Status | Meaning |
|--------|---------|
| `pending` | Document package prepared; not opened / not started |
| `in_progress` | Employee opened signer UI or saved field drafts (optional) |
| `waiting_approval` | **Not used** for v1 happy path (signature is the completion act). Optional later if manager must countersign. |
| `completed` | Signed PDF + certificate sealed; Staff Documents linked |
| `rejected` | Manager voided / requested re-sign after content change |
| `skipped` | Manager skipped (if allowed) |

**v1 completion rule:** Employee signature + required fields valid → task `completed` (no Inbox approve gate). **No manager countersign in v1.**

### 2.3 Config snapshot (on task)

Frozen at Run create / document bind time:

```
configSnapshot: {
  documentId,            // salon library doc id
  documentVersionId,     // immutable version
  documentTitle,
  documentSha256,        // hash of source PDF bytes
  fieldSchema: [ ... ],  // text/date/checkbox/signature fields
  requireTypedName: bool,
  requireDrawnSignature: bool,   // default true
  consentText: string,           // “I agree that my electronic signature…”
  retentionCategory: string,     // e.g. "handbook" | "tax" | "other"
  complianceTier: "standard" | "regulated_tax" | "regulated_i9" | ...,
  allowInternalEsign: bool        // server-enforced; false for regulated tiers in v1
}
```

Changing the source document creates a **new version**. Sealed signatures are never altered. Re-sign requires a **new task** (see §6).

---

## 3. Manager: create / upload document for signature

### 3.1 Salon Signature Library (Settings or OD settings)

New collection (settings-scoped):

```
salons/{salonId}/onboardingSignatureDocuments/{documentId}
  title, category, active, currentVersionId, createdAt, updatedAt

salons/{salonId}/onboardingSignatureDocuments/{documentId}/versions/{versionId}
  storagePath, sha256, pageCount, fieldSchema, uploadedByUid, createdAt, notes
```

**Upload path (manager Auth → CF only):**
1. `createOnboardingSignatureDocumentVersion` → reserve version + V4 signed upload URL (same pattern as portal uploads).
2. Manager PUTs PDF to Staging Storage.
3. `finalizeOnboardingSignatureDocumentVersion` → verify PDF magic/size, compute SHA-256, OCR/page count optional, save schema draft.

**Field placement UI (manager, Fair Flow app):**
- PDF page viewer + drag fields: `text`, `date`, `checkbox`, `signature`, `initials` (optional v1).
- Each field: `id`, `type`, `page`, `rect` (normalized 0–1), `required`, `label`, `prefillKey?` (e.g. staff.legalName).

### 3.2 Binding into a Package / Run

Task Template `electronic_signature` references `documentId` (always **currentVersionId** at Run create time → snapshotted).

Manager may also override version when starting a Run (advanced).

---

## 4. Fields the employee fills + signature fields

| Field type | Employee input | Stored |
|------------|----------------|--------|
| `text` | Keyboard | UTF-8 string (max length) |
| `date` | Date picker | ISO date |
| `checkbox` | Toggle | bool |
| `signature` | Draw (canvas) + optional typed name | PNG/SVG bytes hash + storage path; typed name string |
| `initials` | Short draw/text | same pattern |

**Consent:** Checkbox or separate ack string (required) before Submit Signature.

**Server validation (CF):** all `required` fields present; signature stroke density / non-empty PNG; typed name if required; consent true; document version hash matches snapshot.

---

## 5. Employee Portal flow

1. Bootstrap (existing token/session).
2. Task list shows `electronic_signature` with status badge.
3. Open task → CF `onboardingPortalGetSignaturePacket`:
   - Returns **signed read URL** (short TTL) for source PDF **or** page images rendered server-side.
   - Returns field schema + any non-sensitive prefills.
   - Never returns other employees’ data.
4. Employee fills fields, draws signature, accepts consent.
5. CF `onboardingPortalSubmitSignature` (mutating):
   - Re-resolve session/token; block if run cancelled/completed-read-only for mutations; block if task already completed (idempotent return).
   - Verify version hash still matches.
   - Persist field values + signature asset under portal staging path.
   - Enqueue **seal job** (same CF or follow-up) to build Signed PDF + Certificate.
6. UI shows “Sealing…” then Completed; read-only thereafter.

**No direct Storage write from Portal** except via signed URL issued by CF for optional large signature PNG (prefer base64/small upload through CF for v1 simplicity if &lt; 1MB).

---

## 6. Document versioning

| Event | Behavior |
|-------|----------|
| New PDF uploaded / fields schema changed | New `versionId` + new `sha256` |
| Completed signatures on any version | **Immutable forever** — not auto-rejected, not rewritten |
| Need employee to sign the new version | Manager adds / Run includes a **new** `electronic_signature` task bound to the new `versionId` |
| Incomplete task still on old version | May complete against **that** snapshotted version (hash must match snapshot). Optional manager cancel/skip of the old task — not automatic. |
| Employee opens stale packet mid-sign | Submit fails with `version_mismatch` only if library bytes no longer match **this task’s** snapshotted hash (corruption / tamper), not merely because a newer library version exists |

**Rule:** Sealed documents never change. Re-sign = new task + new seal artifacts.

---

## 7. Audit trail (full)

Stored under task result + immutable audit subcollection (Admin SDK only):

```
…/tasks/{taskId}/signatureAudit/{eventId}
```

Minimum events: `packet_viewed`, `submit_accepted`, `seal_started`, `seal_completed`, `seal_failed`, `voided`.

**Per successful signature record:**

| Field | Source |
|-------|--------|
| `signerName` | Typed / staff display |
| `signerEmail` | Staff email at sign time (snapshot) |
| `signedAt` | Server timestamp |
| `ip` | From CF request (hash or truncated for privacy policy) |
| `userAgent` | Header snapshot |
| `deviceHint` | Parsed UA (mobile/desktop) |
| `documentId` / `documentVersionId` | Snapshot |
| `documentSha256` | Source PDF |
| `signedPdfSha256` | Output PDF |
| `certificateSha256` | Certificate PDF/JSON |
| `portalTokenId` | Token used (not raw token) |
| `consentTextVersion` | Hash of consent string |
| `fieldValuesHash` | Hash of canonical field JSON |

**Never log raw portal token or full signature image in Cloud Logging.**

---

## 8. Signed PDF + Signature Certificate

### 8.1 Signed PDF (v1 approach)

Server-side (Cloud Function, Node):
1. Load source PDF bytes (verified SHA-256).
2. Overlay field values + signature image at schema coordinates (e.g. `pdf-lib`).
3. Optionally embed PDF metadata: `FairFlow-Signed`, version ids, content hash.
4. Write immutable object to Storage (see §10).
5. Compute `signedPdfSha256`.

**v1.1 (stronger):** PDF certification / DocMDP via a library or external signing cert (org-managed certificate). Not required to ship internal v1 UX, but needed if counsel demands certified PDFs.

### 8.2 Signature Certificate (human-readable evidence pack)

Generate a second PDF (or PDF+JSON pair):

- Salon, staff, run, task ids  
- Document title + version + source hash  
- Signed PDF hash  
- Signer name/email  
- Timestamp (UTC)  
- IP / UA (as stored)  
- Consent text  
- Statement: “Electronically signed via Fair Flow Onboarding Portal”  
- QR or URL to salon-internal verification CF (manager-auth) that re-hashes Storage object

Certificate is **evidence**, not a substitute for jurisdictional e-sign statutes by itself.

---

## 9. Integrity after signing (tamper evidence)

| Control | Mechanism |
|---------|-----------|
| Immutability | Storage object + Firestore `result` written once; rules deny client overwrite of sealed fields |
| Hash anchor | `signedPdfSha256` + `certificateSha256` on task + audit |
| Verify API | Manager CF `verifyOnboardingSignature` re-downloads bytes, compares hashes |
| No “edit signed PDF” UI | Re-sign = new version / new task attempt |
| Optional WORM | Later: bucket retention lock on `…/signed/**` |

If bytes ≠ stored hash → treat as integrity failure; do not trust UI preview alone.

---

## 10. Storage layout

```
# Source library (manager)
salons/{salonId}/onboarding-signature-library/{documentId}/{versionId}/source.pdf

# Portal working (ephemeral)
salons/{salonId}/onboarding-portal/{staffId}/{runId}/{taskId}/signature.png
salons/{salonId}/onboarding-portal/{staffId}/{runId}/{taskId}/fields.json

# Sealed outputs (immutable)
salons/{salonId}/staff/{staffId}/documents/{documentType}/{yyyy-mm}/{taskId}_signed.pdf
salons/{salonId}/staff/{staffId}/documents/{documentType}/{yyyy-mm}/{taskId}_certificate.pdf
```

- Portal paths: same deny-public-write rules as today’s `onboarding-portal/**`.
- Signed outputs: same Staff Documents tree managers already use.
- All writes via Admin SDK / signed URL minted by CF.

---

## 11. Auto-file into Staff → Documents

On seal success (single CF transaction/batch):

1. Write signed PDF + certificate to Staff Documents paths.  
2. Create/update Staff Documents registry entry (same shape as approved Inbox uploads: type, filePath, expiration if any, `onboardingRunId`, `onboardingTaskId`, `via: "portal_esign"`).  
3. Set task `status: completed` + `result` links (`signedDocumentId`, hashes, signedAt).  
4. Progress recompute (existing `onOnboardingTaskWrite`).  

**No Inbox approval gate in v1** unless template requires countersign.

---

## 12. Idempotency / double-sign prevention

| Layer | Behavior |
|-------|----------|
| Task status | If `completed` with same `documentVersionId` + `signedPdfSha256`, return success no-op |
| Submit lock | Transaction: only transition `pending|in_progress|rejected` → `sealing` → `completed` |
| Seal job id | Deterministic `seal_{taskId}_{documentVersionId}` |
| Client double-tap | Second submit sees `sealing`/`completed` |
| New version | New seal id; old completed untouched |

---

## 13. Revoke / cancel behavior

| Case | Behavior |
|------|----------|
| Run `cancelled` | Portal mutating blocked (existing); unsigned tasks abandoned; sealed docs remain in Staff Documents |
| Portal token revoked | Cannot open/sign; sealed docs remain |
| Manager voids a completed signature (rare) | Staff Documents entry can be marked `voided` in registry metadata only; **PDF bytes stay**; re-sign = new task on (usually new) version |
| Incomplete task | Manager may skip/cancel task; no automatic reject on library version bump |

---

## 14. Cloud Functions only (mandatory)

| Action | CF |
|--------|----|
| Library upload URL + finalize + hash | Yes |
| Field schema save (manager) | Prefer CF if it affects hash/version; or manager Auth + rules with version immutability |
| Portal packet (PDF read URL) | Yes |
| Submit signature + seal PDF/certificate | Yes |
| Staff Documents write from portal | Yes |
| Verify hashes | Yes |
| Void signature | Yes |

**Client never:** trusted hash, seal, Staff Documents write, raw audit IP, or source PDF path without signed URL.

---

## 15. Compliance classification guard (v1)

Do **not** assume one ruleset for all PDFs.

| Tier | Examples | Generic internal e-sign v1 |
|------|----------|----------------------------|
| `standard` | NDA, handbook acknowledgement, policies, agreements, custom salon docs | **Allowed** |
| `regulated_tax` | W-4, W-9, state withholding | **Blocked** |
| `regulated_i9` | Form I-9 | **Blocked** |
| `regulated_other` | Future reserved | **Blocked** |

**Enforcement (all layers):**
1. Manager UI: cannot select blocked tiers for “Sign with Fair Flow” / cannot finalize library version as signable if tier blocked.
2. Package / Run create: reject `electronic_signature` items whose document tier is not `standard` (or `allowInternalEsign !== true`).
3. Portal submit/seal CF: hard fail if snapshot tier is regulated.

**Future:** separate regulated signing flows can set `allowInternalEsign` / `sealProvider` under a different product path without opening the generic flow.

---

## 16. Provider comparison (when to switch)

| | Internal Fair Flow | DocuSign / Dropbox Sign / Adobe |
|--|-------------------|----------------------------------|
| Cost | Low | Per envelope |
| UX in Portal | Seamless | Redirect / embed |
| Audit | Full, our schema | Vendor certificate + our mirror |
| Legal market perception | Weaker for Tier C | Stronger |
| Ops | We own PDF rendering bugs | Vendor SLA |
| Data residency / DPA | Our GCP | Vendor DPA |

**Strategy:** Ship **internal e-sign for Tier A (and selected B)** in staging → gather counsel feedback → add **provider adapter** later for Tier C without rewriting Workflow Engine (task type stays `electronic_signature`; `sealProvider: "internal" | "docusign"`).

---

## 17. Risks

### Technical
- PDF coordinate drift across renderers → visual mismatch; mitigate with page-image overlay preview = seal canvas.
- Function memory/time for large PDFs → hard limit **20 MB / 50 pages**.
- Clock skew / mobile Safari canvas → server-side emptiness checks.
- Hash mismatch after Storage compose bugs → verify before marking completed.

### Legal / product (not legal advice)
- ESIGN/UETA (US) generally recognize e-signatures when consent + association + retention exist — **implementation details matter**.
- Regulated tax/I-9 forms are **product-blocked** in generic e-sign v1.
- Cross-border employees → different rules; out of v1 scope.

### Security
- Token theft = signing capability until revoke — same as today’s portal uploads; keep TTL, revoke, rate limits.
- Signed URL leakage for source PDF — short TTL, no token in logs.
- Full IP in audit/certificate only; default UIs omit IP.

---

## 18. Implementation plan (staging only)

Coding starts only after explicit “start e-sign implementation” approval. Deploy target: **`fair-flow-staging` only**. No production.

### Phase E0 — Foundations (½–1 day)
- Add `electronic_signature` to task registry + labels + config normalize/validate.
- Define `complianceTier` enum + server/client guards (`standard` only signable).
- Firestore rules: deny client write to signature library sealed versions, audit, sealed result fields.
- Storage rules: library + portal working + deny public write (mirror onboarding-portal pattern).
- Indexes as needed (document versions by `createdAt`, tasks by type if queried).
- **Exit:** registry + rules deployed to staging; no UI yet.

### Phase E1 — Signature document library (manager) (1–2 days)
- Collections: `onboardingSignatureDocuments` + `versions`.
- CF: `createSignatureDocument` / `createSignatureDocumentVersionUpload` / `finalizeSignatureDocumentVersion`.
- Validate PDF: content-type, size ≤ 20MB, page count ≤ 50 (pdf-lib), SHA-256.
- Block finalize if `complianceTier` ∈ regulated_* .
- Settings UI: list/create docs, upload PDF, set title/tier/category.
- **Exit:** manager can upload a standard PDF version with hash in staging.

### Phase E2 — Field schema editor (manager) (1–2 days)
- Page preview (PDF.js in Fair Flow app).
- Place fields: text, date, checkbox, signature (+ optional initials).
- Save schema on version via CF (version immutable after first bind to a Run task — or freeze schema on first Run snapshot).
- Package / Task Template: pick document (current version snapshotted at Run create).
- **Exit:** package can include `electronic_signature` task with field schema snapshot.

### Phase E3 — Seal pipeline CF (2–3 days)
- `onboardingPortalGetSignaturePacket` — session auth; signed read URL; schema; no IP in response.
- `onboardingPortalSubmitSignature` — validate fields/consent/signature; tier guard; idempotent.
- Seal: overlay with pdf-lib → signed PDF + certificate PDF; store hashes; write Staff Documents; complete task; audit events **including full IP** on audit doc only.
- Deterministic seal id; double-submit safe.
- Unit/integration tests on staging with sample PDF.
- **Exit:** curl/callable can seal a fixture end-to-end without Portal UI.

### Phase E4 — Portal signer UI (1–2 days)
- Task type in portal list + detail.
- Mobile-first: PDF/pages, fields, canvas signature, consent, submit, sealing state, completed read-only.
- No IP display; no raw token logs/analytics.
- **Exit:** employee can sign via `/onboarding/{token}` on phone.

### Phase E5 — Run UX + Staff Documents polish (1 day)
- Manager Run panel: task status, open audit summary (no IP by default; “secure details” later optional).
- Confirm Documents tab shows signed PDF + certificate.
- Cancel run / revoke token behavior smoke.
- New version → create additional task path documented in UI copy (no auto-mutate).
- **Exit:** manager-visible E2E on staging salon.

### Phase E6 — Hardening + staging verification (1 day)
Checklist (staging) — verified 2026-08-09 via `onboarding-esign-e6-verify.mjs` (35/35):
- [x] Upload 20MB boundary / 51st page rejected  
- [x] Regulated tier cannot finalize or sign  
- [x] Sign → Staff Documents + task completed  
- [x] Double submit idempotent (+ atomic seal claim)  
- [x] Completed signed PDF hash stable after new library version  
- [x] New version + new task can be signed independently  
- [x] Cancelled run / revoked token cannot sign  
- [x] Audit has IP; default UI does not show IP  
- [x] No token leakage in logs / portal console  
- [x] Read-only portal after run completed  

**Stop before:** SMS, provider adapters, production, regulated flows.

### Suggested file touchpoints (when coding starts)
| Area | Likely paths |
|------|----------------|
| Registry | `public/employee-onboarding/task-registry.js` |
| Settings UI | `public/employee-onboarding/settings-*.js` (+ new signature-library module) |
| Run snapshot | `public/employee-onboarding/run-cloud.js` |
| Portal UI | `public/onboarding-portal/*` |
| CF | `functions/onboarding-esign.js` (new) wired from `functions/index.js` |
| Rules | `firestore.rules`, `storage.rules` |
| Design | this doc |

### Dependencies to add (functions)
- `pdf-lib` (seal + page count)
- Optional: `pdfjs-dist` only in **client** field editor (not in CF if avoidable)

### Explicit non-goals for this plan
- Manager countersign  
- Auto-reject sealed or incomplete tasks on version bump  
- W-4 / W-9 / I-9 / regulated generic signing  
- DocuSign/Adobe  
- Production deploy  
- SMS  

---

## 19. Ready for implementation

Open product decisions from the prior draft are **closed** (see Approved table at top).

**Next human gate:** explicit message to start coding Phase E0 on staging (e.g. “התחילי מימוש e-sign”).

---

*Implementation plan only. No code or deploy is authorized by this document alone.*
