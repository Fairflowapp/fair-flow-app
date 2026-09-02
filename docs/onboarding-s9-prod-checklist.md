# Employee Onboarding — S9 production checklist

Environment rule: **nothing goes to `fairflowapp-db841` / app.fairflowapp.com without an explicit production order in that message.**

S9 is preparation. Completing this file is not a production deploy.

---

## Locked stages (staging)

| Stage | What | Staging |
|--------|------|---------|
| S0 | Token + session; Storage deny; Reveal owner/admin | Done (retention 7y later withdrawn) |
| S1 | `onboardingArtifacts/` + client Storage deny | Done |
| S2 | AES-256-GCM + Reveal + audit | Done |
| S3–S4 | Sensitive fields + encrypt on submit/seal | Done |
| S5 | Writes via callables; Firestore `write: false` | Done |
| S6 | One-time portal bootstrap + link UX | Done, verified |
| S7 | Signed URL only + access audit + locked PDF view | Done, verified |
| S8 | Product: **no 7-year cloud archive**. Two delete warnings. Daily purge disabled. | Done, verified |
| S9 | Key backup + this checklist | In progress |

---

## Product rules that must stay in production

- Employee auth = portal token + one-time bootstrap + 2h session. No employee Firebase Auth. No PIN for SSN.
- Storage read/write on `onboardingArtifacts/**` = deny. Access = signed URL (~5 min).
- Client never calls `getDownloadURL` for onboarding files.
- Sensitive fields: ciphertext + last4 in Firestore; Reveal audited.
- Sealed PDF is immutable. Mistake → new signing task.
- Staff: Archive keeps the person and files. Delete = two confirmations; salon keeps its own copies.
- Fair Flow does **not** promise a legal 7-year archive.

---

## Secrets

| Secret | Staging | Production |
|--------|---------|------------|
| `ONBOARDING_FIELD_ENCRYPTION_KEY` | Must exist, unique | Create only after S9 gate; **different** key |
| `ONBOARDING_PORTAL_HMAC_SECRET` | Must exist, unique | Create only with production deploy; **different** secret |

Verify (no values printed):

```bash
node .local-patches/onboarding-s9-dry-restore.cjs --project fair-flow-staging
```

---

## Functions / IAM (when production is approved)

Deploy **by name**, not the whole codebase. After create:

- Set `invokerIamDisabled=true` on each new onCall (same helper as staging: `.local-patches/set-onboarding-portal-fns-invoker-disabled-staging.js`, pointed at prod only when ordered).
- Bind SM secrets on submit/seal/Reveal/portal functions.
- Do not copy staging secret versions into prod.

---

## Hosting / rules (when production is approved)

- Firestore rules: onboarding collections `create/update/delete: if false`
- Storage rules: `onboardingArtifacts/{salonId}/**` deny read + write
- Hosting cache-bust for portal bundle + `index.html`
- Portal: `app.bundle.js` rebuilt if `app.js` / `app-shared.js` changed

---

## Still blocked until you say so

- [x] Dual-custody files created on this Mac (2026-08-15): envelope in `~/fair-flow-key-backups`, passphrase in `~/Documents`. Copy to password manager + offline; do not leave both only on the laptop.
- [x] Staging dry-restore passed (2026-08-15, Bobo live ciphertext)
- [x] Production encryption key created (2026-08-15, fingerprint 2efcc04895c0, different from staging). App not deployed.
- [x] Explicit message: deploy onboarding to production (2026-08-16 hosting `20260816021429`, functions by-name, rules, invokerIamDisabled)
