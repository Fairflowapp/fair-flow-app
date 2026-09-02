/**
 * Employee Onboarding Settings UI — shared styles, state, and helpers.
 */

import {
  ffNormalizeOnboardingAudience,
} from "./audience.js?v=20260808_onboarding_hardening";
import {
  ffGetOnboardingTaskHandler,
  ffNormalizeOnboardingTaskConfig,
} from "./task-registry.js?v=20260816_od_link";

export const STYLE = {
  tabActive:
    "padding:8px 14px;border:none;border-bottom:2px solid #7c3aed;background:transparent;color:#5b21b6;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:-1px;",
  tabIdle:
    "padding:8px 14px;border:none;border-bottom:2px solid transparent;background:transparent;color:#6b7280;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:-1px;",
  btnPrimary:
    "padding:9px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:13px;font-weight:700;cursor:pointer;",
  btnGhost:
    "padding:9px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;",
  btnDanger:
    "padding:4px 8px;border:1px solid #fecaca;border-radius:6px;background:#fff;color:#b91c1c;font-size:11px;font-weight:600;cursor:pointer;",
  btnSmall:
    "padding:4px 8px;border:1px solid #ddd6fe;border-radius:6px;background:#f5f3ff;color:#6d28d9;font-size:11px;font-weight:600;cursor:pointer;",
  input:
    "width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box;",
  label:
    "display:block;font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;",
  card:
    "border:1px solid #e5e7eb;border-radius:10px;padding:12px;background:#fff;",
  formBox:
    "border:1px solid #e9d5ff;border-radius:12px;padding:16px;background:#faf5ff;margin-bottom:12px;",
  empty:
    "border:1px dashed #d1d5db;border-radius:12px;padding:28px 20px;background:#fafafa;text-align:center;",
  typeCard:
    "display:block;width:100%;text-align:left;border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fff;cursor:pointer;margin-bottom:8px;",
  typeCardDisabled:
    "display:block;width:100%;text-align:left;border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#f9fafb;cursor:not-allowed;margin-bottom:8px;opacity:0.72;",
};

export const ITEM_KINDS = [
  {
    kind: "upload",
    taskType: "document",
    title: "Upload a file",
    blurb: "Ask the employee to upload something — ID, certificate, photo, and more.",
  },
  {
    kind: "sign",
    taskType: "electronic_signature",
    title: "Sign a document",
    blurb: "Upload a PDF and mark where they should sign.",
  },
  {
    kind: "policy",
    taskType: "policy_acknowledgement",
    title: "Acknowledge a policy",
    blurb: "Employee reads a policy and confirms they agree.",
  },
];


export const state = {
  /** @type {"items"|"packages"} */
  tab: "items",
  bound: false,
  techTypes: [],
  /** @type {null|"item_create"|"item_edit"|"pkg_create"|"pkg_edit"} */
  view: null,
  editingItemId: null,
  editingPackageId: null,
  /** Item create wizard draft */
  itemDraft: null,
  /** When creating an item from Package wizard */
  returnToPackage: false,
  /** Package create/edit draft (survives inline item create) */
  pkgDraft: null,
  /** Last error to keep visible on the item form */
  itemError: "",
  _unfinishedSignKey: "",
};

let _renderImpl = null;

/** Bind the shell's renderOnboardingSettingsUI (avoids circular imports). */
export function bindRequestRender(fn) {
  _renderImpl = fn;
}

export function requestRender() {
  if (typeof _renderImpl === "function") return _renderImpl();
  return Promise.resolve();
}

function _applyOnboardingNav(nav) {
  if (!nav) return;
  if (nav.view != null) state.view = nav.view;
  if ("editingItemId" in nav) state.editingItemId = nav.editingItemId;
  if ("returnToPackage" in nav) state.returnToPackage = !!nav.returnToPackage;
  if (nav.resetItemDraft) _resetItemDraft(nav.kind || null);
}

export function consumeOnboardingNav() {
  try {
    const nav = typeof window !== "undefined" ? window.__ffObNav : null;
    if (!nav) return;
    window.__ffObNav = null;
    _applyOnboardingNav(nav);
  } catch (_) {}
}

function _paintOnboarding() {
  try {
    if (typeof window !== "undefined" && typeof window.renderOnboardingSettingsUI === "function") {
      return window.renderOnboardingSettingsUI();
    }
  } catch (_) {}
  return requestRender();
}

export function ffOnboardingAddItem() {
  const fromPackage = !!(state.pkgDraft && document.getElementById("obPkgForm"));
  if (fromPackage) {
    state.pkgDraft.name = String((document.getElementById("obPkgName") || {}).value || state.pkgDraft.name || "").trim();
    state.pkgDraft.description = String((document.getElementById("obPkgDesc") || {}).value || state.pkgDraft.description || "").trim();
  }
  const nav = {
    view: "item_create",
    editingItemId: null,
    returnToPackage: fromPackage,
    resetItemDraft: true,
    kind: null,
  };
  try {
    if (typeof window !== "undefined") window.__ffObNav = nav;
  } catch (_) {}
  _applyOnboardingNav(nav);
  return _paintOnboarding();
}

export function ffOnboardingPickItemKind(kind) {
  const nav = {
    view: "item_create",
    resetItemDraft: true,
    kind: kind || null,
  };
  try {
    if (typeof window !== "undefined") window.__ffObNav = nav;
  } catch (_) {}
  _applyOnboardingNav(nav);
  return _paintOnboarding();
}

export async function ffOnboardingMarkSign() {
  const btn = document.getElementById("obSignMark") || document.getElementById("obSignRemark");
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Opening…";
  }
  try {
    if (typeof window.ffOpenOnboardingEsignFieldEditor !== "function") {
      await import("./esign-field-editor.js?v=20260816_od_bin");
    }
    const openP = _openSignFieldEditor();
    void openP.catch((e) => {
      const msg = (e && e.message) || "Could not open the signature editor";
      _toast(msg, "error");
      try { window.alert(msg); } catch (_) {}
    });
    const started = Date.now();
    while (!document.getElementById("ffEsignFieldEditorOverlay")) {
      if (Date.now() - started > 12000) {
        throw new Error("The PDF editor did not open. Try again.");
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  } catch (e) {
    const msg = (e && e.message) || "Could not open the signature editor";
    _toast(msg, "error");
    try { window.alert(msg); } catch (_) {}
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prev || "Mark where to sign";
    }
  }
}

if (typeof window !== "undefined") {
  window.ffOnboardingAddItem = ffOnboardingAddItem;
  window.ffOnboardingPickItemKind = ffOnboardingPickItemKind;
  window.ffOnboardingMarkSign = ffOnboardingMarkSign;
}

export function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Safari cannot parse nested `? \`<button type=...\`` inside another template. */
export function _obBtn(opts) {
  const o = opts || {};
  let html = '<button type="button"';
  if (o.id) html += ' id="' + String(o.id) + '"';
  if (o.attrs) html += " " + String(o.attrs);
  if (o.onclick) html += ' onclick="' + String(o.onclick) + '"';
  html += ' style="' + String(o.style || "") + '">';
  html += String(o.label || "");
  html += "</button>";
  return html;
}

export function _toast(msg, kind) {
  const text = String(msg == null ? "" : msg);
  const variant = kind || "info";
  if (variant === "error") {
    state.itemError = text;
    try {
      const host = document.getElementById("obItemError");
      if (host) {
        host.textContent = text;
        host.style.display = text ? "block" : "none";
      }
    } catch (_) {}
  }
  try {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(text, {
        variant,
        durationMs: variant === "error" ? 12000 : 4500,
      });
      return;
    }
  } catch (_) {}
  // Legacy showToast(message, durationMs) — never pass variant string as duration.
  if (typeof window.showToast === "function") {
    window.showToast(text, variant === "error" ? 12000 : 4500);
    return;
  }
  console.log("[OnboardingSettingsUI]", text);
}

function _salonIdForWrite() {
  try {
    return String((typeof window !== "undefined" && window.currentSalonId) || "").trim();
  } catch (_) {
    return "";
  }
}

async function _callOnboardingWrite(name, data) {
  const { getFunctions, httpsCallable } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js"
  );
  const fn = httpsCallable(getFunctions(undefined, "us-central1"), name);
  const res = await fn(data || {});
  return res && res.data;
}

/** Load settings-cloud if Safari never assigned the window helpers. */
export async function ensureOnboardingSettingsWrite() {
  if (typeof window.ffCreateOnboardingTaskTemplate === "function") return true;
  try {
    await import("./settings-cloud.js?v=20260902_set_iso");
  } catch (e) {
    console.warn("[OnboardingSettings] settings-cloud import", e);
  }
  return typeof window.ffCreateOnboardingTaskTemplate === "function";
}

function _invalidateCatalogCaches() {
  try {
    if (typeof window.ffInvalidateOnboardingCatalogCache === "function") {
      window.ffInvalidateOnboardingCatalogCache();
    }
  } catch (_) {}
}

export async function ffSettingsListTaskTemplates() {
  if (typeof window.ffGetOnboardingTaskTemplates === "function") {
    try {
      const rows = await window.ffGetOnboardingTaskTemplates();
      if (Array.isArray(rows)) return rows;
    } catch (e) {
      console.warn("[OnboardingSettings] list templates", e);
    }
  }
  const salonId = _salonIdForWrite();
  const db =
    (typeof window !== "undefined" && (window.ffDb || window.db)) || null;
  if (!salonId || !db) return [];
  const { collection, getDocs } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js"
  );
  const snap = await getDocs(
    collection(db, `salons/${salonId}/onboardingTaskTemplates`)
  );
  return snap.docs.map((d) => ({ ...(d.data() || {}), id: d.id }));
}

export async function ffSettingsCreateTaskTemplate(payload) {
  await ensureOnboardingSettingsWrite();
  let created;
  if (typeof window.ffCreateOnboardingTaskTemplate === "function") {
    created = await window.ffCreateOnboardingTaskTemplate(payload);
  } else {
    const salonId = _salonIdForWrite();
    if (!salonId) throw new Error("No salon selected");
    const out = await _callOnboardingWrite("createOnboardingTaskTemplate", {
      salonId,
      payload,
    });
    created = { ...(out && out.template), id: out && out.id };
  }
  _invalidateCatalogCaches();
  return created;
}

export async function ffSettingsUpdateTaskTemplate(templateId, updates) {
  await ensureOnboardingSettingsWrite();
  if (typeof window.ffUpdateOnboardingTaskTemplate === "function") {
    const out = await window.ffUpdateOnboardingTaskTemplate(templateId, updates);
    _invalidateCatalogCaches();
    return out;
  }
  const salonId = _salonIdForWrite();
  if (!salonId) throw new Error("No salon selected");
  const out = await _callOnboardingWrite("updateOnboardingTaskTemplate", {
    salonId,
    templateId,
    updates,
  });
  _invalidateCatalogCaches();
  return out;
}

export async function ffSettingsDeleteTaskTemplate(templateId) {
  await ensureOnboardingSettingsWrite();
  if (typeof window.ffDeleteOnboardingTaskTemplate === "function") {
    const out = await window.ffDeleteOnboardingTaskTemplate(templateId);
    _invalidateCatalogCaches();
    return out;
  }
  const salonId = _salonIdForWrite();
  if (!salonId) throw new Error("No salon selected");
  const out = await _callOnboardingWrite("deleteOnboardingTaskTemplate", {
    salonId,
    templateId,
  });
  _invalidateCatalogCaches();
  return out;
}

/** Prefer Firebase callable / fetch error text over empty messages. */
export function _errMsg(e, fallback) {
  if (!e) return fallback || "Something went wrong";
  const details =
    (e.details && (e.details.message || e.details)) ||
    (e.customData && e.customData.message) ||
    null;
  const msg = String(details || e.message || e.code || fallback || "Something went wrong");
  return msg.replace(/^Firebase:\s*/i, "").trim() || fallback || "Something went wrong";
}

/** English-labeled PDF picker (native <input type=file> uses OS/browser language). */
export function _pdfFilePickerHtml({ id, disabled }) {
  const inputId = id || "obSignFile";
  const dis = disabled ? "disabled" : "";
  return `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px;">
      <input id="${inputId}" type="file" accept="application/pdf,.pdf" ${dis}
        style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0;" />
      <button type="button" id="${inputId}Btn" ${dis}
        style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font-size:12px;font-weight:600;cursor:pointer;color:#111827;">
        Choose PDF
      </button>
      <span id="${inputId}Name" style="font-size:12px;color:#6b7280;">No file chosen</span>
    </div>`;
}

export function _wirePdfFilePicker(inputId) {
  const id = inputId || "obSignFile";
  const input = document.getElementById(id);
  const btn = document.getElementById(id + "Btn");
  const nameEl = document.getElementById(id + "Name");
  if (!input || !btn) return;
  btn.addEventListener("click", () => {
    if (input.disabled) return;
    input.click();
  });
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (nameEl) nameEl.textContent = f ? f.name : "No file chosen";
  });
}

export function _root() {
  return document.getElementById("ffOnboardingSettingsRoot");
}

export function _pane() {
  return document.getElementById("ffOnboardingSettingsPane");
}

export async function _loadTechTypes() {
  try {
    if (typeof window.ffGetTechnicianTypes === "function") {
      state.techTypes = await window.ffGetTechnicianTypes({ all: true });
    } else {
      state.techTypes = [];
    }
  } catch (_) {
    state.techTypes = [];
  }
}

export function _techMap() {
  const m = {};
  (state.techTypes || []).forEach((t) => {
    if (t && t.id) m[t.id] = t;
  });
  return m;
}

export function _canManage() {
  try {
    if (typeof window.ffCurrentUserCanManageGeneralSettings === "function") {
      return window.ffCurrentUserCanManageGeneralSettings() === true;
    }
  } catch (_) {}
  return false;
}

export function _itemKindLabel(taskType) {
  if (taskType === "document" || taskType === "file_upload") return "Upload a file";
  if (taskType === "electronic_signature") return "Sign a document";
  if (taskType === "policy_acknowledgement") return "Acknowledge a policy";
  return "Item";
}

export function _itemKindAccent(taskType) {
  if (taskType === "document" || taskType === "file_upload") return "#2563eb";
  if (taskType === "electronic_signature") return "#7c3aed";
  if (taskType === "policy_acknowledgement") return "#059669";
  return "#9ca3af";
}


export function _resetItemDraft(kind) {
  state.itemError = "";
  state.itemDraft = {
    kind: kind || null,
    step: kind ? "details" : "pick",
    name: "",
    description: "",
    defaultRequired: true,
    // policy
    policyText: "",
    // sign
    documentId: null,
    versionId: null,
    fieldsSaved: false,
  };
}

export function _itemErrorBannerHtml() {
  const text = String(state.itemError || "").trim();
  return `<div id="obItemError" style="display:${text ? "block" : "none"};margin:0 0 12px;padding:10px 12px;border:1px solid #fecaca;border-radius:8px;background:#fef2f2;color:#991b1b;font-size:13px;font-weight:600;line-height:1.45;">${_esc(text)}</div>`;
}


export function _resetPkgDraft(existing) {
  const a = ffNormalizeOnboardingAudience(existing && existing.audience);
  const items = Array.isArray(existing && existing.items)
    ? existing.items.map((it, i) => ({
        templateId: it.templateId,
        required: it.required !== false,
        sortOrder: it.sortOrder != null ? it.sortOrder : i,
      }))
    : [];
  state.pkgDraft = {
    step: "basics",
    name: existing ? existing.name || "" : "",
    description: existing ? existing.description || "" : "",
    active: !existing || existing.active !== false,
    audience: a,
    items,
    preselectTemplateId: null,
  };
}


export async function _linkedSignatureDocumentIds(templates) {
  const ids = new Set();
  (templates || []).forEach((t) => {
    if (!t || t.taskType !== "electronic_signature") return;
    const cfg = t.config || {};
    const id = cfg.signatureDocumentId || cfg.documentId;
    if (id) ids.add(String(id));
  });
  return ids;
}

export async function _getUnfinishedSignDrafts(templates) {
  try {
    if (typeof window.ffEnsureOnboardingEsignLibrarySubscribed === "function") {
      await window.ffEnsureOnboardingEsignLibrarySubscribed();
    }
  } catch (_) {}
  const docs =
    typeof window.ffGetOnboardingSignatureDocuments === "function"
      ? await window.ffGetOnboardingSignatureDocuments({ includeArchived: false })
      : [];
  const linked = await _linkedSignatureDocumentIds(templates);
  return (docs || []).filter((d) => {
    if (!d || !d.id) return false;
    if (d.archived === true || d.active === false) return false;
    return !linked.has(String(d.id));
  });
}

export async function _openSignFieldEditor() {
  const d = state.itemDraft;
  if (!d || !d.documentId) {
    _toast("Upload a PDF first", "error");
    return;
  }
  if (typeof window.ffOpenOnboardingEsignFieldEditor !== "function") {
    try {
      await import("./esign-field-editor.js?v=20260816_od_bin");
    } catch (e) {
      const msg = "Could not load the signature editor. " + ((e && e.message) || "");
      _toast(msg, "error");
      try { window.alert(msg); } catch (_) {}
      return;
    }
  }
  if (typeof window.ffOpenOnboardingEsignFieldEditor !== "function") {
    const msg = "Signature editor is still loading — wait a second and tap again.";
    _toast(msg, "error");
    try { window.alert(msg); } catch (_) {}
    return;
  }
  // Capture name/options from the form before the editor covers it
  const nameEl = document.getElementById("obItemName");
  const descEl = document.getElementById("obItemDesc");
  const reqEl = document.getElementById("obItemRequired");
  const activeEl = document.getElementById("obItemActive");
  if (nameEl) d.name = String(nameEl.value || "").trim();
  if (descEl) d.description = String(descEl.value || "").trim();
  if (reqEl) d.defaultRequired = !!reqEl.checked;
  if (activeEl) d.active = !!activeEl.checked;

  let versionId = d.versionId;
  if (!versionId && typeof window.ffGetOnboardingSignatureDocumentVersions === "function") {
    const versions = await window.ffGetOnboardingSignatureDocumentVersions(d.documentId);
    const ready = (versions || []).find((v) => v.status === "ready") || (versions || [])[0];
    versionId = ready && ready.id;
    d.versionId = versionId || null;
  }
  if (!versionId) {
    _toast("PDF is still processing — wait a moment and try again", "error");
    return;
  }
  const creating = state.view === "item_create";
  try {
    const res = await window.ffOpenOnboardingEsignFieldEditor({
      documentId: d.documentId,
      versionId,
      documentTitle: d.name || "Document",
      saveLabel: creating ? "Save Item" : "Save layout",
    });
    if (res && res.saved) {
      d.fieldsSaved = true;
      d.versionId = versionId;
      // One save = layout + Item. Previously layout saved alone and the Item never appeared.
      if (creating) {
        const ok = await _saveSignItemFromDraft({ create: true });
        if (!ok) {
          requestRender();
          try {
            window.alert(
              "The PDF layout was saved, but the item was not created yet.\n\nClick Save Item on the next screen (or Finish in Items)."
            );
          } catch (_) {}
        }
        return;
      }
      if (state.view === "item_edit" && state.editingItemId) {
        const templates =
          typeof window.ffGetOnboardingTaskTemplates === "function"
            ? await window.ffGetOnboardingTaskTemplates()
            : [];
        const item = templates.find((t) => t.id === state.editingItemId);
        if (item) {
          await _saveSignItemFromDraft({ create: false, item });
          return;
        }
      }
      _toast("Signature places saved", "success");
      requestRender();
    }
  } catch (e) {
    const msg = e.message || "Could not open signature editor";
    _toast(msg, "error");
    try { window.alert(msg); } catch (_) {}
  }
}

export async function _saveSignItemFromDraft({ create, item }) {
  const d = state.itemDraft;
  if (!d.name) {
    _toast("Please enter a name", "error");
    return false;
  }
  if (!d.documentId || !d.versionId) {
    _toast("Upload a PDF and mark where to sign first", "error");
    return false;
  }
  try {
    const bind = await window.ffBuildEsignBindFromLibraryVersion(d.documentId, d.versionId);
    if (!Array.isArray(bind.fieldSchema) || !bind.fieldSchema.length) {
      _toast("Mark at least one place to sign before saving", "error");
      try {
        window.alert("Mark where to sign on the PDF, then save again.");
      } catch (_) {}
      return false;
    }
    const types = new Set(bind.fieldSchema.map((f) => f && f.type).filter(Boolean));
    const hasSignature = types.has("signature");
    const hasTypedName = types.has("typed_name");
    if (!hasSignature && !hasTypedName) {
      _toast("Add a Signature or Typed name field before saving", "error");
      try {
        window.alert(
          "Add at least one Signature or Typed name field on the PDF, then save."
        );
      } catch (_) {}
      return false;
    }
    const handler = ffGetOnboardingTaskHandler("electronic_signature");
    const base = handler ? handler.getDefaultConfig() : {};
    const config = ffNormalizeOnboardingTaskConfig("electronic_signature", {
      ...base,
      ...bind,
      complianceTier: "standard",
      allowInternalEsign: true,
      requireDrawnSignature: hasSignature,
      requireTypedName: hasTypedName || !hasSignature,
    });
    let createdId = null;
    if (create) {
      const res = await ffSettingsCreateTaskTemplate({
        name: d.name,
        description: d.description || "",
        taskType: "electronic_signature",
        categoryId: null,
        defaultRequired: d.defaultRequired !== false,
        active: true,
        config,
      });
      createdId = res && res.id;
      _toast("Item saved", "success");
    } else {
      await ffSettingsUpdateTaskTemplate(item.id, {
        name: d.name,
        description: d.description || "",
        defaultRequired: d.defaultRequired !== false,
        active: d.active !== false,
        config,
      });
      _toast("Item updated", "success");
    }
    await _finishItemWizard(createdId);
    return true;
  } catch (e) {
    _toast(e.message || "Save failed", "error");
    try {
      window.alert(e.message || "Save failed");
    } catch (_) {}
    return false;
  }
}

export async function _finishUnfinishedSignDraft(docRow) {
  if (!docRow || !docRow.id) return;
  let versionId = docRow.currentVersionId || null;
  let fieldsSaved = false;
  try {
    if (typeof window.ffGetOnboardingSignatureDocumentVersions === "function") {
      const versions = await window.ffGetOnboardingSignatureDocumentVersions(docRow.id);
      const ready =
        (versions || []).find((v) => v.id === versionId && v.status === "ready") ||
        (versions || []).find((v) => v.status === "ready") ||
        (versions || [])[0];
      if (ready) {
        versionId = ready.id;
        fieldsSaved =
          Array.isArray(ready.fieldSchema) && ready.fieldSchema.length > 0;
      }
    }
  } catch (_) {}
  state.view = "item_create";
  state.editingItemId = null;
  state.returnToPackage = false;
  _resetItemDraft("sign");
  state.itemDraft.name = String(docRow.title || "Sign document").trim();
  state.itemDraft.documentId = docRow.id;
  state.itemDraft.versionId = versionId;
  state.itemDraft.fieldsSaved = fieldsSaved;
  await requestRender();
  if (fieldsSaved) {
    await _saveSignItemFromDraft({ create: true });
  } else {
    _toast("Finish by marking where to sign, then save", "info");
    await _openSignFieldEditor();
  }
}


export function _wireItemNavBack() {
  document.getElementById("obItemBack")?.addEventListener("click", () => {
    if (state.view === "item_create" && state.itemDraft && state.itemDraft.step === "details" && !state.itemDraft.documentId) {
      state.itemDraft.step = "pick";
      state.itemDraft.kind = null;
      requestRender();
      return;
    }
    _cancelItemWizard();
  });
}

export function _cancelItemWizard() {
  if (state.returnToPackage && state.pkgDraft) {
    state.view = state.editingPackageId ? "pkg_edit" : "pkg_create";
    state.returnToPackage = false;
    state.itemDraft = null;
    state.pkgDraft.step = "items";
  } else {
    state.view = null;
    state.editingItemId = null;
    state.itemDraft = null;
  }
  requestRender();
}

export async function _finishItemWizard(createdId) {
  if (state.returnToPackage && state.pkgDraft) {
    if (createdId) {
      const already = state.pkgDraft.items.some((it) => it.templateId === createdId);
      if (!already) {
        state.pkgDraft.items.push({
          templateId: createdId,
          required: true,
          sortOrder: state.pkgDraft.items.length,
        });
      }
      state.pkgDraft.preselectTemplateId = createdId;
    }
    state.view = state.editingPackageId ? "pkg_edit" : "pkg_create";
    state.returnToPackage = false;
    state.itemDraft = null;
    state.pkgDraft.step = "items";
  } else {
    state.view = null;
    state.editingItemId = null;
    state.itemDraft = null;
  }
  _invalidateCatalogCaches();
  requestRender();
}

