/**
 * E-sign Phase E1 — Signature Document Library (client).
 * Metadata reads via Firestore; create/upload/finalize via Cloud Functions only.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import { db, storage } from "/app.js?v=20260610_force_lp_ios";
import {
  ffOpenInAppDocumentOverlay,
  ffShouldUseInAppPdf,
} from "/inapp-pdf-viewer.js?v=20260825_od_iospdf";
import { ref as storageRef, uploadBytes } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const MAX_SIZE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 50;

let _salonId = null;
let _unsubDocs = null;
let _cacheDocs = [];
let _subscribeRefCount = 0;

function _fns() {
  return getFunctions(undefined, "us-central1");
}

function _call(name, data) {
  const fn = httpsCallable(_fns(), name);
  return fn(data)
    .then((res) => res && res.data)
    .catch((e) => {
      const details =
        (e && e.details && (e.details.message || e.details)) ||
        (e && e.customData && e.customData.message) ||
        null;
      let msg = String(
        details || (e && e.message) || (e && e.code) || `${name} failed`
      );
      msg = msg.replace(/^Firebase:\s*/i, "").trim();
      // Callable often surfaces only "INTERNAL" — give a usable hint.
      if (!msg || /^internal$/i.test(msg) || msg === "functions/internal") {
        msg =
          "Server error while processing the PDF. Try again — if it keeps failing, use a smaller or simpler PDF.";
      }
      console.error("[EsignLibrary]", name, e);
      throw new Error(msg || `${name} failed`);
    });
}

async function getSalonId() {
  try {
    if (typeof window !== "undefined" && window.currentSalonId) {
      const s = String(window.currentSalonId).trim();
      if (s) return s;
    }
  } catch (_) {}
  return null;
}

function docsRef(salonId) {
  return collection(db, `salons/${salonId}/onboardingSignatureDocuments`);
}

function versionsRef(salonId, documentId) {
  return collection(
    db,
    `salons/${salonId}/onboardingSignatureDocuments/${documentId}/versions`
  );
}

function _emit(name, detail) {
  try {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  } catch (_) {}
}

function _bytesFromBase64(b64) {
  const raw = String(b64 || "");
  if (!raw) return null;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function _fileMetaToObjectUrl(meta) {
  if (!meta) return meta;
  const b64 = meta.fileBase64 || meta.pdfBase64 || "";
  if (b64) {
    const bytes = _bytesFromBase64(b64);
    const type =
      String(meta.contentType || "").trim() ||
      (meta.pdfBase64 ? "application/pdf" : "application/octet-stream");
    const blob = new Blob([bytes], { type });
    return {
      ...meta,
      pdfData: type === "application/pdf" ? bytes : meta.pdfData,
      readUrl: URL.createObjectURL(blob),
    };
  }
  return meta;
}

function _sortDocs(arr) {
  return (arr || []).slice().sort((a, b) => {
    const aa = a.archived === true ? 1 : 0;
    const bb = b.archived === true ? 1 : 0;
    if (aa !== bb) return aa - bb;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

export function ffOnboardingEsignLibraryLimits() {
  return { maxSizeMb: 20, maxPages: MAX_PAGES, maxSizeBytes: MAX_SIZE_BYTES };
}

export async function ffEnsureOnboardingEsignLibrarySubscribed() {
  const salonId = await getSalonId();
  if (!salonId) return;
  _salonId = salonId;
  _subscribeRefCount += 1;
  if (_unsubDocs) return;
  _unsubDocs = onSnapshot(
    docsRef(salonId),
    (snap) => {
      _cacheDocs = _sortDocs(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
      _emit("ff-onboarding-esign-docs-updated", _cacheDocs);
    },
    (err) => console.warn("[EsignLibrary] subscribe error", err)
  );
}

export function ffStopOnboardingEsignLibrarySubscribed() {
  _subscribeRefCount = Math.max(0, _subscribeRefCount - 1);
  if (_subscribeRefCount > 0) return;
  if (_unsubDocs) {
    _unsubDocs();
    _unsubDocs = null;
  }
  _cacheDocs = [];
}

export async function ffGetOnboardingSignatureDocuments({ includeArchived } = {}) {
  if (!_salonId) _salonId = await getSalonId();
  if (!_salonId) return [];
  if (_unsubDocs) {
    const list = _cacheDocs.slice();
    if (includeArchived === false) {
      return list.filter((d) => d.archived !== true && d.active !== false);
    }
    return list;
  }
  try {
    const snap = await getDocs(docsRef(_salonId));
    let list = _sortDocs(snap.docs.map((d) => ({ ...d.data(), id: d.id })));
    _cacheDocs = list;
    if (includeArchived === false) {
      list = list.filter((d) => d.archived !== true && d.active !== false);
    }
    return list;
  } catch (e) {
    console.warn("[EsignLibrary] get documents failed", e);
    return [];
  }
}

export async function ffGetOnboardingSignatureDocumentVersions(documentId) {
  if (!_salonId) _salonId = await getSalonId();
  const did = String(documentId || "").trim();
  if (!_salonId || !did) return [];
  try {
    const snap = await getDocs(versionsRef(_salonId, did));
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
        return tb - ta;
      });
  } catch (e) {
    console.warn("[EsignLibrary] get versions failed", e);
    return [];
  }
}

export async function ffCreateOnboardingSignatureDocument(payload) {
  const salonId = (await getSalonId()) || _salonId;
  if (!salonId) throw new Error("No salon selected");
  const title = String((payload && payload.title) || "").trim();
  if (!title) throw new Error("Title is required");
  const complianceTier = String(
    (payload && payload.complianceTier) || "standard"
  ).trim();
  if (complianceTier !== "standard") {
    throw new Error(
      "Regulated documents cannot use the generic e-sign library."
    );
  }
  return _call("createOnboardingSignatureDocument", {
    salonId,
    title,
    category: String((payload && payload.category) || "").trim(),
    notes: String((payload && payload.notes) || "").trim(),
    complianceTier: "standard",
  });
}

export async function ffUpdateOnboardingSignatureDocument(documentId, updates) {
  const salonId = (await getSalonId()) || _salonId;
  const did = String(documentId || "").trim();
  if (!salonId || !did) throw new Error("Document ID is required");
  if (updates && updates.complianceTier != null && updates.complianceTier !== "standard") {
    throw new Error(
      "Regulated documents cannot use the generic e-sign library."
    );
  }
  const res = await _call("updateOnboardingSignatureDocument", {
    salonId,
    documentId: did,
    ...(updates || {}),
  });
  // Keep local cache in sync until the snapshot arrives.
  if (res && res.document) {
    const archived = res.document.archived === true || res.document.active === false;
    if (archived) {
      _cacheDocs = _cacheDocs.filter((d) => d.id !== did);
    } else {
      const idx = _cacheDocs.findIndex((d) => d.id === did);
      if (idx >= 0) _cacheDocs[idx] = { ..._cacheDocs[idx], ...res.document, id: did };
      else _cacheDocs.push({ ...res.document, id: did });
      _cacheDocs = _sortDocs(_cacheDocs);
    }
    _emit("ff-onboarding-esign-docs-updated", _cacheDocs);
  }
  return res;
}

export async function ffArchiveOnboardingSignatureDocument(documentId, archived) {
  return ffUpdateOnboardingSignatureDocument(documentId, {
    archived: archived !== false,
  });
}

/**
 * Full upload pipeline: reserve signed URL → PUT PDF → finalize (hash/pages).
 * @param {{ documentId: string, file: File|Blob, notes?: string }} opts
 */
export async function ffUploadOnboardingSignatureDocumentVersion({
  documentId,
  file,
  notes,
} = {}) {
  const salonId = (await getSalonId()) || _salonId;
  const did = String(documentId || "").trim();
  if (!salonId || !did) throw new Error("Document ID is required");
  if (!file) throw new Error("PDF file is required");

  const fileName = String(file.name || "document.pdf");
  const contentType = String(file.type || "application/pdf");
  const size = Number(file.size) || 0;

  if (contentType && contentType !== "application/pdf" && !/\.pdf$/i.test(fileName)) {
    throw new Error("Only PDF uploads are allowed");
  }
  if (size > MAX_SIZE_BYTES) {
    throw new Error("PDF must be 20 MB or smaller");
  }

  const reserved = await _call("createOnboardingSignatureDocumentVersionUpload", {
    salonId,
    documentId: did,
    fileName,
    contentType: "application/pdf",
    size,
    notes: String(notes || "").trim(),
  });

  if (!reserved || !reserved.versionId) {
    throw new Error("Could not reserve upload slot");
  }
  let usedStaging = false;
  if (reserved.uploadUrl) {
    try {
      const putRes = await fetch(reserved.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/pdf" },
        body: file,
      });
      if (!putRes.ok) throw new Error(`signed PUT ${putRes.status}`);
    } catch (putErr) {
      console.warn("[EsignLibrary] signed PUT failed, using staging upload", putErr);
      usedStaging = true;
    }
  } else {
    usedStaging = true;
  }
  const stagingPath =
    reserved.stagingPath ||
    `onboardingUploads/${salonId}/${(getAuth().currentUser && getAuth().currentUser.uid) || "user"}/${reserved.versionId}.pdf`;
  if (usedStaging) {
    await uploadBytes(storageRef(storage, stagingPath), file, {
      contentType: "application/pdf",
    });
  }

  const finalized = await _call("finalizeOnboardingSignatureDocumentVersion", {
    salonId,
    documentId: did,
    versionId: reserved.versionId,
    ...(usedStaging ? { stagingPath } : {}),
  });

  return { ...reserved, ...finalized };
}

/** Short-lived signed read URL for PDF.js field editor preview. */
export async function ffGetOnboardingSignatureDocumentVersionReadUrl({
  documentId,
  versionId,
} = {}) {
  const salonId = (await getSalonId()) || _salonId;
  const did = String(documentId || "").trim();
  const vid = String(versionId || "").trim();
  if (!salonId || !did || !vid) {
    throw new Error("documentId and versionId are required");
  }
  const meta = await Promise.race([
    _call("getOnboardingSignatureDocumentVersionReadUrl", {
      salonId,
      documentId: did,
      versionId: vid,
    }),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error("Could not open the PDF to mark signatures. Try again.")
          ),
        20000
      )
    ),
  ]);
  const opened = _fileMetaToObjectUrl(meta);
  if (opened && opened.readUrl) {
    return opened.pdfData
      ? opened
      : { ...opened, pdfData: _bytesFromBase64(opened.pdfBase64 || opened.fileBase64) };
  }
  throw new Error("Could not open the PDF to mark signatures. Try uploading again.");
}

/**
 * S1: short-lived signed URL for sealed PDFs / portal uploads under
 * onboardingArtifacts (client Storage read is denied).
 */
export async function ffGetOnboardingArtifactReadUrl({
  storagePath,
  staffId,
  runId,
  taskId,
  kind,
} = {}) {
  const salonId = (await getSalonId()) || _salonId;
  if (!salonId) throw new Error("Salon not loaded");
  const payload = { salonId };
  const path = String(storagePath || "").trim();
  if (path) payload.storagePath = path;
  if (staffId) payload.staffId = String(staffId).trim();
  if (runId) payload.runId = String(runId).trim();
  if (taskId) payload.taskId = String(taskId).trim();
  if (kind) payload.kind = String(kind).trim();
  const meta = await _call("getOnboardingArtifactReadUrl", payload);
  const opened = _fileMetaToObjectUrl(meta);
  if (opened && opened.readUrl) return opened;
  throw new Error("Could not open the file.");
}
ffGetOnboardingArtifactReadUrl._ffFileB64 = true;

/** Open inbox / run-panel artifact via signed URL (never getDownloadURL). */
export async function ffOpenOnboardingArtifact(opts = {}) {
  const meta = await ffGetOnboardingArtifactReadUrl(opts);
  const url = meta && meta.readUrl;
  if (!url) throw new Error("Could not get download link");
  const title = String((opts && opts.title) || "Onboarding document");
  const contentType = String((meta && meta.contentType) || "");
  if (ffShouldUseInAppPdf(url, title, contentType)) {
    ffOpenInAppDocumentOverlay(url, title, { contentType });
    return meta;
  }
  const tab = window.open(url, "_blank", "noopener,noreferrer");
  if (!tab) {
    window.location.assign(url);
  }
  return meta;
}

/** Inbox click handler — wired from inbox-details document_upload links. */
export function ffInboxOpenOnboardingArtifact(ev) {
  try {
    if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
  } catch (_) {}
  const a = ev && ev.currentTarget;
  if (!a) return false;
  const storagePath = a.getAttribute("data-od-artifact-path") || "";
  const staffId = a.getAttribute("data-od-artifact-staff") || "";
  const runId = a.getAttribute("data-od-artifact-run") || "";
  const taskId = a.getAttribute("data-od-artifact-task") || "";
  void ffOpenOnboardingArtifact({
    storagePath,
    staffId,
    runId,
    taskId,
    kind: "upload",
  }).catch((e) => {
    console.warn("[Onboarding] inbox artifact open", e);
    try {
      window.alert((e && e.message) || "Could not open file");
    } catch (_) {}
  });
  return false;
}

export async function ffSetOnboardingSignatureDocumentVersionFieldSchema({
  documentId,
  versionId,
  fieldSchema,
} = {}) {
  const salonId = (await getSalonId()) || _salonId;
  const did = String(documentId || "").trim();
  const vid = String(versionId || "").trim();
  if (!salonId || !did || !vid) {
    throw new Error("documentId and versionId are required");
  }
  const res = await _call("setOnboardingSignatureDocumentVersionFieldSchema", {
    salonId,
    documentId: did,
    versionId: vid,
    fieldSchema: Array.isArray(fieldSchema) ? fieldSchema : [],
  });
  try {
    document.dispatchEvent(
      new CustomEvent("ff-onboarding-esign-versions-updated", {
        detail: { documentId: did, versionId: vid },
      })
    );
  } catch (_) {}
  return res;
}

export async function ffBindOnboardingSignatureDocumentVersions(bindings) {
  const salonId = (await getSalonId()) || _salonId;
  if (!salonId) throw new Error("No salon selected");
  return _call("bindOnboardingSignatureDocumentVersions", {
    salonId,
    bindings: Array.isArray(bindings) ? bindings : [],
  });
}

/** S2 — store encrypted sensitive value on a run task (manager). */
export async function ffStoreOnboardingSensitiveField({
  staffId,
  runId,
  taskId,
  fieldId,
  plaintext,
  sensitiveKind,
  label,
} = {}) {
  const salonId = (await getSalonId()) || _salonId;
  if (!salonId) throw new Error("Salon not loaded");
  return _call("storeOnboardingSensitiveField", {
    salonId,
    staffId: String(staffId || "").trim(),
    runId: String(runId || "").trim(),
    taskId: String(taskId || "").trim(),
    fieldId: String(fieldId || "").trim(),
    plaintext,
    sensitiveKind: sensitiveKind || "other",
    label: label || "",
  });
}

/** S2 — Reveal plaintext (owner/admin or onboarding_reveal_sensitive). Audited. */
export async function ffRevealOnboardingSensitiveField({
  staffId,
  runId,
  taskId,
  fieldId,
} = {}) {
  const salonId = (await getSalonId()) || _salonId;
  if (!salonId) throw new Error("Salon not loaded");
  return _call("revealOnboardingSensitiveField", {
    salonId,
    staffId: String(staffId || "").trim(),
    runId: String(runId || "").trim(),
    taskId: String(taskId || "").trim(),
    fieldId: String(fieldId || "").trim(),
  });
}

/**
 * Build template/run bind payload from a ready library version.
 */
export async function ffBuildEsignBindFromLibraryVersion(documentId, versionId) {
  const salonId = (await getSalonId()) || _salonId;
  const did = String(documentId || "").trim();
  const vid = String(versionId || "").trim();
  if (!salonId || !did || !vid) throw new Error("documentId and versionId required");

  let docRow = _cacheDocs.find((d) => d.id === did) || null;
  if (!docRow) {
    const snap = await getDoc(doc(db, `salons/${salonId}/onboardingSignatureDocuments`, did));
    if (!snap.exists()) throw new Error("Signature document not found");
    docRow = { ...snap.data(), id: snap.id };
  }
  const versions = await ffGetOnboardingSignatureDocumentVersions(did);
  const ver = (versions || []).find((v) => v.id === vid);
  if (!ver || ver.status !== "ready") throw new Error("Signature version is not ready");
  if (docRow.complianceTier && docRow.complianceTier !== "standard") {
    throw new Error("Regulated documents cannot use the generic e-sign library");
  }
  const fieldSchema = Array.isArray(ver.fieldSchema) ? ver.fieldSchema.slice() : [];
  return {
    signatureDocumentId: did,
    signatureDocumentVersionId: vid,
    documentId: did,
    documentVersionId: vid,
    documentVersion: ver.documentVersion != null ? ver.documentVersion : vid,
    documentSha256: String(ver.sha256 || ""),
    documentTitle: String(docRow.title || did),
    pageCount: Number(ver.pageCount) || null,
    fieldSchema,
    complianceTier: "standard",
    allowInternalEsign: true,
  };
}

if (typeof window !== "undefined") {
  window.ffOnboardingEsignLibraryLimits = ffOnboardingEsignLibraryLimits;
  window.ffEnsureOnboardingEsignLibrarySubscribed =
    ffEnsureOnboardingEsignLibrarySubscribed;
  window.ffGetOnboardingSignatureDocuments = ffGetOnboardingSignatureDocuments;
  window.ffGetOnboardingSignatureDocumentVersions =
    ffGetOnboardingSignatureDocumentVersions;
  window.ffCreateOnboardingSignatureDocument = ffCreateOnboardingSignatureDocument;
  window.ffUpdateOnboardingSignatureDocument = ffUpdateOnboardingSignatureDocument;
  window.ffArchiveOnboardingSignatureDocument =
    ffArchiveOnboardingSignatureDocument;
  window.ffUploadOnboardingSignatureDocumentVersion =
    ffUploadOnboardingSignatureDocumentVersion;
  window.ffGetOnboardingSignatureDocumentVersionReadUrl =
    ffGetOnboardingSignatureDocumentVersionReadUrl;
  window.ffGetOnboardingArtifactReadUrl = ffGetOnboardingArtifactReadUrl;
  window.ffOpenOnboardingArtifact = ffOpenOnboardingArtifact;
  window.ffInboxOpenOnboardingArtifact = ffInboxOpenOnboardingArtifact;
  window.ffStoreOnboardingSensitiveField = ffStoreOnboardingSensitiveField;
  window.ffRevealOnboardingSensitiveField = ffRevealOnboardingSensitiveField;
  window.ffSetOnboardingSignatureDocumentVersionFieldSchema =
    ffSetOnboardingSignatureDocumentVersionFieldSchema;
  window.ffBindOnboardingSignatureDocumentVersions =
    ffBindOnboardingSignatureDocumentVersions;
  window.ffBuildEsignBindFromLibraryVersion = ffBuildEsignBindFromLibraryVersion;
}
