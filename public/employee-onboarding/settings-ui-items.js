/**
 * Employee Onboarding Settings UI — Items list + create/edit/sign wizards.
 */

import {
  ffGetOnboardingTaskHandler,
  ffNormalizeOnboardingTaskConfig,
} from "./task-registry.js?v=20260816_od_link";
import {
  STYLE,
  ITEM_KINDS,
  state,
  requestRender,
  _esc,
  _obBtn,
  _toast,
  _errMsg,
  _pdfFilePickerHtml,
  _wirePdfFilePicker,
  _pane,
  _canManage,
  _itemKindLabel,
  _itemKindAccent,
  _resetItemDraft,
  _getUnfinishedSignDrafts,
  _finishUnfinishedSignDraft,
  _wireItemNavBack,
  _cancelItemWizard,
  _finishItemWizard,
  _openSignFieldEditor,
  _itemErrorBannerHtml,
  _saveSignItemFromDraft,
  ffSettingsCreateTaskTemplate,
  ffSettingsUpdateTaskTemplate,
  ffSettingsDeleteTaskTemplate,
  ffSettingsListTaskTemplates,
} from "./settings-ui-shared.js?v=20260816_od_open";

export async function _renderItemsList() {
  if (!_pane()) return;
  const canEdit = _canManage();
  const templatesRaw = await ffSettingsListTaskTemplates();
  const templates = (Array.isArray(templatesRaw) ? templatesRaw : [])
    .slice()
    .sort((a, b) => {
      const tb = Number(b.sortOrder);
      const ta = Number(a.sortOrder);
      if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  if (state.view) return;
  let unfinished = [];
  const pane = _pane();
  if (!pane || !pane.isConnected) return;

  const addItemBtn = canEdit
    ? _obBtn({
        id: "obAddItem",
        label: "+ Add Item",
        style: STYLE.btnPrimary,
        onclick: "window.ffOnboardingAddItem&&window.ffOnboardingAddItem()",
      })
    : "";
  const header = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <div style="flex:1;min-width:200px;">
        <div style="font-size:14px;font-weight:700;color:#111827;">Items</div>
        <p style="margin:4px 0 0;font-size:12px;color:#6b7280;line-height:1.45;">
          Things you can ask an employee to complete — upload a file, sign a PDF, or acknowledge a policy.
        </p>
      </div>
      ${addItemBtn}
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
              ? _obBtn({ attrs: 'data-ob-finish-sign="' + _esc(d.id) + '"', label: "Finish", style: STYLE.btnPrimary }) +
                _obBtn({ attrs: 'data-ob-discard-sign="' + _esc(d.id) + '"', label: "Delete", style: STYLE.btnDanger })
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
          <div style="font-size:13px;color:#6b7280;line-height:1.5;max-width:360px;margin:0 auto;">
            Start by adding what new hires need to complete — for example a driver’s license upload or an NDA to sign.
          </div>
          ${
            canEdit
              ? '<div style="margin-top:14px;">' +
                _obBtn({
                  id: "obAddItemEmpty",
                  label: "+ Add Item",
                  style: STYLE.btnPrimary,
                  onclick: "window.ffOnboardingAddItem&&window.ffOnboardingAddItem()",
                }) +
                "</div>"
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
                    ? '<div style="font-size:11px;color:#9ca3af;margin-top:4px;">' + _esc(t.description) + "</div>"
                    : ""
                }
              </div>
              ${
                canEdit
                  ? _obBtn({ attrs: 'data-ob-item-edit="' + _esc(t.id) + '"', label: "Edit", style: STYLE.btnSmall }) +
                    _obBtn({ attrs: 'data-ob-item-del="' + _esc(t.id) + '"', label: "Delete", style: STYLE.btnDanger })
                  : ""
              }
            </div>
          </div>`;
          })
          .join("");

  if (state.view) return;
  pane.innerHTML = `${header}<div>${unfinishedRows}${rows}</div>`;

  if (canEdit) {
    void Promise.race([
      _getUnfinishedSignDrafts(templates),
      new Promise((resolve) => setTimeout(() => resolve(null), 2000)),
    ])
      .then((rows) => {
        if (!Array.isArray(rows) || !rows.length) return;
        if (state.view) return;
        const key = rows.map((d) => d && d.id).filter(Boolean).join(",");
        if (state._unfinishedSignKey === key) return;
        state._unfinishedSignKey = key;
        return requestRender();
      })
      .catch(() => {});
  }

  const addBtn = document.getElementById("obAddItem");
  if (addBtn) addBtn.addEventListener("click", () => {
    if (typeof window.ffOnboardingAddItem === "function") window.ffOnboardingAddItem();
  });

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
        await requestRender();
      } catch (e) {
        console.error("[OnboardingSettings] discard draft failed", e);
        const msg = _errMsg(e, "Delete failed");
        _toast(msg, "error");
        try { window.alert(msg); } catch (_) {}
        btn.disabled = false;
      }
    });
  });

  pane.querySelectorAll("[data-ob-item-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = "item_edit";
      state.editingItemId = btn.getAttribute("data-ob-item-edit");
      requestRender();
    });
  });
  pane.querySelectorAll("[data-ob-item-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ob-item-del");
      if (!window.confirm("Delete this item? Packages that use it may need updating.")) return;
      btn.disabled = true;
      try {
        await ffSettingsDeleteTaskTemplate(id);
        _toast("Item deleted", "success");
        await requestRender();
      } catch (e) {
        console.error("[OnboardingSettings] delete item failed", e);
        const msg = _errMsg(e, "Delete failed");
        _toast(msg, "error");
        try { window.alert(msg); } catch (_) {}
        btn.disabled = false;
      }
    });
  });
}


/* ───────────────────────── Item create / edit ───────────────────────── */

export async function _renderItemCreate() {
  const pane = _pane();
  if (!pane) return;
  if (!state.itemDraft) _resetItemDraft(null);

  if (state.itemDraft.step === "pick") {
    const kindCards = ITEM_KINDS.map((k) => {
      if (k.disabled) {
        return (
          '<div style="' + STYLE.typeCardDisabled + '">' +
          '<div style="display:flex;justify-content:space-between;gap:8px;">' +
          '<div style="font-size:13px;font-weight:700;color:#6b7280;">' + _esc(k.title) + "</div>" +
          '<span style="font-size:10px;font-weight:700;color:#92400e;background:#fef3c7;padding:2px 8px;border-radius:999px;">' +
          _esc(k.badge || "Coming soon") +
          "</span></div>" +
          '<div style="font-size:12px;color:#9ca3af;margin-top:4px;">' + _esc(k.blurb) + "</div></div>"
        );
      }
      return _obBtn({
        attrs: 'data-ob-kind="' + _esc(k.kind) + '"',
        onclick: "window.ffOnboardingPickItemKind&&window.ffOnboardingPickItemKind('" + _esc(k.kind) + "')",
        style: STYLE.typeCard,
        label:
          '<div style="font-size:13px;font-weight:700;color:#111827;">' +
          _esc(k.title) +
          '</div><div style="font-size:12px;color:#6b7280;margin-top:4px;">' +
          _esc(k.blurb) +
          "</div>",
      });
    }).join("");
    pane.innerHTML = `
      <div style="margin-bottom:12px;">
        <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
      </div>
      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">What should the employee do?</div>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280;line-height:1.45;">Choose one. You can add more items anytime.</p>
      ${kindCards}
    `;
    document.getElementById("obItemBack")?.addEventListener("click", () => {
      if (state.returnToPackage && state.pkgDraft) {
        state.view = state.editingPackageId ? "pkg_edit" : "pkg_create";
        state.returnToPackage = false;
        state.itemDraft = null;
        state.pkgDraft.step = "items";
      } else {
        state.view = null;
        state.itemDraft = null;
      }
      requestRender();
    });
    pane.querySelectorAll("[data-ob-kind]").forEach((btn) => {
      btn.addEventListener("click", () => {
        _resetItemDraft(btn.getAttribute("data-ob-kind"));
        requestRender();
      });
    });
    return;
  }

  if (state.itemDraft.kind === "upload") {
    await _renderUploadItemForm({ create: true });
    return;
  }
  if (state.itemDraft.kind === "policy") {
    await _renderPolicyItemForm({ create: true });
    return;
  }
  if (state.itemDraft.kind === "sign") {
    await _renderSignItemWizard();
    return;
  }
  state.itemDraft.step = "pick";
  requestRender();
}

export async function _renderItemEdit() {
  const pane = _pane();
  if (!pane) return;
  const templates = await ffSettingsListTaskTemplates();
  const item = templates.find((t) => t.id === state.editingItemId);
  if (!item) {
    _toast("Item not found", "error");
    state.view = null;
    state.editingItemId = null;
    requestRender();
    return;
  }
  if (item.taskType === "document" || item.taskType === "file_upload") {
    state.itemDraft = {
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
    state.itemDraft = {
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
    state.itemDraft = {
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
    state.view = null;
    state.editingItemId = null;
    requestRender();
  });
}

export async function _renderUploadItemForm({ create, item }) {
  const pane = _pane();
  if (!pane) return;
  const d = state.itemDraft;
  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}" id="obItemForm">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">${create ? "Upload a file" : "Edit item"}</div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Employee will upload a file for this item (for example a driver’s license). First time is here in Onboarding. When it expires, they renew the same document in Inbox.</p>
      <label style="${STYLE.label}">Name</label>
      <input id="obItemName" type="text" value="${_esc(d.name)}" placeholder="e.g. Driver’s License" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Instructions (optional)</label>
      <textarea id="obItemDesc" rows="2" placeholder="What should they upload?" style="${STYLE.input};margin-bottom:10px;">${_esc(d.description)}</textarea>
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:8px;">
        <input id="obItemRequired" type="checkbox" ${d.defaultRequired !== false ? "checked" : ""} />
        Required by default
      </label>
      <label style="display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#374151;margin-bottom:8px;">
        <input id="obItemRequiresExp" type="checkbox" ${(d.config && d.config.requiresExpiration === false) ? "" : "checked"} style="margin-top:2px;" />
        <span>Require expiration date (needed for the 30-day Inbox reminder)</span>
      </label>
      ${
        !create
          ? '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:12px;"><input id="obItemActive" type="checkbox" ' +
            (d.active !== false ? "checked" : "") +
            " /> Active</label>"
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
      ? handler.normalizeConfig({
          ...(create ? handler.getDefaultConfig() : item.config || {}),
          requiresExpiration: !!(document.getElementById("obItemRequiresExp") || {}).checked,
        })
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
        const res = await ffSettingsCreateTaskTemplate(payload);
        createdId = res && res.id;
        _toast("Item saved", "success");
      } else {
        await ffSettingsUpdateTaskTemplate(item.id, {
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

export async function _renderPolicyItemForm({ create, item }) {
  const pane = _pane();
  if (!pane) return;
  const d = state.itemDraft;
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
          ? '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:12px;"><input id="obItemActive" type="checkbox" ' +
            (d.active !== false ? "checked" : "") +
            " /> Active</label>"
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
        const res = await ffSettingsCreateTaskTemplate({
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
        await ffSettingsUpdateTaskTemplate(item.id, {
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

export async function _renderSignItemWizard() {
  const pane = _pane();
  if (!pane) return;
  const d = state.itemDraft;
  const limits =
    typeof window.ffOnboardingEsignLibraryLimits === "function"
      ? window.ffOnboardingEsignLibraryLimits()
      : { maxSizeMb: 20, maxPages: 50 };

  const pdfPicker = d.documentId
    ? '<div style="font-size:12px;color:#059669;margin-bottom:6px;font-weight:600;">PDF already uploaded</div>'
    : _pdfFilePickerHtml({ id: "obSignFile" });
  const pdfNext = d.documentId
    ? '<div style="font-size:12px;color:#059669;margin-bottom:10px;font-weight:600;">PDF uploaded' +
      (d.fieldsSaved ? " · Signature places saved" : " · Next: mark where to sign") +
      "</div>"
    : "";
  const markBtn = d.documentId && !d.fieldsSaved
    ? _obBtn({
        id: "obSignMark",
        label: "Mark where to sign",
        style: STYLE.btnPrimary,
        onclick: "window.ffOnboardingMarkSign&&window.ffOnboardingMarkSign()",
      })
    : "";
  const savedBtns = d.documentId && d.fieldsSaved
    ? _obBtn({
        id: "obSignRemark",
        label: "Edit signature places",
        style: STYLE.btnGhost,
        onclick: "window.ffOnboardingMarkSign&&window.ffOnboardingMarkSign()",
      }) + _obBtn({ id: "obItemSave", label: "Save Item", style: STYLE.btnPrimary })
    : "";
  const uploadBtn = !d.documentId
    ? _obBtn({ id: "obSignUploadNext", label: "Upload & continue", style: STYLE.btnPrimary })
    : "";

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
      ${_itemErrorBannerHtml()}
      <label style="${STYLE.label}">PDF to sign</label>
      ${pdfPicker}
      <div style="font-size:11px;color:#9ca3af;margin-bottom:10px;">PDF only · max ${limits.maxSizeMb} MB · max ${limits.maxPages} pages</div>
      ${pdfNext}
      <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#374151;margin-bottom:14px;">
        <input id="obItemRequired" type="checkbox" ${d.defaultRequired !== false ? "checked" : ""} />
        Required by default
      </label>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="obItemCancel" style="${STYLE.btnGhost}">Cancel</button>
        ${markBtn}
        ${savedBtns}
        ${uploadBtn}
      </div>
    </div>
  `;

  _wireItemNavBack();
  if (!d.documentId) _wirePdfFilePicker("obSignFile");
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
    if (typeof window.ffCreateOnboardingSignatureDocument !== "function" ||
        typeof window.ffUploadOnboardingSignatureDocumentVersion !== "function") {
      const msg = "Upload module is still loading — wait a second and try again.";
      _toast(msg, "error");
      try { window.alert(msg); } catch (_) {}
      return;
    }
    const btn = document.getElementById("obSignUploadNext");
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Uploading…";
      }
      _toast("Uploading PDF…", "info");
      if (typeof window.ffEnsureOnboardingEsignLibrarySubscribed === "function") {
        await Promise.race([
          window.ffEnsureOnboardingEsignLibrarySubscribed(),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
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
      if (!versionId) throw new Error("Upload finished but version id is missing");
      d.documentId = documentId;
      d.versionId = versionId;
      d.fieldsSaved = false;
      _toast("PDF uploaded — mark where to sign", "success");
      await requestRender();
      if (typeof window.ffOnboardingMarkSign === "function") {
        await window.ffOnboardingMarkSign();
      } else {
        await _openSignFieldEditor();
      }
    } catch (e) {
      console.error("[OnboardingSettings] PDF upload failed", e);
      const msg = _errMsg(e, "Upload failed");
      _toast(msg, "error");
      try { window.alert(msg); } catch (_) {}
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Upload & continue";
      }
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

export async function _renderSignItemEdit(item) {
  const pane = _pane();
  if (!pane) return;
  const d = state.itemDraft;
  const hasPdf = !!(d.documentId && d.versionId);
  const pdfHint = hasPdf
    ? d.fieldsSaved
      ? "PDF and signature places are set."
      : "PDF is linked — mark where to sign if needed."
    : "No PDF linked yet. Upload a PDF to enable signing.";
  const pdfUpload = !hasPdf
    ? '<label style="' + STYLE.label + '">PDF to sign</label>' + _pdfFilePickerHtml({ id: "obSignFile" })
    : "";
  const editMarkBtn = hasPdf
    ? _obBtn({
        id: "obSignMark",
        label: "Mark where to sign",
        style: STYLE.btnGhost,
        onclick: "window.ffOnboardingMarkSign&&window.ffOnboardingMarkSign()",
      })
    : "";
  const editUploadBtn = !hasPdf
    ? _obBtn({ id: "obSignUploadNext", label: "Upload PDF", style: STYLE.btnPrimary })
    : "";
  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obItemBack" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">Edit item</div>
      <p style="margin:0 0 12px;font-size:12px;color:#6b7280;">Sign a document</p>
      ${_itemErrorBannerHtml()}
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
        ${pdfHint}
      </div>
      ${pdfUpload}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" id="obItemCancel" style="${STYLE.btnGhost}">Cancel</button>
        ${editMarkBtn}
        ${editUploadBtn}
        <button type="button" id="obItemSave" style="${STYLE.btnPrimary}">Save</button>
      </div>
    </div>
  `;
  _wireItemNavBack();
  if (!hasPdf) _wirePdfFilePicker("obSignFile");
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
    const btn = document.getElementById("obSignUploadNext");
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Uploading…";
      }
      _toast("Uploading PDF…", "info");
      if (typeof window.ffEnsureOnboardingEsignLibrarySubscribed === "function") {
        await Promise.race([
          window.ffEnsureOnboardingEsignLibrarySubscribed(),
          new Promise((r) => setTimeout(r, 2500)),
        ]);
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
      d.documentId = documentId;
      d.versionId =
        (up && (up.versionId || (up.version && up.version.id))) || null;
      if (!d.versionId) throw new Error("Upload finished but version id is missing");
      d.fieldsSaved = false;
      await requestRender();
      if (typeof window.ffOnboardingMarkSign === "function") {
        await window.ffOnboardingMarkSign();
      } else {
        await _openSignFieldEditor();
      }
    } catch (e) {
      console.error("[OnboardingSettings] PDF upload failed", e);
      const msg = _errMsg(e, "Upload failed");
      _toast(msg, "error");
      try { window.alert(msg); } catch (_) {}
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Upload PDF";
      }
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

