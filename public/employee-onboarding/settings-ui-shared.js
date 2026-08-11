/**
 * Employee Onboarding Settings UI — shared styles, state, and helpers.
 */

import {
  ffNormalizeOnboardingAudience,
} from "./audience.js?v=20260808_onboarding_hardening";
import {
  ffGetOnboardingTaskHandler,
  ffNormalizeOnboardingTaskConfig,
} from "./task-registry.js?v=20260810_ux_items_packages";

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

export function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function _toast(msg, kind) {
  if (typeof window.showToast === "function") window.showToast(msg, kind || "info");
  else if (typeof window.ffToast === "function") window.ffToast(msg, kind || "info");
  else console.log("[OnboardingSettingsUI]", msg);
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
    _toast("Signature editor is still loading — try again in a moment", "error");
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
    _toast(e.message || "Could not open signature editor", "error");
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
      const res = await window.ffCreateOnboardingTaskTemplate({
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
      await window.ffUpdateOnboardingTaskTemplate(item.id, {
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
    setTimeout(() => _openSignFieldEditor(), 50);
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
  requestRender();
}

