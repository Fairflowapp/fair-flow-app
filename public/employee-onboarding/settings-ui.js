/**
 * Employee Onboarding Settings UI — manager-facing Items + Packages only.
 * Presentation layer over existing templates / packages / e-sign library APIs.
 * Host: #userProfileCardOnboarding → #ffOnboardingSettingsRoot
 */

import {
  ffGetOnboardingTaskHandler,
  ffNormalizeOnboardingTaskConfig,
} from "./task-registry.js?v=20260810_ux_items_packages";
import {
  ffNormalizeOnboardingAudience,
  ffDescribeOnboardingAudience,
} from "./audience.js?v=20260808_onboarding_hardening";

const STYLE = {
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

/** @type {"items"|"packages"} */
let _tab = "items";
let _bound = false;
let _techTypes = [];

/** @type {null|"item_create"|"item_edit"|"pkg_create"|"pkg_edit"} */
let _view = null;
let _editingItemId = null;
let _editingPackageId = null;

/** Item create wizard draft */
let _itemDraft = null;
/** When creating an item from Package wizard */
let _returnToPackage = false;
/** Package create/edit draft (survives inline item create) */
let _pkgDraft = null;

const ITEM_KINDS = [
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

function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _toast(msg, kind) {
  if (typeof window.showToast === "function") window.showToast(msg, kind || "info");
  else if (typeof window.ffToast === "function") window.ffToast(msg, kind || "info");
  else console.log("[OnboardingSettingsUI]", msg);
}

function _root() {
  return document.getElementById("ffOnboardingSettingsRoot");
}

function _pane() {
  return document.getElementById("ffOnboardingSettingsPane");
}

async function _loadTechTypes() {
  try {
    if (typeof window.ffGetTechnicianTypes === "function") {
      _techTypes = await window.ffGetTechnicianTypes({ all: true });
    } else {
      _techTypes = [];
    }
  } catch (_) {
    _techTypes = [];
  }
}

function _techMap() {
  const m = {};
  (_techTypes || []).forEach((t) => {
    if (t && t.id) m[t.id] = t;
  });
  return m;
}

function _canManage() {
  try {
    if (typeof window.ffCurrentUserCanManageGeneralSettings === "function") {
      return window.ffCurrentUserCanManageGeneralSettings() === true;
    }
  } catch (_) {}
  return false;
}

function _itemKindLabel(taskType) {
  if (taskType === "document" || taskType === "file_upload") return "Upload a file";
  if (taskType === "electronic_signature") return "Sign a document";
  if (taskType === "policy_acknowledgement") return "Acknowledge a policy";
  return "Item";
}

function _itemKindAccent(taskType) {
  if (taskType === "document" || taskType === "file_upload") return "#2563eb";
  if (taskType === "electronic_signature") return "#7c3aed";
  if (taskType === "policy_acknowledgement") return "#059669";
  return "#9ca3af";
}

function _resetItemDraft(kind) {
  _itemDraft = {
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

function _resetPkgDraft(existing) {
  const a = ffNormalizeOnboardingAudience(existing && existing.audience);
  const items = Array.isArray(existing && existing.items)
    ? existing.items.map((it, i) => ({
        templateId: it.templateId,
        required: it.required !== false,
        sortOrder: it.sortOrder != null ? it.sortOrder : i,
      }))
    : [];
  _pkgDraft = {
    step: "basics",
    name: existing ? existing.name || "" : "",
    description: existing ? existing.description || "" : "",
    active: !existing || existing.active !== false,
    audience: a,
    items,
    preselectTemplateId: null,
  };
}

function _renderShell() {
  const root = _root();
  if (!root) return;
  root.innerHTML = `
    <div style="display:flex;gap:4px;border-bottom:1px solid #e5e7eb;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      <button type="button" data-ob-tab="items" style="${_tab === "items" ? STYLE.tabActive : STYLE.tabIdle}">Items</button>
      <button type="button" data-ob-tab="packages" style="${_tab === "packages" ? STYLE.tabActive : STYLE.tabIdle}">Packages</button>
    </div>
    <div id="ffOnboardingSettingsPane"></div>
  `;
  root.querySelectorAll("[data-ob-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (_view && !window.confirm("Leave this screen? Unsaved changes will be lost.")) return;
      _tab = btn.getAttribute("data-ob-tab") || "items";
      _view = null;
      _editingItemId = null;
      _editingPackageId = null;
      _itemDraft = null;
      _pkgDraft = null;
      _returnToPackage = false;
      renderOnboardingSettingsUI();
    });
  });
}

/* ───────────────────────── Items list ───────────────────────── */

async function _linkedSignatureDocumentIds(templates) {
  const ids = new Set();
  (templates || []).forEach((t) => {
    if (!t || t.taskType !== "electronic_signature") return;
    const cfg = t.config || {};
    const id = cfg.signatureDocumentId || cfg.documentId;
    if (id) ids.add(String(id));
  });
  return ids;
}

async function _getUnfinishedSignDrafts(templates) {
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

async function _finishUnfinishedSignDraft(docRow) {
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
  _view = "item_create";
  _editingItemId = null;
  _returnToPackage = false;
  _resetItemDraft("sign");
  _itemDraft.name = String(docRow.title || "Sign document").trim();
  _itemDraft.documentId = docRow.id;
  _itemDraft.versionId = versionId;
  _itemDraft.fieldsSaved = fieldsSaved;
  await renderOnboardingSettingsUI();
  if (fieldsSaved) {
    await _saveSignItemFromDraft({ create: true });
  } else {
    _toast("Finish by marking where to sign, then save", "info");
    setTimeout(() => _openSignFieldEditor(), 50);
  }
}

async function _renderItemsList() {
  const pane = _pane();
  if (!pane) return;
  const canEdit = _canManage();
  const templates = (
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? await window.ffGetOnboardingTaskTemplates()
      : []
  )
    .slice()
    .sort((a, b) => {
      const tb = Number(b.sortOrder);
      const ta = Number(a.sortOrder);
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  const unfinished = canEdit ? await _getUnfinishedSignDrafts(templates) : [];

  const header = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Items</div>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;line-height:1.45;">
          Things you can ask an employee to complete — upload a file, sign a PDF, or acknowledge a policy.
        </p>
      </div>
      ${
        canEdit
          ? `<button type="button" id="obAddItem" style="${STYLE.btnPrimary}">+ Add Item</button>`
          : ""
      }
    </div>
  `;

  const unfinishedRows = unfinished.length
    ? unfinished
        .map(
          (d) => `
      <div style="${STYLE.card};margin-bottom:8px;border-color:#fcd34d;background:#fffbeb;">
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="width:8px;height:8px;border-radius:50%;margin-top:5px;background:#d97706;flex-shrink:0;" aria-hidden="true"></span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:#111827;">${_esc(d.title || "Untitled PDF")}</div>
            <div style="font-size:11px;color:#92400e;margin-top:2px;">
              Sign a document · Not finished yet — mark where to sign and save
            </div>
          </div>
          ${
            canEdit
              ? `<button type="button" data-ob-finish-sign="${_esc(d.id)}" style="${STYLE.btnPrimary}">Finish</button>
                 <button type="button" data-ob-discard-sign="${_esc(d.id)}" style="${STYLE.btnDanger}">Delete</button>`
              : ""
          }
        </div>
      </div>`
        )
        .join("")
    : "";

  const rows =
    templates.length === 0 && unfinished.length === 0
      ? `<div style="${STYLE.empty}">
          <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">No items yet</div>
          <div style="font-size:13px;color:#6b7280;line-height:1.5;max-width:360px;margin:0 auto 14px;">
            Start by adding what new hires need to complete — for example a driver’s license upload or an NDA to sign.
          </div>
          ${
            canEdit
              ? `<button type="button" id="obAddItemEmpty" style="${STYLE.btnPrimary}">+ Add Item</button>`
              : ""
          }
        </div>`
      : templates
          .map((t) => {
            const active = t.active !== false;
            return `
          <div style="${STYLE.card};margin-bottom:8px;opacity:${active ? "1" : "0.7"};">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <span style="width:8px;height:8px;border-radius:50%;margin-top:5px;background:${_itemKindAccent(t.taskType)};flex-shrink:0;" aria-hidden="true"></span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;color:#111827;">${_esc(t.name)}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:2px;">
                  ${_esc(_itemKindLabel(t.taskType))}
                  · ${t.defaultRequired === false ? "Optional by default" : "Required by default"}
                  ${!active ? " · Inactive" : ""}
                </div>
                ${
                  t.description
                    ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;">${_esc(t.description)}</div>`
                    : ""
                }
              </div>
              ${
                canEdit
                  ? `<button type="button" data-ob-item-edit="${_esc(t.id)}" style="${STYLE.btnSmall}">Edit</button>
                     <button type="button" data-ob-item-del="${_esc(t.id)}" style="${STYLE.btnDanger}">Delete</button>`
                  : ""
              }
            </div>
          </div>`;
          })
          .join("");

  pane.innerHTML = `${header}<div>${unfinishedRows}${rows}</div>`;

  const startCreate = () => {
    _view = "item_create";
    _editingItemId = null;
    _returnToPackage = false;
    _resetItemDraft(null);
    renderOnboardingSettingsUI();
  };
  const addBtn = document.getElementById("obAddItem");
  if (addBtn) addBtn.addEventListener("click", startCreate);
  const addEmpty = document.getElementById("obAddItemEmpty");
  if (addEmpty) addEmpty.addEventListener("click", startCreate);

  pane.querySelectorAll("[data-ob-finish-sign]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ob-finish-sign");
      const docRow = unfinished.find((d) => d.id === id);
      if (!docRow) return;
      btn.disabled = true;
      try {
        await _finishUnfinishedSignDraft(docRow);
      } catch (e) {
        _toast(e.message || "Could not finish item", "error");
        btn.disabled = false;
      }
    });
  });

  pane.querySelectorAll("[data-ob-discard-sign]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ob-discard-sign");
      if (!id) return;
      if (!window.confirm("Delete this unfinished signing PDF? This cannot be undone from here.")) return;
      btn.disabled = true;
      try {
        if (typeof window.ffArchiveOnboardingSignatureDocument !== "function") {
          throw new Error("Signing library not loaded yet.");
        }
        await window.ffArchiveOnboardingSignatureDocument(id, true);
        _toast("Draft deleted", "success");
        await renderOnboardingSettingsUI();
      } catch (e) {
        _toast(e.message || "Delete failed", "error");
        btn.disabled = false;
      }
    });
  });

  pane.querySelectorAll("[data-ob-item-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _view = "item_edit";
      _editingItemId = btn.getAttribute("data-ob-item-edit");
      renderOnboardingSettingsUI();
    });
  });
  pane.querySelectorAll("[data-ob-item-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ob-item-del");
      if (!window.confirm("Delete this item? Packages that use it may need updating.")) return;
      btn.disabled = true;
      try {
        await window.ffDeleteOnboardingTaskTemplate(id);
        _toast("Item deleted", "success");
        await renderOnboardingSettingsUI();
      } catch (e) {
        _toast(e.message || "Delete failed", "error");
        btn.disabled = false;
      }
    });
  });
}

/* ───────────────────────── Item create / edit ───────────────────────── */

async function _renderItemCreate() {
  const pane = _pane();
  if (!pane) return;
  if (!_itemDraft) _resetItemDraft(null);

  if (_itemDraft.step === "pick") {
    pane.innerHTML = `
      <div style="margin-bottom:12px;">
        <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
      </div>
      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">What should the employee do?</div>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280;line-height:1.45;">Choose one. You can add more items anytime.</p>
      ${ITEM_KINDS.map((k) => {
        if (k.disabled) {
          return `<div style="${STYLE.typeCardDisabled}">
            <div style="display:flex;justify-content:space-between;gap:8px;">
              <div style="font-size:13px;font-weight:700;color:#6b7280;">${_esc(k.title)}</div>
              <span style="font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:999px;">${_esc(k.badge || "Coming soon")}</span>
            </div>
            <div style="font-size:12px;color:#9ca3af;margin-top:4px;">${_esc(k.blurb)}</div>
          </div>`;
        }
        return `<button type="button" data-ob-kind="${_esc(k.kind)}" style="${STYLE.typeCard}">
          <div style="font-size:13px;font-weight:700;color:#111827;">${_esc(k.title)}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">${_esc(k.blurb)}</div>
        </button>`;
      }).join("")}
    `;
    document.getElementById("obItemBack")?.addEventListener("click", () => {
      if (_returnToPackage && _pkgDraft) {
        _view = _editingPackageId ? "pkg_edit" : "pkg_create";
        _returnToPackage = false;
        _itemDraft = null;
        _pkgDraft.step = "items";
      } else {
        _view = null;
        _itemDraft = null;
      }
      renderOnboardingSettingsUI();
    });
    pane.querySelectorAll("[data-ob-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        _resetItemDraft(btn.getAttribute("data-ob-kind"));
        renderOnboardingSettingsUI();
      });
    });
    return;
  }

  if (_itemDraft.kind === "upload") {
    await _renderUploadItemForm({ create: true });
    return;
  }
  if (_itemDraft.kind === "policy") {
    await _renderPolicyItemForm({ create: true });
    return;
  }
  if (_itemDraft.kind === "sign") {
    await _renderSignItemWizard();
    return;
  }
  _itemDraft.step = "pick";
  renderOnboardingSettingsUI();
}

async function _renderItemEdit() {
  const pane = _pane();
  if (!pane) return;
  const templates =
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? await window.ffGetOnboardingTaskTemplates()
      : [];
  const item = templates.find((t) => t.id === _editingItemId);
  if (!item) {
    _toast("Item not found", "error");
    _view = null;
    _editingItemId = null;
    renderOnboardingSettingsUI();
    return;
  }
  if (item.taskType === "document" || item.taskType === "file_upload") {
    _itemDraft = {
      kind: "upload",
      step: "details",
      name: item.name || "",
      description: item.description || "",
      defaultRequired: item.defaultRequired !== false,
      active: item.active !== false,
      config: item.config || {},
      taskType: item.taskType,
    };
    await _renderUploadItemForm({ create: false, item });
    return;
  }
  if (item.taskType === "policy_acknowledgement") {
    const cfg = ffNormalizeOnboardingTaskConfig("policy_acknowledgement", item.config || {});
    _itemDraft = {
      kind: "policy",
      step: "details",
      name: item.name || "",
      description: item.description || "",
      defaultRequired: item.defaultRequired !== false,
      active: item.active !== false,
      policyText: cfg.bodyHtml || "",
      config: cfg,
    };
    await _renderPolicyItemForm({ create: false, item });
    return;
  }
  if (item.taskType === "electronic_signature") {
    const cfg = ffNormalizeOnboardingTaskConfig("electronic_signature", item.config || {});
    _itemDraft = {
      kind: "sign",
      step: "details",
      name: item.name || "",
      description: item.description || "",
      defaultRequired: item.defaultRequired !== false,
      active: item.active !== false,
      documentId: cfg.signatureDocumentId || cfg.documentId || null,
      versionId: cfg.signatureDocumentVersionId || cfg.documentVersionId || null,
      fieldsSaved: Array.isArray(cfg.fieldSchema) && cfg.fieldSchema.length > 0,
      config: cfg,
    };
    await _renderSignItemEdit(item);
    return;
  }
  pane.innerHTML = `
    <button type="button" id="obItemBack" style="${STYLE.btnGhost};margin-bottom:12px;">← Back</button>
    <div style="${STYLE.card}">This item type isn’t editable in the simplified editor yet.</div>
  `;
  document.getElementById("obItemBack")?.addEventListener("click", () => {
    _view = null;
    _editingItemId = null;
    renderOnboardingSettingsUI();
  });
}

async function _renderUploadItemForm({ create, item }) {
  const pane = _pane();
  if (!pane) return;
  const d = _itemDraft;
  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}" id="obItemForm">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">${create ? "Upload a file" : "Edit item"}</div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Employee will upload a file for this item (for example a driver’s license).</p>
      <label style="${STYLE.label}">Name</label>
      <input id="obItemName" type="text" value="${_esc(d.name)}" placeholder="e.g. Driver’s License" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Instructions (optional)</label>
      <textarea id="obItemDesc" rows="2" placeholder="What should they upload?" style="${STYLE.input};margin-bottom:10px;">${_esc(d.description)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:8px;">
        <input id="obItemRequired" type="checkbox" ${d.defaultRequired !== false ? "checked" : ""} />
        Required by default
      </label>
      ${
        !create
          ? `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:12px;">
              <input id="obItemActive" type="checkbox" ${d.active !== false ? "checked" : ""} />
              Active
            </label>`
          : ""
      }
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button type="button" id="obItemCancel" style="${STYLE.btnGhost}">Cancel</button>
        <button type="button" id="obItemSave" style="${STYLE.btnPrimary}">${create ? "Save Item" : "Save"}</button>
      </div>
    </div>
  `;
  _wireItemNavBack();
  document.getElementById("obItemCancel")?.addEventListener("click", () => _cancelItemWizard());
  document.getElementById("obItemSave")?.addEventListener("click", async () => {
    const name = String((document.getElementById("obItemName") || {}).value || "").trim();
    if (!name) {
      _toast("Please enter a name", "error");
      return;
    }
    const description = String((document.getElementById("obItemDesc") || {}).value || "").trim();
    const defaultRequired = !!(document.getElementById("obItemRequired") || {}).checked;
    const handler = ffGetOnboardingTaskHandler(create ? "document" : item.taskType);
    const config = handler
      ? handler.normalizeConfig(create ? handler.getDefaultConfig() : item.config || {})
      : {};
    const payload = {
      name,
      description,
      defaultRequired,
      active: create ? true : !!(document.getElementById("obItemActive") || {}).checked,
      categoryId: create ? null : item.categoryId || null,
      taskType: create ? "document" : item.taskType,
      config,
    };
    try {
      let createdId = null;
      if (create) {
        const res = await window.ffCreateOnboardingTaskTemplate(payload);
        createdId = res && res.id;
        _toast("Item saved", "success");
      } else {
        await window.ffUpdateOnboardingTaskTemplate(item.id, {
          name: payload.name,
          description: payload.description,
          defaultRequired: payload.defaultRequired,
          active: payload.active,
          config: payload.config,
        });
        _toast("Item updated", "success");
      }
      await _finishItemWizard(createdId);
    } catch (e) {
      _toast(e.message || "Save failed", "error");
    }
  });
}

async function _renderPolicyItemForm({ create, item }) {
  const pane = _pane();
  if (!pane) return;
  const d = _itemDraft;
  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}" id="obItemForm">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">${create ? "Acknowledge a policy" : "Edit item"}</div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Write the policy. Employees will read it and confirm they agree.</p>
      <label style="${STYLE.label}">Name</label>
      <input id="obItemName" type="text" value="${_esc(d.name)}" placeholder="e.g. Dress Code Policy" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Policy text</label>
      <textarea id="obPolicyText" rows="8" placeholder="Paste or type the policy here…" style="${STYLE.input};margin-bottom:10px;font-family:inherit;">${_esc(d.policyText)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:8px;">
        <input id="obItemRequired" type="checkbox" ${d.defaultRequired !== false ? "checked" : ""} />
        Required by default
      </label>
      ${
        !create
          ? `<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:12px;">
              <input id="obItemActive" type="checkbox" ${d.active !== false ? "checked" : ""} />
              Active
            </label>`
          : ""
      }
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
        <button type="button" id="obItemCancel" style="${STYLE.btnGhost}">Cancel</button>
        <button type="button" id="obItemSave" style="${STYLE.btnPrimary}">${create ? "Save Item" : "Save"}</button>
      </div>
    </div>
  `;
  _wireItemNavBack();
  document.getElementById("obItemCancel")?.addEventListener("click", () => _cancelItemWizard());
  document.getElementById("obItemSave")?.addEventListener("click", async () => {
    const name = String((document.getElementById("obItemName") || {}).value || "").trim();
    const policyText = String((document.getElementById("obPolicyText") || {}).value || "").trim();
    if (!name) {
      _toast("Please enter a name", "error");
      return;
    }
    if (!policyText) {
      _toast("Please enter the policy text", "error");
      return;
    }
    const defaultRequired = !!(document.getElementById("obItemRequired") || {}).checked;
    const existingCfg = create
      ? {}
      : ffNormalizeOnboardingTaskConfig("policy_acknowledgement", item.config || {});
    const looksLikeHtml = /^\s*</.test(policyText);
    const config = ffNormalizeOnboardingTaskConfig("policy_acknowledgement", {
      ...existingCfg,
      bodyHtml: looksLikeHtml
        ? policyText
        : `<p>${_esc(policyText).replace(/\n/g, "<br/>")}</p>`,
      version: existingCfg.version || "1",
    });
    try {
      let createdId = null;
      if (create) {
        const res = await window.ffCreateOnboardingTaskTemplate({
          name,
          description: "",
          taskType: "policy_acknowledgement",
          categoryId: null,
          defaultRequired,
          active: true,
          config,
        });
        createdId = res && res.id;
        _toast("Item saved", "success");
      } else {
        await window.ffUpdateOnboardingTaskTemplate(item.id, {
          name,
          defaultRequired,
          active: !!(document.getElementById("obItemActive") || {}).checked,
          config,
        });
        _toast("Item updated", "success");
      }
      await _finishItemWizard(createdId);
    } catch (e) {
      _toast(e.message || "Save failed", "error");
    }
  });
}

async function _renderSignItemWizard() {
  const pane = _pane();
  if (!pane) return;
  const d = _itemDraft;
  const limits =
    typeof window.ffOnboardingEsignLibraryLimits === "function"
      ? window.ffOnboardingEsignLibraryLimits()
      : { maxSizeMb: 20, maxPages: 50 };

  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}" id="obItemForm">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">Sign a document</div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;line-height:1.45;">
        Name it, upload the PDF, mark where to sign, then save — the item will appear in Items.
        Best for agreements like an NDA or handbook (not IRS tax forms).
      </p>
      <label style="${STYLE.label}">Name</label>
      <input id="obItemName" type="text" value="${_esc(d.name)}" placeholder="e.g. NDA" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Instructions (optional)</label>
      <textarea id="obItemDesc" rows="2" style="${STYLE.input};margin-bottom:10px;">${_esc(d.description)}</textarea>
      <label style="${STYLE.label}">PDF to sign</label>
      <input id="obSignFile" type="file" accept="application/pdf,.pdf" style="margin-bottom:6px;font-size:12px;" ${d.documentId ? "disabled" : ""} />
      <div style="font-size:11px;color:#9ca3af;margin-bottom:10px;">PDF only · max ${limits.maxSizeMb} MB · max ${limits.maxPages} pages</div>
      ${
        d.documentId
          ? `<div style="font-size:12px;color:#059669;margin-bottom:10px;font-weight:600;">
              PDF uploaded${d.fieldsSaved ? " · Signature places saved" : " · Next: mark where to sign"}
            </div>`
          : ""
      }
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:14px;">
        <input id="obItemRequired" type="checkbox" ${d.defaultRequired !== false ? "checked" : ""} />
        Required by default
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="obItemCancel" style="${STYLE.btnGhost}">Cancel</button>
        ${
          d.documentId && !d.fieldsSaved
            ? `<button type="button" id="obSignMark" style="${STYLE.btnPrimary}">Mark where to sign</button>`
            : ""
        }
        ${
          d.documentId && d.fieldsSaved
            ? `<button type="button" id="obSignRemark" style="${STYLE.btnGhost}">Edit signature places</button>
               <button type="button" id="obItemSave" style="${STYLE.btnPrimary}">Save Item</button>`
            : ""
        }
        ${
          !d.documentId
            ? `<button type="button" id="obSignUploadNext" style="${STYLE.btnPrimary}">Upload & continue</button>`
            : ""
        }
      </div>
    </div>
  `;

  _wireItemNavBack();
  document.getElementById("obItemCancel")?.addEventListener("click", () => _cancelItemWizard());

  const captureBasics = () => {
    d.name = String((document.getElementById("obItemName") || {}).value || "").trim();
    d.description = String((document.getElementById("obItemDesc") || {}).value || "").trim();
    d.defaultRequired = !!(document.getElementById("obItemRequired") || {}).checked;
  };

  document.getElementById("obSignUploadNext")?.addEventListener("click", async () => {
    captureBasics();
    if (!d.name) {
      _toast("Please enter a name", "error");
      return;
    }
    const fileInput = document.getElementById("obSignFile");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      _toast("Please choose a PDF", "error");
      return;
    }
    const btn = document.getElementById("obSignUploadNext");
    try {
      if (btn) btn.disabled = true;
      _toast("Uploading PDF…", "info");
      if (typeof window.ffEnsureOnboardingEsignLibrarySubscribed === "function") {
        await window.ffEnsureOnboardingEsignLibrarySubscribed();
      }
      const created = await window.ffCreateOnboardingSignatureDocument({
        title: d.name,
        category: "",
        complianceTier: "standard",
      });
      const documentId =
        created && (created.documentId || (created.document && created.document.id));
      if (!documentId) throw new Error("Could not create signature document");
      const up = await window.ffUploadOnboardingSignatureDocumentVersion({
        documentId,
        file,
      });
      const versionId =
        (up && (up.versionId || (up.version && up.version.id))) ||
        (created && created.currentVersionId) ||
        null;
      d.documentId = documentId;
      d.versionId = versionId;
      d.fieldsSaved = false;
      _toast("PDF uploaded — mark where to sign", "success");
      renderOnboardingSettingsUI();
      // Auto-open field editor
      setTimeout(() => _openSignFieldEditor(), 50);
    } catch (e) {
      _toast(e.message || "Upload failed", "error");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById("obSignMark")?.addEventListener("click", () => {
    captureBasics();
    _openSignFieldEditor();
  });
  document.getElementById("obSignRemark")?.addEventListener("click", () => {
    captureBasics();
    _openSignFieldEditor();
  });
  document.getElementById("obItemSave")?.addEventListener("click", async () => {
    captureBasics();
    await _saveSignItemFromDraft({ create: true });
  });
}

async function _renderSignItemEdit(item) {
  const pane = _pane();
  if (!pane) return;
  const d = _itemDraft;
  const hasPdf = !!(d.documentId && d.versionId);
  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">Edit item</div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Sign a document</p>
      <label style="${STYLE.label}">Name</label>
      <input id="obItemName" type="text" value="${_esc(d.name)}" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Instructions (optional)</label>
      <textarea id="obItemDesc" rows="2" style="${STYLE.input};margin-bottom:10px;">${_esc(d.description)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:8px;">
        <input id="obItemRequired" type="checkbox" ${d.defaultRequired !== false ? "checked" : ""} />
        Required by default
      </label>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:12px;">
        <input id="obItemActive" type="checkbox" ${d.active !== false ? "checked" : ""} />
        Active
      </label>
      <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">
        ${
          hasPdf
            ? d.fieldsSaved
              ? "PDF and signature places are set."
              : "PDF is linked — mark where to sign if needed."
            : "No PDF linked yet. Upload a PDF to enable signing."
        }
      </div>
      ${
        !hasPdf
          ? `<label style="${STYLE.label}">PDF to sign</label>
             <input id="obSignFile" type="file" accept="application/pdf,.pdf" style="margin-bottom:12px;font-size:12px;" />`
          : ""
      }
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="obItemCancel" style="${STYLE.btnGhost}">Cancel</button>
        ${hasPdf ? `<button type="button" id="obSignMark" style="${STYLE.btnGhost}">Mark where to sign</button>` : ""}
        ${!hasPdf ? `<button type="button" id="obSignUploadNext" style="${STYLE.btnPrimary}">Upload PDF</button>` : ""}
        <button type="button" id="obItemSave" style="${STYLE.btnPrimary}">Save</button>
      </div>
    </div>
  `;
  _wireItemNavBack();
  document.getElementById("obItemCancel")?.addEventListener("click", () => _cancelItemWizard());

  const captureBasics = () => {
    d.name = String((document.getElementById("obItemName") || {}).value || "").trim();
    d.description = String((document.getElementById("obItemDesc") || {}).value || "").trim();
    d.defaultRequired = !!(document.getElementById("obItemRequired") || {}).checked;
    d.active = !!(document.getElementById("obItemActive") || {}).checked;
  };

  document.getElementById("obSignUploadNext")?.addEventListener("click", async () => {
    captureBasics();
    if (!d.name) {
      _toast("Please enter a name", "error");
      return;
    }
    const fileInput = document.getElementById("obSignFile");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) {
      _toast("Please choose a PDF", "error");
      return;
    }
    try {
      _toast("Uploading PDF…", "info");
      if (typeof window.ffEnsureOnboardingEsignLibrarySubscribed === "function") {
        await window.ffEnsureOnboardingEsignLibrarySubscribed();
      }
      const created = await window.ffCreateOnboardingSignatureDocument({
        title: d.name,
        category: "",
        complianceTier: "standard",
      });
      const documentId =
        created && (created.documentId || (created.document && created.document.id));
      const up = await window.ffUploadOnboardingSignatureDocumentVersion({
        documentId,
        file,
      });
      d.documentId = documentId;
      d.versionId =
        (up && (up.versionId || (up.version && up.version.id))) || null;
      d.fieldsSaved = false;
      renderOnboardingSettingsUI();
      setTimeout(() => _openSignFieldEditor(), 50);
    } catch (e) {
      _toast(e.message || "Upload failed", "error");
    }
  });

  document.getElementById("obSignMark")?.addEventListener("click", () => {
    captureBasics();
    _openSignFieldEditor();
  });

  document.getElementById("obItemSave")?.addEventListener("click", async () => {
    captureBasics();
    await _saveSignItemFromDraft({ create: false, item });
  });
}

async function _openSignFieldEditor() {
  const d = _itemDraft;
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
  const creating = _view === "item_create";
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
          renderOnboardingSettingsUI();
          try {
            window.alert(
              "The PDF layout was saved, but the item was not created yet.\n\nClick Save Item on the next screen (or Finish in Items)."
            );
          } catch (_) {}
        }
        return;
      }
      if (_view === "item_edit" && _editingItemId) {
        const templates =
          typeof window.ffGetOnboardingTaskTemplates === "function"
            ? await window.ffGetOnboardingTaskTemplates()
            : [];
        const item = templates.find((t) => t.id === _editingItemId);
        if (item) {
          await _saveSignItemFromDraft({ create: false, item });
          return;
        }
      }
      _toast("Signature places saved", "success");
      renderOnboardingSettingsUI();
    }
  } catch (e) {
    _toast(e.message || "Could not open signature editor", "error");
  }
}

async function _saveSignItemFromDraft({ create, item }) {
  const d = _itemDraft;
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

function _wireItemNavBack() {
  document.getElementById("obItemBack")?.addEventListener("click", () => {
    if (_view === "item_create" && _itemDraft && _itemDraft.step === "details" && !_itemDraft.documentId) {
      _itemDraft.step = "pick";
      _itemDraft.kind = null;
      renderOnboardingSettingsUI();
      return;
    }
    _cancelItemWizard();
  });
}

function _cancelItemWizard() {
  if (_returnToPackage && _pkgDraft) {
    _view = _editingPackageId ? "pkg_edit" : "pkg_create";
    _returnToPackage = false;
    _itemDraft = null;
    _pkgDraft.step = "items";
  } else {
    _view = null;
    _editingItemId = null;
    _itemDraft = null;
  }
  renderOnboardingSettingsUI();
}

async function _finishItemWizard(createdId) {
  if (_returnToPackage && _pkgDraft) {
    if (createdId) {
      const already = _pkgDraft.items.some((it) => it.templateId === createdId);
      if (!already) {
        _pkgDraft.items.push({
          templateId: createdId,
          required: true,
          sortOrder: _pkgDraft.items.length,
        });
      }
      _pkgDraft.preselectTemplateId = createdId;
    }
    _view = _editingPackageId ? "pkg_edit" : "pkg_create";
    _returnToPackage = false;
    _itemDraft = null;
    _pkgDraft.step = "items";
  } else {
    _view = null;
    _editingItemId = null;
    _itemDraft = null;
  }
  renderOnboardingSettingsUI();
}

/* ───────────────────────── Packages ───────────────────────── */

async function _renderPackagesList() {
  const pane = _pane();
  if (!pane) return;
  const canEdit = _canManage();
  await _loadTechTypes();
  const [packages, templates] = await Promise.all([
    typeof window.ffGetOnboardingPackages === "function"
      ? window.ffGetOnboardingPackages()
      : [],
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? window.ffGetOnboardingTaskTemplates()
      : [],
  ]);
  const tmplMap = {};
  templates.forEach((t) => {
    tmplMap[t.id] = t;
  });

  const header = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Packages</div>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;line-height:1.45;">
          A package is a set of items. You choose which package to send when you start onboarding for each employee.
        </p>
      </div>
      ${
        canEdit
          ? `<button type="button" id="obCreatePkg" style="${STYLE.btnPrimary}">+ Create Package</button>`
          : ""
      }
    </div>
  `;

  const rows =
    packages.length === 0
      ? `<div style="${STYLE.empty}">
          <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">Create your first package</div>
          <div style="font-size:13px;color:#6b7280;line-height:1.5;max-width:380px;margin:0 auto 14px;">
            Packages are sets of items you send to staff. Name one (like “New Employee”), choose the items, then pick who gets it when you start onboarding.
          </div>
          ${
            canEdit
              ? `<button type="button" id="obCreatePkgEmpty" style="${STYLE.btnPrimary}">+ Create Package</button>`
              : ""
          }
        </div>`
      : packages
          .map((p) => {
            const active = p.active !== false;
            const itemCount = Array.isArray(p.items) ? p.items.length : 0;
            const names = (Array.isArray(p.items) ? p.items : [])
              .map((it) => {
                const t = tmplMap[it.templateId];
                return t ? t.name : null;
              })
              .filter(Boolean);
            return `
          <div style="${STYLE.card};margin-bottom:8px;opacity:${active ? "1" : "0.7"};">
            <div style="display:flex;align-items:flex-start;gap:10px;">
              <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:700;color:#111827;">${_esc(p.name)}</div>
                <div style="font-size:11px;color:#6b7280;margin-top:2px;">
                  ${itemCount} item${itemCount === 1 ? "" : "s"}
                  ${!active ? " · Inactive" : ""}
                </div>
                ${
                  names.length
                    ? `<div style="font-size:11px;color:#9ca3af;margin-top:4px;">${names
                        .map((n) => _esc(n))
                        .join(" · ")}</div>`
                    : ""
                }
              </div>
              ${
                canEdit
                  ? `<button type="button" data-ob-pkg-edit="${_esc(p.id)}" style="${STYLE.btnSmall}">Edit</button>
                     <button type="button" data-ob-pkg-del="${_esc(p.id)}" style="${STYLE.btnDanger}">Delete</button>`
                  : ""
              }
            </div>
          </div>`;
          })
          .join("");

  pane.innerHTML = `${header}<div>${rows}</div>`;

  const startCreate = () => {
    _view = "pkg_create";
    _editingPackageId = null;
    _resetPkgDraft(null);
    renderOnboardingSettingsUI();
  };
  document.getElementById("obCreatePkg")?.addEventListener("click", startCreate);
  document.getElementById("obCreatePkgEmpty")?.addEventListener("click", startCreate);

  pane.querySelectorAll("[data-ob-pkg-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _view = "pkg_edit";
      _editingPackageId = btn.getAttribute("data-ob-pkg-edit");
      _pkgDraft = null;
      renderOnboardingSettingsUI();
    });
  });
  pane.querySelectorAll("[data-ob-pkg-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ob-pkg-del");
      if (!window.confirm("Delete this package?")) return;
      try {
        await window.ffDeleteOnboardingPackage(id);
        _toast("Package deleted", "success");
        renderOnboardingSettingsUI();
      } catch (e) {
        _toast(e.message || "Delete failed", "error");
      }
    });
  });
}

function _audienceFormHtml(audience) {
  const a = ffNormalizeOnboardingAudience(audience);
  const techOpts = (_techTypes || [])
    .filter((t) => t.active !== false)
    .map((t) => {
      const selected = a.technicianTypeIds.indexOf(t.id) !== -1;
      return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;margin-bottom:4px;">
        <input type="checkbox" data-ob-aud-tt="${_esc(t.id)}" ${selected ? "checked" : ""} />
        ${_esc(t.name || t.id)}
      </label>`;
    })
    .join("");

  return `
    <div style="font-size:12px;font-weight:700;color:#374151;margin:4px 0 6px;">Who is this for?</div>
    <div style="font-size:11px;color:#6b7280;margin-bottom:8px;line-height:1.4;">Leave everything unchecked to send to everyone.</div>
    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:10px;">
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
        <input type="checkbox" data-ob-aud-wc="w2" ${a.workerClassifications.indexOf("w2") !== -1 ? "checked" : ""} /> W-2
      </label>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;">
        <input type="checkbox" data-ob-aud-wc="1099" ${a.workerClassifications.indexOf("1099") !== -1 ? "checked" : ""} /> 1099
      </label>
    </div>
    <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:4px;">Roles (optional)</div>
    <div style="max-height:140px;overflow:auto;border:1px solid #e5e7eb;border-radius:8px;padding:8px;background:#fff;margin-bottom:10px;">
      ${techOpts || `<div style="font-size:11px;color:#9ca3af;">No roles configured yet.</div>`}
    </div>
  `;
}

function _readAudienceFromForm(pane) {
  const workerClassifications = [];
  pane.querySelectorAll("[data-ob-aud-wc]").forEach((el) => {
    if (el.checked) workerClassifications.push(el.getAttribute("data-ob-aud-wc"));
  });
  const technicianTypeIds = [];
  pane.querySelectorAll("[data-ob-aud-tt]").forEach((el) => {
    if (el.checked) technicianTypeIds.push(el.getAttribute("data-ob-aud-tt"));
  });
  return ffNormalizeOnboardingAudience({ workerClassifications, technicianTypeIds });
}

function _syncPkgItemsFromForm(pane) {
  if (!_pkgDraft) return;
  const selected = [];
  let order = 0;
  pane.querySelectorAll("[data-ob-pkg-item]").forEach((el) => {
    if (!el.checked) return;
    const templateId = el.getAttribute("data-ob-pkg-item");
    const reqEl = pane.querySelector(`[data-ob-pkg-req="${templateId}"]`);
    selected.push({
      templateId,
      required: reqEl ? !!reqEl.checked : true,
      sortOrder: order++,
    });
  });
  _pkgDraft.items = selected;
}

async function _renderPackageWizard() {
  const pane = _pane();
  if (!pane) return;
  await _loadTechTypes();
  const [packages, templates] = await Promise.all([
    typeof window.ffGetOnboardingPackages === "function"
      ? window.ffGetOnboardingPackages()
      : [],
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? window.ffGetOnboardingTaskTemplates()
      : [],
  ]);

  if (_view === "pkg_edit" && !_pkgDraft) {
    const existing = packages.find((p) => p.id === _editingPackageId);
    if (!existing) {
      _toast("Package not found", "error");
      _view = null;
      _editingPackageId = null;
      renderOnboardingSettingsUI();
      return;
    }
    _resetPkgDraft(existing);
  }
  if (!_pkgDraft) _resetPkgDraft(null);

  const d = _pkgDraft;
  const step = d.step || "basics";
  const steps = ["basics", "items", "review"];
  const stepIdx = Math.max(0, steps.indexOf(step));
  const stepLabel =
    step === "basics"
      ? "1 · Name"
      : step === "items"
        ? "2 · Choose items"
        : "3 · Review";

  let body = "";
  if (step === "basics") {
    body = `
      <label style="${STYLE.label}">Package name</label>
      <input id="obPkgName" type="text" value="${_esc(d.name)}" placeholder="e.g. New Employee" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Short description (optional)</label>
      <textarea id="obPkgDesc" rows="2" style="${STYLE.input};margin-bottom:10px;">${_esc(d.description)}</textarea>
      <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.45;">
        You’ll choose who receives this package when you start onboarding for each employee.
      </p>
    `;
  } else if (step === "items") {
    const activeTemplates = (templates || []).filter((t) => t.active !== false);
    const byId = {};
    (d.items || []).forEach((it) => {
      if (it && it.templateId) byId[it.templateId] = it;
    });
    body = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
        <div style="font-size:12px;color:#6b7280;">Select what employees in this package need to complete.</div>
        <button type="button" id="obPkgNewItem" style="${STYLE.btnSmall}">+ Create New Item</button>
      </div>
      ${
        activeTemplates.length === 0
          ? `<div style="${STYLE.empty};margin-bottom:10px;">
              <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:6px;">No items yet</div>
              <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">Create an item first — like a driver’s license upload or an NDA.</div>
              <button type="button" id="obPkgNewItemEmpty" style="${STYLE.btnPrimary}">+ Create New Item</button>
            </div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;">
              ${activeTemplates
                .map((t) => {
                  const it = byId[t.id];
                  const checked = !!it || d.preselectTemplateId === t.id;
                  const required = it ? it.required !== false : t.defaultRequired !== false;
                  return `
                  <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;background:#fff;">
                    <label style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;font-size:12px;color:#111827;">
                      <input type="checkbox" data-ob-pkg-item="${_esc(t.id)}" ${checked ? "checked" : ""} />
                      <span style="min-width:0;">
                        <span style="font-weight:600;">${_esc(t.name)}</span>
                        <span style="color:#6b7280;"> · ${_esc(_itemKindLabel(t.taskType))}</span>
                      </span>
                    </label>
                    <label style="display:flex;align-items:center;gap:4px;font-size:11px;color:#6b7280;white-space:nowrap;">
                      <input type="checkbox" data-ob-pkg-req="${_esc(t.id)}" ${required ? "checked" : ""} />
                      Required
                    </label>
                  </div>`;
                })
                .join("")}
            </div>`
      }
    `;
  } else {
    const chosen = (d.items || [])
      .map((it) => {
        const t = templates.find((x) => x.id === it.templateId);
        return t
          ? { name: t.name, kind: _itemKindLabel(t.taskType), required: it.required !== false }
          : null;
      })
      .filter(Boolean);
    body = `
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;">Review</div>
      <div style="${STYLE.card};margin-bottom:10px;">
        <div style="font-size:14px;font-weight:700;">${_esc(d.name || "Untitled")}</div>
        ${d.description ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;">${_esc(d.description)}</div>` : ""}
        <div style="font-size:12px;color:#6b7280;margin-top:8px;">You pick who gets this when you start onboarding.</div>
      </div>
      <div style="font-size:12px;font-weight:700;color:#374151;margin-bottom:6px;">Items (${chosen.length})</div>
      ${
        chosen.length
          ? chosen
              .map(
                (c) =>
                  `<div style="font-size:12px;color:#111827;padding:6px 0;border-bottom:1px solid #f3f4f6;">
                    ${_esc(c.name)}
                    <span style="color:#6b7280;"> · ${_esc(c.kind)} · ${c.required ? "Required" : "Optional"}</span>
                  </div>`
              )
              .join("")
          : `<div style="font-size:12px;color:#b91c1c;">No items selected — go back and choose at least one.</div>`
      }
    `;
  }

  pane.innerHTML = `
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
      <button type="button" id="obPkgCancel" style="${STYLE.btnGhost}">← Cancel</button>
      <div style="font-size:11px;font-weight:700;color:#7c3aed;">${_esc(stepLabel)}</div>
    </div>
    <div style="${STYLE.formBox}" id="obPkgForm">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:12px;">
        ${_view === "pkg_edit" ? "Edit package" : "Create package"}
      </div>
      ${body}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;">
        ${
          stepIdx > 0
            ? `<button type="button" id="obPkgPrev" style="${STYLE.btnGhost}">Back</button>`
            : ""
        }
        ${
          step !== "review"
            ? `<button type="button" id="obPkgNext" style="${STYLE.btnPrimary}">Continue</button>`
            : `<button type="button" id="obPkgSave" style="${STYLE.btnPrimary}">${
                _view === "pkg_edit" ? "Save Package" : "Create Package"
              }</button>`
        }
      </div>
    </div>
  `;

  const form = document.getElementById("obPkgForm") || pane;

  const persistBasics = () => {
    d.name = String((document.getElementById("obPkgName") || {}).value || "").trim();
    d.description = String((document.getElementById("obPkgDesc") || {}).value || "").trim();
    // Owner chooses the recipient when starting onboarding — packages stay universal.
    d.audience = ffNormalizeOnboardingAudience({});
  };

  document.getElementById("obPkgCancel")?.addEventListener("click", () => {
    if (!window.confirm("Leave package setup? Unsaved changes will be lost.")) return;
    _view = null;
    _editingPackageId = null;
    _pkgDraft = null;
    renderOnboardingSettingsUI();
  });

  document.getElementById("obPkgPrev")?.addEventListener("click", () => {
    if (step === "items") _syncPkgItemsFromForm(form);
    if (step === "review") {
      /* no-op */
    }
    if (step === "basics") persistBasics();
    d.step = steps[Math.max(0, stepIdx - 1)];
    renderOnboardingSettingsUI();
  });

  document.getElementById("obPkgNext")?.addEventListener("click", () => {
    if (step === "basics") {
      persistBasics();
      if (!d.name) {
        _toast("Please enter a package name", "error");
        return;
      }
      d.step = "items";
    } else if (step === "items") {
      _syncPkgItemsFromForm(form);
      if (!d.items.length) {
        _toast("Choose at least one item, or create a new one", "error");
        return;
      }
      d.preselectTemplateId = null;
      d.step = "review";
    }
    renderOnboardingSettingsUI();
  });

  const startInlineItem = () => {
    if (step === "basics") persistBasics();
    if (step === "items") _syncPkgItemsFromForm(form);
    _returnToPackage = true;
    _view = "item_create";
    _editingItemId = null;
    _resetItemDraft(null);
    renderOnboardingSettingsUI();
  };
  document.getElementById("obPkgNewItem")?.addEventListener("click", startInlineItem);
  document.getElementById("obPkgNewItemEmpty")?.addEventListener("click", startInlineItem);

  document.getElementById("obPkgSave")?.addEventListener("click", async () => {
    if (!d.name) {
      _toast("Please enter a package name", "error");
      return;
    }
    if (!d.items.length) {
      _toast("Choose at least one item", "error");
      return;
    }
    const payload = {
      name: d.name,
      description: d.description || "",
      active: d.active !== false,
      audience: ffNormalizeOnboardingAudience({}),
      items: d.items.map((it, i) => ({
        templateId: it.templateId,
        required: it.required !== false,
        sortOrder: i,
      })),
    };
    try {
      if (_view === "pkg_edit" && _editingPackageId) {
        await window.ffUpdateOnboardingPackage(_editingPackageId, payload);
        _toast("Package updated", "success");
      } else {
        await window.ffCreateOnboardingPackage(payload);
        _toast("Package created", "success");
      }
      _view = null;
      _editingPackageId = null;
      _pkgDraft = null;
      _tab = "packages";
      renderOnboardingSettingsUI();
    } catch (e) {
      _toast(e.message || "Save failed", "error");
    }
  });
}

/* ───────────────────────── Public API ───────────────────────── */

export async function renderOnboardingSettingsUI() {
  if (typeof window.ffEnsureOnboardingSettingsSubscribed === "function") {
    try {
      await window.ffEnsureOnboardingSettingsSubscribed();
    } catch (e) {
      console.warn(e);
    }
  }
  const root = _root();
  if (!root) return;
  _renderShell();
  if (_view === "item_create") {
    await _renderItemCreate();
    return;
  }
  if (_view === "item_edit") {
    await _renderItemEdit();
    return;
  }
  if (_view === "pkg_create" || _view === "pkg_edit") {
    await _renderPackageWizard();
    return;
  }
  if (_tab === "items") await _renderItemsList();
  else await _renderPackagesList();
}

export function initOnboardingSettingsUI() {
  if (_bound) return;
  _bound = true;
  const refreshIfVisible = () => {
    if (_view) return;
    const root = _root();
    if (!root || !root.isConnected) return;
    const card = document.getElementById("userProfileCardOnboarding");
    if (card && card.style.display === "none") return;
    renderOnboardingSettingsUI();
  };
  document.addEventListener("ff-onboarding-templates-updated", refreshIfVisible);
  document.addEventListener("ff-onboarding-packages-updated", refreshIfVisible);
  document.addEventListener("ff-onboarding-categories-updated", refreshIfVisible);
  document.addEventListener("ff-onboarding-esign-docs-updated", () => {
    // Refresh list so unfinished PDF drafts appear under Items.
    if (!_view && _tab === "items") refreshIfVisible();
    else if (_view === "item_create" || _view === "item_edit") refreshIfVisible();
  });
}

if (typeof window !== "undefined") {
  window.renderOnboardingSettingsUI = renderOnboardingSettingsUI;
  window.ffRenderOnboardingSettingsUI = renderOnboardingSettingsUI;
  window.initOnboardingSettingsUI = initOnboardingSettingsUI;
  initOnboardingSettingsUI();
}
