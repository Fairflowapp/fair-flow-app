# Onboarding encryption key — runbook (S9)

**Never put the raw key in git, chat, tickets, or screenshots.**  
**Staging and production keys must be different.**  
**Do not deploy `ONBOARDING_FIELD_ENCRYPTION_KEY` to production until the gate at the bottom is checked.**

Secret name: `ONBOARDING_FIELD_ENCRYPTION_KEY`  
Format: 32 bytes, base64 (or 64-char hex)  
Algorithm: AES-256-GCM (`functions/onboarding-crypto.js`)  
Related secret (portal links): `ONBOARDING_PORTAL_HMAC_SECRET` — also separate per project.

---

## 1. Create a key (offline)

```bash
openssl rand -base64 32
```

Do not paste the value into a commit, Slack, or this repo.

---

## 2. Store in Secret Manager

```bash
# Staging (already live)
# firebase functions:secrets:set ONBOARDING_FIELD_ENCRYPTION_KEY --project fair-flow-staging

# Production — only after the S9 gate. New key. Not a copy of staging.
# firebase functions:secrets:set ONBOARDING_FIELD_ENCRYPTION_KEY --project fairflowapp-db841
```

Grant accessor to the project's default compute / App Engine service accounts only.

---

## 3. Dual-custody backup (written copies)

Keep **two** copies of the **same** encrypted envelope, in **two** places:

1. Password manager (1Password / Bitwarden) — item name like `Fair Flow staging ONBOARDING_FIELD_ENCRYPTION_KEY envelope`
2. Offline: printed page or USB in a locked place

The envelope is created with a passphrase you choose. Fair Flow never stores that passphrase.

```bash
node .local-patches/onboarding-s9-backup-envelope.cjs \
  --project fair-flow-staging \
  --out "$HOME/fair-flow-key-backups"
```

Store the envelope file **and** the passphrase in different places if you are the only person.  
If two people: one holds the envelope, one holds the passphrase.

---

## 4. Dry-run restore (staging, required)

Simulates “Secret Manager is gone”: load the key from SM (or from an envelope), decrypt a real ciphertext, confirm `last4`. Never prints the key or the full value.

```bash
node .local-patches/onboarding-s9-dry-restore.cjs --project fair-flow-staging
```

Pass `--envelope /path/to/file.ff-key-envelope.json` and `FF_KEY_BACKUP_PASSPHRASE` to restore from the envelope instead of live SM.

---

## 5. If Secret Manager is deleted

1. Unlock one backup envelope with the passphrase.
2. `firebase functions:secrets:set ONBOARDING_FIELD_ENCRYPTION_KEY --project <project>`
   (or `gcloud secrets create` / `versions add` if gcloud is available)
   (pipe the recovered 32-byte key; do not leave it in a file on disk)
3. Redeploy the functions that bind this secret (Reveal, portal submit/seal).
4. Run the dry-restore script. Reveal in the app must work.

---

## 6. Rotate (`keyVersion`)

Current writes use `keyVersion: "v1"`. Decrypt today accepts the single live key.

To rotate:

1. Create a new 32-byte key. Keep the old key until every ciphertext is re-encrypted.
2. Add a new SM version **or** a second secret. Do not delete v1 until re-encrypt is done.
3. Code change: `decryptFieldValue` must try current key, then previous.
4. Batch re-encrypt existing `fieldValuesEncrypted` blobs to the new key (`keyVersion: "v2"`).
5. Only then disable the old SM version.
6. Dual-custody backup of the **new** key before switching production.

Who approves a rotate: salon owner (Tata) + the person who deploys functions. Write the date in the password-manager item.

---

## S9 gate (before any production key)

- [ ] Dual-custody backups exist (two places)
- [ ] This runbook is followed
- [ ] Staging dry-restore passed
- [ ] Production key is **new**, not copied from staging
- [ ] Explicit “deploy to production” in the same message

Until those are checked: **no** production secret, **no** Reveal/encrypt functions on `fairflowapp-db841`.
