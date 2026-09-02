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
  consumeOnboardingNav,
  _root,
  _toast,
} from "./settings-ui-shared.js?v=20260902_set_iso";
import {
  _renderItemsList,
  _renderItemCreate,
  _renderItemEdit,
} from "./settings-ui-items.js?v=20260816_od_open";
import {
  _renderPackagesList,
  _renderPackageWizard,
} from "./settings-ui-packages.js?v=20260816_od_open";

/** Drop stale async renders that lost a race with a newer requestRender(). */
let _renderGen = 0;
let _fallbackCache = { templates: null, packages: null };
const _fsP = import("https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js");

function _salonId() {
  try {
    return String((typeof window !== "undefined" && window.currentSalonId) || "").trim();
  } catch (_) {
    return "";
  }
}

function _db() {
  try {
    return (typeof window !== "undefined" && (window.ffDb || window.db)) || null;
  } catch (_) {
    return null;
  }
}

async function _waitForDb(ms) {
  if (_db() && _salonId()) return;
  const start = Date.now();
  while (!_db() || !_salonId()) {
    if (Date.now() - start > (ms || 400)) break;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function _fallbackCatalog() {
  if (_fallbackCache.templates && _fallbackCache.packages) return _fallbackCache;
  await _waitForDb(400);
  const db = _db();
  const sid = _salonId();
  if (!db || !sid) return { templates: [], packages: [] };
  const { collection, getDocs } = await _fsP;
  const [ts, ps] = await Promise.all([
    getDocs(collection(db, `salons/${sid}/onboardingTaskTemplates`)),
    getDocs(collection(db, `salons/${sid}/onboardingPackages`)),
  ]);
  const templates = ts.docs.map((d) => ({ ...d.data(), id: d.id }));
  const packages = ps.docs.map((d) => ({ ...d.data(), id: d.id }));
  _fallbackCache = { templates, packages };
  return _fallbackCache;
}

function _filterOnboardingFallback(rows) {
  if (typeof window.ffFilterOnboardingByLocation === "function") {
    return window.ffFilterOnboardingByLocation(rows);
  }
  return Array.isArray(rows) ? rows.slice() : [];
}

export function ffInvalidateOnboardingCatalogCache() {
  _fallbackCache = { templates: null, packages: null };
}

function _installCatalogShims() {
  if (typeof window.ffGetOnboardingTaskTemplates !== "function") {
    window.ffGetOnboardingTaskTemplates = async () => {
      if (_fallbackCache.templates != null) return _filterOnboardingFallback(_fallbackCache.templates);
      const cat = await _fallbackCatalog();
      return _filterOnboardingFallback(cat.templates);
    };
  }
  if (typeof window.ffGetOnboardingPackages !== "function") {
    window.ffGetOnboardingPackages = async () => {
      if (_fallbackCache.packages != null) return _filterOnboardingFallback(_fallbackCache.packages);
      const cat = await _fallbackCatalog();
      return _filterOnboardingFallback(cat.packages);
    };
  }
}

function _syncTabs() {
  const root = _root();
  if (!root) return;
  root.querySelectorAll("[data-ob-tab]").forEach((btn) => {
    const tab = btn.getAttribute("data-ob-tab");
    btn.setAttribute("style", tab === state.tab ? STYLE.tabActive : STYLE.tabIdle);
  });
}

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
  consumeOnboardingNav();
  const gen = ++_renderGen;
  const root = _root();
  if (!root) return;
  if (!document.getElementById("ffOnboardingSettingsPane")) {
    _renderShell();
  } else {
    _syncTabs();
    const leftover = document.getElementById("ffOdRetentionCard");
    if (leftover) leftover.remove();
  }
  const pane0 = document.getElementById("ffOnboardingSettingsPane");
  if (pane0 && !pane0.innerHTML.trim() && !_fallbackCache.templates) {
    pane0.innerHTML =
      '<div style="padding:16px;color:#6b7280;font-size:13px;">Loading…</div>';
  }
  _installCatalogShims();
  try {
    await Promise.race([
      _fallbackCatalog(),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  } catch (e) {
    console.warn("[OnboardingSettingsUI] catalog load failed", e);
  }
  if (typeof window.ffEnsureOnboardingSettingsSubscribed === "function") {
    void window.ffEnsureOnboardingSettingsSubscribed();
  }
  if (gen !== _renderGen) return;
  consumeOnboardingNav();
  const paneNow = document.getElementById("ffOnboardingSettingsPane");
  if (!paneNow || !paneNow.isConnected) return;
  try {
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
  } catch (e) {
    if (gen !== _renderGen) return;
    console.error("[OnboardingSettingsUI] render failed", e);
    const pane = document.getElementById("ffOnboardingSettingsPane");
    if (pane && pane.isConnected) {
      pane.innerHTML = `<div style="padding:16px;border:1px dashed #fecaca;border-radius:10px;background:#fef2f2;color:#991b1b;font-size:13px;">
        Could not load this screen. Try again.
      </div>`;
    }
    _toast((e && e.message) || "Could not load Onboarding settings", "error");
  }
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
  document.addEventListener("ff-active-location-changed", () => {
    ffInvalidateOnboardingCatalogCache();
    refreshIfVisible();
  });
  document.addEventListener("ff-onboarding-esign-docs-updated", () => {
    // Refresh list so unfinished PDF drafts appear under Items.
    if (!state.view && state.tab === "items") refreshIfVisible();
    else if (state.view === "item_create" || state.view === "item_edit") refreshIfVisible();
  });
  document.addEventListener("click", (e) => {
    const t = e.target && e.target.closest
      ? e.target.closest("#obAddItem, #obAddItemEmpty, #obPkgNewItem, #obPkgNewItemEmpty, [data-ob-kind]")
      : null;
    if (!t) return;
    const root = _root();
    if (!root || !root.contains(t)) return;
    e.preventDefault();
    const kind = t.getAttribute("data-ob-kind");
    if (kind) {
      if (kind === "sign") {
        import("./esign-library-cloud.js?v=20260825_od_iospdf").catch(() => {});
      }
      if (typeof window.ffOnboardingPickItemKind === "function") {
        window.ffOnboardingPickItemKind(kind);
      }
      return;
    }
    if (typeof window.ffOnboardingAddItem === "function") {
      window.ffOnboardingAddItem();
    }
  }, true);
}

bindRequestRender(renderOnboardingSettingsUI);

if (typeof window !== "undefined") {
  window.renderOnboardingSettingsUI = renderOnboardingSettingsUI;
  window.ffRenderOnboardingSettingsUI = renderOnboardingSettingsUI;
  window.initOnboardingSettingsUI = initOnboardingSettingsUI;
  window.ffInvalidateOnboardingCatalogCache = ffInvalidateOnboardingCatalogCache;
  initOnboardingSettingsUI();
  try {
    const card = document.getElementById("userProfileCardOnboarding");
    if (card && card.style.display === "block") {
      renderOnboardingSettingsUI();
    }
  } catch (_) {}
}
