/**
 * Employee Onboarding Settings UI — manager-facing Items + Packages only.
 * Presentation layer over existing templates / packages / e-sign library APIs.
 * Host: #userProfileCardOnboarding → #ffOnboardingSettingsRoot
 */

import {
  STYLE,
  state,
  bindRequestRender,
  requestRender,
  _root,
} from "./settings-ui-shared.js?v=20260810_od_split_v1";
import {
  _renderItemsList,
  _renderItemCreate,
  _renderItemEdit,
} from "./settings-ui-items.js?v=20260810_od_split_v1";
import {
  _renderPackagesList,
  _renderPackageWizard,
} from "./settings-ui-packages.js?v=20260810_od_split_v1";

function _renderShell() {
  const root = _root();
  if (!root) return;
  root.innerHTML = `
    <div style="display:flex;gap:4px;border-bottom:1px solid #e5e7eb;margin-bottom:14px;flex-wrap:wrap;align-items:center;">
      <button type="button" data-ob-tab="items" style="${state.tab === "items" ? STYLE.tabActive : STYLE.tabIdle}">Items</button>
      <button type="button" data-ob-tab="packages" style="${state.tab === "packages" ? STYLE.tabActive : STYLE.tabIdle}">Packages</button>
    </div>
    <div id="ffOnboardingSettingsPane"></div>
  `;
  root.querySelectorAll("[data-ob-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (state.view && !window.confirm("Leave this screen? Unsaved changes will be lost.")) return;
      state.tab = btn.getAttribute("data-ob-tab") || "items";
      state.view = null;
      state.editingItemId = null;
      state.editingPackageId = null;
      state.itemDraft = null;
      state.pkgDraft = null;
      state.returnToPackage = false;
      requestRender();
    });
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
  if (state.view === "item_create") {
    await _renderItemCreate();
    return;
  }
  if (state.view === "item_edit") {
    await _renderItemEdit();
    return;
  }
  if (state.view === "pkg_create" || state.view === "pkg_edit") {
    await _renderPackageWizard();
    return;
  }
  if (state.tab === "items") await _renderItemsList();
  else await _renderPackagesList();
}

export function initOnboardingSettingsUI() {
  if (state.bound) return;
  state.bound = true;
  const refreshIfVisible = () => {
    if (state.view) return;
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
    if (!state.view && state.tab === "items") refreshIfVisible();
    else if (state.view === "item_create" || state.view === "item_edit") refreshIfVisible();
  });
}

bindRequestRender(renderOnboardingSettingsUI);

if (typeof window !== "undefined") {
  window.renderOnboardingSettingsUI = renderOnboardingSettingsUI;
  window.ffRenderOnboardingSettingsUI = renderOnboardingSettingsUI;
  window.initOnboardingSettingsUI = initOnboardingSettingsUI;
  initOnboardingSettingsUI();
}
