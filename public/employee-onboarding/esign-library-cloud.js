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
import { db } from "/app.js?v=20260610_force_lp_ios";

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
  return fn(data).then((res) => res && res.data);
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
    const idx = _cacheDocs.findIndex((d) => d.id === did);
    if (idx >= 0) _cacheDocs[idx] = { ..._cacheDocs[idx], ...res.document, id: did };
    else _cacheDocs.push({ ...res.document, id: did });
    _cacheDocs = _sortDocs(_cacheDocs);
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

  const putRes = await fetch(reserved.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  });
  if (!putRes.ok) {
    throw new Error(`Upload failed (${putRes.status})`);
  }

  const finalized = await _call("finalizeOnboardingSignatureDocumentVersion", {
    salonId,
    documentId: did,
    versionId: reserved.versionId,
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
  return _call("getOnboardingSignatureDocumentVersionReadUrl", {
    salonId,
    documentId: did,
    versionId: vid,
  });
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
  window.ffSetOnboardingSignatureDocumentVersionFieldSchema =
    ffSetOnboardingSignatureDocumentVersionFieldSchema;
  window.ffBindOnboardingSignatureDocumentVersions =
    ffBindOnboardingSignatureDocumentVersions;
  window.ffBuildEsignBindFromLibraryVersion = ffBuildEsignBindFromLibraryVersion;
}
