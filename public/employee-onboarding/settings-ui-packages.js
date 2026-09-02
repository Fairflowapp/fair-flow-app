/**
 * Employee Onboarding Settings UI — Packages list + create/edit wizard.
 */

import {
  ffNormalizeOnboardingAudience,
} from "./audience.js?v=20260808_onboarding_hardening";
import {
  STYLE,
  _obBtn,
  state,
  requestRender,
  _esc,
  _toast,
  _pane,
  _canManage,
  _itemKindLabel,
  _loadTechTypes,
  _resetItemDraft,
  _resetPkgDraft,
} from "./settings-ui-shared.js?v=20260816_od_open";

async function _callOnboardingFn(name, data) {
  const { getFunctions, httpsCallable } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js"
  );
  const fn = httpsCallable(getFunctions(undefined, "us-central1"), name);
  const res = await fn(data || {});
  return res && res.data;
}

function _salonId() {
  try {
    return String((typeof window !== "undefined" && window.currentSalonId) || "").trim();
  } catch (_) {
    return "";
  }
}

async function _savePackageViaCallable(packageId, payload) {
  const salonId = _salonId();
  if (!salonId) throw new Error("No salon selected");
  const items = (payload.items || []).map((it, i) => ({
    templateId: it.templateId,
    required: it.required !== false,
    sortOrder: i,
  }));
  if (packageId) {
    await _callOnboardingFn("updateOnboardingPackage", {
      salonId,
      packageId,
      updates: {
        name: payload.name,
        description: payload.description || "",
        active: payload.active !== false,
        audience: payload.audience || {
          workerClassifications: [],
          technicianTypeIds: [],
        },
        items,
      },
    });
    return { id: packageId };
  }
  return _callOnboardingFn("createOnboardingPackage", {
    salonId,
    payload: {
      name: payload.name,
      description: payload.description || "",
      active: payload.active !== false,
      audience: payload.audience || {
        workerClassifications: [],
        technicianTypeIds: [],
      },
      items,
    },
  });
}

export async function _renderPackagesList() {
  if (!_pane()) return;
  const canEdit = _canManage();
  await _loadTechTypes();
  const [packagesRaw, templatesRaw] = await Promise.all([
    typeof window.ffGetOnboardingPackages === "function"
      ? window.ffGetOnboardingPackages()
      : [],
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? window.ffGetOnboardingTaskTemplates()
      : [],
  ]);
  const pane = _pane();
  // Concurrent re-render replaces #ffOnboardingSettingsPane — never write to a detached node.
  if (!pane || !pane.isConnected) return;
  const packages = Array.isArray(packagesRaw) ? packagesRaw : [];
  const templates = Array.isArray(templatesRaw) ? templatesRaw : [];
  const tmplMap = {};
  templates.forEach((t) => {
    if (t && t.id) tmplMap[t.id] = t;
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
          ? _obBtn({ id: "obCreatePkg", label: "+ Create Package", style: STYLE.btnPrimary })
          : ""
      }
    </div>
  `;

  const rows =
    packages.length === 0
      ? `<div style="${STYLE.empty}">
          <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:6px;">Create your first package</div>
          <div style="font-size:13px;color:#6b7280;line-height:1.5;max-width:380px;margin:0 auto;">
            Packages are sets of items you send to staff. Name one (like “New Employee”), choose the items, then pick who gets it when you start onboarding.
          </div>
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
                    ? '<div style="font-size:11px;color:#9ca3af;margin-top:4px;">' +
                      names.map((n) => _esc(n)).join(" · ") +
                      "</div>"
                    : ""
                }
              </div>
              ${
                canEdit
                  ? _obBtn({ attrs: 'data-ob-pkg-edit="' + _esc(p.id) + '"', label: "Edit", style: STYLE.btnSmall }) +
                    _obBtn({ attrs: 'data-ob-pkg-del="' + _esc(p.id) + '"', label: "Delete", style: STYLE.btnDanger })
                  : ""
              }
            </div>
          </div>`;
          })
          .join("");

  pane.innerHTML = `${header}<div>${rows}</div>`;

  const startCreate = () => {
    state.view = "pkg_create";
    state.editingPackageId = null;
    _resetPkgDraft(null);
    requestRender();
  };
  document.getElementById("obCreatePkg")?.addEventListener("click", startCreate);

  pane.querySelectorAll("[data-ob-pkg-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = "pkg_edit";
      state.editingPackageId = btn.getAttribute("data-ob-pkg-edit");
      state.pkgDraft = null;
      requestRender();
    });
  });
  pane.querySelectorAll("[data-ob-pkg-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ob-pkg-del");
      if (!window.confirm("Delete this package?")) return;
      try {
        if (typeof window.ffDeleteOnboardingPackage === "function") {
          await window.ffDeleteOnboardingPackage(id);
        } else {
          const salonId = _salonId();
          if (!salonId) throw new Error("No salon selected");
          await _callOnboardingFn("deleteOnboardingPackage", {
            salonId,
            packageId: id,
          });
        }
        if (typeof window.ffInvalidateOnboardingCatalogCache === "function") {
          window.ffInvalidateOnboardingCatalogCache();
        }
        _toast("Package deleted", "success");
        requestRender();
      } catch (e) {
        _toast(e.message || "Delete failed", "error");
      }
    });
  });
}

export function _audienceFormHtml(audience) {
  const a = ffNormalizeOnboardingAudience(audience);
  const techOpts = (state.techTypes || [])
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

export function _readAudienceFromForm(pane) {
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

export function _syncPkgItemsFromForm(pane) {
  if (!state.pkgDraft) return;
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
  state.pkgDraft.items = selected;
}

export async function _renderPackageWizard() {
  if (!_pane()) return;
  await _loadTechTypes();
  const [packagesRaw, templatesRaw] = await Promise.all([
    typeof window.ffGetOnboardingPackages === "function"
      ? window.ffGetOnboardingPackages()
      : [],
    typeof window.ffGetOnboardingTaskTemplates === "function"
      ? window.ffGetOnboardingTaskTemplates()
      : [],
  ]);
  const pane = _pane();
  if (!pane || !pane.isConnected) return;
  const packages = Array.isArray(packagesRaw) ? packagesRaw : [];
  const templates = Array.isArray(templatesRaw) ? templatesRaw : [];

  if (state.view === "pkg_edit" && !state.pkgDraft) {
    const existing = packages.find((p) => p.id === state.editingPackageId);
    if (!existing) {
      _toast("Package not found", "error");
      state.view = null;
      state.editingPackageId = null;
      requestRender();
      return;
    }
    _resetPkgDraft(existing);
  }
  if (!state.pkgDraft) _resetPkgDraft(null);

  const d = state.pkgDraft;
  const activeTemplates = (templates || []).filter((t) => t.active !== false);
  const byId = {};
  (d.items || []).forEach((it) => {
    if (it && it.templateId) byId[it.templateId] = it;
  });
  const selectedCount = (d.items || []).length;

  const itemsBlock =
    activeTemplates.length === 0
      ? `<div style="${STYLE.empty};margin-bottom:10px;">
          <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:6px;">No items yet</div>
          <div style="font-size:12px;color:#6b7280;margin-bottom:12px;">Create an item first — like a driver’s license upload or an NDA.</div>
              <button type="button" id="obPkgNewItemEmpty" onclick="window.ffOnboardingAddItem&&window.ffOnboardingAddItem()" style="${STYLE.btnPrimary}">+ Create New Item</button>
        </div>`
      : `<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:4px;">
          ${activeTemplates
            .map((t) => {
              const it = byId[t.id];
              const checked = !!it || d.preselectTemplateId === t.id;
              const required = it ? it.required !== false : t.defaultRequired !== false;
              return `
              <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid ${checked ? "#ddd6fe" : "#e5e7eb"};border-radius:8px;background:${checked ? "#f5f3ff" : "#fff"};">
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
        </div>`;

  pane.innerHTML = `
    <div style="margin-bottom:12px;">
      <button type="button" id="obPkgCancel" style="${STYLE.btnGhost}">← Back</button>
    </div>
    <div style="${STYLE.formBox}" id="obPkgForm">
      <div style="font-size:14px;font-weight:700;color:#5b21b6;margin-bottom:4px;">
        ${state.view === "pkg_edit" ? "Edit package" : "Create package"}
      </div>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280;line-height:1.45;">
        Check items to include them. Uncheck to remove. You can also create a new item here.
      </p>
      <label style="${STYLE.label}">Package name</label>
      <input id="obPkgName" type="text" value="${_esc(d.name)}" placeholder="e.g. New Employee" style="${STYLE.input};margin-bottom:10px;" />
      <label style="${STYLE.label}">Short description (optional)</label>
      <textarea id="obPkgDesc" rows="2" style="${STYLE.input};margin-bottom:14px;">${_esc(d.description)}</textarea>
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
        <div style="font-size:13px;font-weight:700;color:#111827;">Items in this package (${selectedCount})</div>
        <button type="button" id="obPkgNewItem" onclick="window.ffOnboardingAddItem&&window.ffOnboardingAddItem()" style="${STYLE.btnSmall}">+ Add item</button>
      </div>
      ${itemsBlock}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;flex-wrap:wrap;">
        <button type="button" id="obPkgCancel2" style="${STYLE.btnGhost}">Cancel</button>
        <button type="button" id="obPkgSave" style="${STYLE.btnPrimary}">${
          state.view === "pkg_edit" ? "Save Package" : "Create Package"
        }</button>
      </div>
    </div>
  `;

  const form = document.getElementById("obPkgForm") || pane;

  const persistForm = () => {
    d.name = String((document.getElementById("obPkgName") || {}).value || "").trim();
    d.description = String((document.getElementById("obPkgDesc") || {}).value || "").trim();
    d.audience = ffNormalizeOnboardingAudience({});
    _syncPkgItemsFromForm(form);
  };

  const leaveWizard = () => {
    if (!window.confirm("Leave package setup? Unsaved changes will be lost.")) return;
    state.view = null;
    state.editingPackageId = null;
    state.pkgDraft = null;
    requestRender();
  };
  document.getElementById("obPkgCancel")?.addEventListener("click", leaveWizard);
  document.getElementById("obPkgCancel2")?.addEventListener("click", leaveWizard);

  const startInlineItem = () => {
    persistForm();
    state.returnToPackage = true;
    state.view = "item_create";
    state.editingItemId = null;
    _resetItemDraft(null);
    requestRender();
  };
  document.getElementById("obPkgNewItem")?.addEventListener("click", startInlineItem);
  document.getElementById("obPkgNewItemEmpty")?.addEventListener("click", startInlineItem);

  document.getElementById("obPkgSave")?.addEventListener("click", async () => {
    persistForm();
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
      if (state.view === "pkg_edit" && state.editingPackageId) {
        if (typeof window.ffUpdateOnboardingPackage === "function") {
          await window.ffUpdateOnboardingPackage(state.editingPackageId, payload);
        } else {
          await _savePackageViaCallable(state.editingPackageId, payload);
        }
        _toast("Package updated", "success");
      } else if (typeof window.ffCreateOnboardingPackage === "function") {
        await window.ffCreateOnboardingPackage(payload);
        _toast("Package created", "success");
      } else {
        await _savePackageViaCallable(null, payload);
        _toast("Package created", "success");
      }
      if (typeof window.ffInvalidateOnboardingCatalogCache === "function") {
        window.ffInvalidateOnboardingCatalogCache();
      }
      state.view = null;
      state.editingPackageId = null;
      state.pkgDraft = null;
      state.tab = "packages";
      requestRender();
    } catch (e) {
      _toast(e.message || "Save failed", "error");
    }
  });
}

