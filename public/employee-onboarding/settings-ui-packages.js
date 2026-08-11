/**
 * Employee Onboarding Settings UI — Packages list + create/edit wizard.
 */

import {
  ffNormalizeOnboardingAudience,
  ffDescribeOnboardingAudience,
} from "./audience.js?v=20260808_onboarding_hardening";
import {
  STYLE,
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
} from "./settings-ui-shared.js?v=20260810_od_split_v1";

export async function _renderPackagesList() {
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
    state.view = "pkg_create";
    state.editingPackageId = null;
    _resetPkgDraft(null);
    requestRender();
  };
  document.getElementById("obCreatePkg")?.addEventListener("click", startCreate);
  document.getElementById("obCreatePkgEmpty")?.addEventListener("click", startCreate);

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
        await window.ffDeleteOnboardingPackage(id);
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
        ${state.view === "pkg_edit" ? "Edit package" : "Create package"}
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
                state.view === "pkg_edit" ? "Save Package" : "Create Package"
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
    state.view = null;
    state.editingPackageId = null;
    state.pkgDraft = null;
    requestRender();
  });

  document.getElementById("obPkgPrev")?.addEventListener("click", () => {
    if (step === "items") _syncPkgItemsFromForm(form);
    if (step === "review") {
      /* no-op */
    }
    if (step === "basics") persistBasics();
    d.step = steps[Math.max(0, stepIdx - 1)];
    requestRender();
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
    requestRender();
  });

  const startInlineItem = () => {
    if (step === "basics") persistBasics();
    if (step === "items") _syncPkgItemsFromForm(form);
    state.returnToPackage = true;
    state.view = "item_create";
    state.editingItemId = null;
    _resetItemDraft(null);
    requestRender();
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
      if (state.view === "pkg_edit" && state.editingPackageId) {
        await window.ffUpdateOnboardingPackage(state.editingPackageId, payload);
        _toast("Package updated", "success");
      } else {
        await window.ffCreateOnboardingPackage(payload);
        _toast("Package created", "success");
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

