/**
 * Exact-identity cleanup planner for the Phase 18F staging callable smoke.
 * Pure. No Firebase, no listUsers, no domain/prefix enumeration.
 *
 * Allowed targets are only the salon/auth identities recorded for the current run.
 */
"use strict";

const SMOKE_SALON_PREFIX = "ss-staging-smoke-";
const SMOKE_UID_PREFIX = "ss-smoke-uid-";
const SMOKE_EMAIL_DOMAIN = "@fair-flow-staging.test";
const MISMATCH = "cleanup_identity_mismatch";

const FORBIDDEN_AUTH_UIDS = Object.freeze(["ff-booking-qa-user"]);
const FORBIDDEN_EMAILS = Object.freeze(["ff-booking-qa@fair-flow-staging.test"]);

function failMismatch(detail) {
  const err = new Error(MISMATCH + (detail ? ": " + detail : ""));
  err.code = MISMATCH;
  throw err;
}

function trimText(value) {
  return String(value == null ? "" : value).trim();
}

function createSmokeIdentities(suffix) {
  const token = trimText(suffix);
  if (!token || /[^a-z0-9]/i.test(token)) failMismatch("invalid_smoke_suffix");
  const salonId = SMOKE_SALON_PREFIX + token;
  const uid = SMOKE_UID_PREFIX + token;
  return {
    createdSmokeSalonId: salonId,
    createdSmokeAuthUid: uid,
    createdSmokeEmail: uid + SMOKE_EMAIL_DOMAIN,
    createdDocumentRefs: []
  };
}

function recordCreatedDoc(record, docPath) {
  assertCleanupRecord(record);
  const path = trimText(docPath);
  if (!isAllowedCleanupPath(record, path)) failMismatch("created_doc_outside_namespace");
  if (record.createdDocumentRefs.indexOf(path) === -1) record.createdDocumentRefs.push(path);
  return record;
}

function assertCleanupRecord(record) {
  if (!record || typeof record !== "object") failMismatch("missing_record");
  const salonId = trimText(record.createdSmokeSalonId);
  const uid = trimText(record.createdSmokeAuthUid);
  const email = trimText(record.createdSmokeEmail);
  if (!salonId || !uid || !email) failMismatch("empty_generated_ids");
  if (salonId.indexOf(SMOKE_SALON_PREFIX) !== 0) failMismatch("malformed_salon_id");
  if (salonId === SMOKE_SALON_PREFIX) failMismatch("malformed_salon_id");
  if (uid.indexOf(SMOKE_UID_PREFIX) !== 0) failMismatch("malformed_uid");
  if (uid === SMOKE_UID_PREFIX) failMismatch("malformed_uid");
  if (email !== uid + SMOKE_EMAIL_DOMAIN) failMismatch("email_not_bound_to_current_run");
  if (FORBIDDEN_AUTH_UIDS.indexOf(uid) !== -1) failMismatch("forbidden_uid");
  if (FORBIDDEN_EMAILS.indexOf(email) !== -1) failMismatch("forbidden_email");
  return {
    createdSmokeSalonId: salonId,
    createdSmokeAuthUid: uid,
    createdSmokeEmail: email,
    createdDocumentRefs: Array.isArray(record.createdDocumentRefs) ? record.createdDocumentRefs.slice() : []
  };
}

function assertSalonDeleteTarget(record, salonId) {
  const rec = assertCleanupRecord(record);
  const target = trimText(salonId);
  if (!target) failMismatch("empty_salon_id");
  if (target.indexOf(SMOKE_SALON_PREFIX) !== 0) failMismatch("malformed_salon_id");
  if (target !== rec.createdSmokeSalonId) failMismatch("salon_not_current_run");
  return rec;
}

function assertAuthDeleteTarget(record, authUser) {
  const rec = assertCleanupRecord(record);
  if (!authUser || typeof authUser !== "object") failMismatch("missing_auth_user");
  const uid = trimText(authUser.uid);
  const email = trimText(authUser.email);
  if (uid !== rec.createdSmokeAuthUid) failMismatch("uid_not_exact");
  if (email && email !== rec.createdSmokeEmail) failMismatch("email_not_exact");
  if (rec.createdSmokeEmail.indexOf(SMOKE_UID_PREFIX) !== 0) failMismatch("email_not_bound_to_current_run");
  if (FORBIDDEN_AUTH_UIDS.indexOf(uid) !== -1) failMismatch("forbidden_uid");
  if (FORBIDDEN_EMAILS.indexOf(email) !== -1) failMismatch("forbidden_email");
  return rec;
}

function isAllowedCleanupPath(record, docPath) {
  const rec = assertCleanupRecord(record);
  const path = trimText(docPath);
  if (!path || path.indexOf("..") !== -1) return false;
  const salonRoot = "salons/" + rec.createdSmokeSalonId;
  const userRoot = "users/" + rec.createdSmokeAuthUid;
  const membership = userRoot + "/memberships/" + rec.createdSmokeSalonId;
  return path === salonRoot
    || path.indexOf(salonRoot + "/") === 0
    || path === userRoot
    || path === membership;
}

function planExactCleanup(record) {
  const rec = assertCleanupRecord(record);
  const salonRoot = "salons/" + rec.createdSmokeSalonId;
  const userRoot = "users/" + rec.createdSmokeAuthUid;
  const membership = userRoot + "/memberships/" + rec.createdSmokeSalonId;
  const extras = [];
  rec.createdDocumentRefs.forEach(function (docPath) {
    const path = trimText(docPath);
    if (!isAllowedCleanupPath(rec, path)) failMismatch("planned_doc_outside_namespace");
    if (path !== salonRoot && path !== userRoot && path !== membership && extras.indexOf(path) === -1) {
      extras.push(path);
    }
  });
  return {
    ok: true,
    salonId: rec.createdSmokeSalonId,
    authUid: rec.createdSmokeAuthUid,
    authEmail: rec.createdSmokeEmail,
    recursiveSalonPath: salonRoot,
    userDocs: [membership, userRoot],
    extraDocumentRefs: extras
  };
}

module.exports = {
  SMOKE_SALON_PREFIX,
  SMOKE_UID_PREFIX,
  SMOKE_EMAIL_DOMAIN,
  MISMATCH,
  FORBIDDEN_AUTH_UIDS,
  FORBIDDEN_EMAILS,
  createSmokeIdentities,
  recordCreatedDoc,
  assertCleanupRecord,
  assertSalonDeleteTarget,
  assertAuthDeleteTarget,
  isAllowedCleanupPath,
  planExactCleanup
};
