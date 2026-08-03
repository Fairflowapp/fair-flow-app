/**
 * staff-writeups.js — Employee Write-Ups tab orchestrator (Phase 1: incidents).
 *
 * Mounted by the Staff Members profile (index.html) between "Earnings Rules"
 * and "Documents". Confidential: the tab is only shown to the owner, admins,
 * and staff with permissions.writeups_manage — and Firestore/Storage rules
 * enforce the same access independently of the UI.
 *
 * Data: salons/{salonId}/staff/{staffId}/writeupIncidents/{incidentId}
 */
import { wuState } from "./staff-writeups-state.js?v=20260802_writeups_phase2b";
import {
  ensureIncidentsSubscription,
  unsubscribeIncidents,
  loadWriteupSettings,
} from "./staff-writeups-cloud.js?v=20260802_writeups_phase2b";
import {
  ensureFormalSubscription,
  unsubscribeFormal,
} from "./staff-writeups-formal-cloud.js?v=20260802_writeups_phase2b";
import {
  renderWriteupsIntoContainer,
  renderLoadingHtml,
  renderPermissionDeniedHtml,
} from "./staff-writeups-render.js?v=20260802_writeups_phase2b";
import {
  initStaffWriteupsUi,
  handleWriteupsActionClick,
} from "./staff-writeups-ui.js?v=20260802_writeups_phase2b";

initStaffWriteupsUi({ rerender: renderWriteupsIntoContainer });

/**
 * Client-side visibility gate. Mirrors the Earnings Rules gate (owner/admin
 * only) plus the explicit permissions.writeups_manage flag. Managers do NOT
 * get access via role. This is UI-only — rules are the real enforcement.
 */
export function ffCurrentUserCanManageWriteups() {
  try {
    if (typeof window.ffCurrentUserCanSeeWriteupsTab === "function") {
      return window.ffCurrentUserCanSeeWriteupsTab() === true;
    }
  } catch (_) {}
  return false;
}

export function ffStaffWriteupsUnmount() {
  unsubscribeIncidents();
  unsubscribeFormal();
  wuState._mountCtx = { salonId: "", staffId: "" };
  wuState._lastIncidentList = null;
  wuState._loadError = "";
  wuState._statusFilter = "all";
  if (wuState._boundContainer && wuState._onActionClick) {
    try {
      wuState._boundContainer.removeEventListener("click", wuState._onActionClick);
    } catch (_) {}
  }
  wuState._boundContainer = null;
  wuState._onActionClick = null;
}

export function ffMountStaffWriteups(container, salonId, staffId) {
  if (!container) return;
  const sid = String(salonId || "").trim();
  const stid = String(staffId || "").trim();
  if (!sid || !stid) {
    container.innerHTML = `<p style="margin:0;font-size:13px;color:#b91c1c;">Missing salon or staff.</p>`;
    return;
  }

  if (!ffCurrentUserCanManageWriteups()) {
    container.innerHTML = renderPermissionDeniedHtml();
    return;
  }

  wuState._mountCtx = { salonId: sid, staffId: stid };

  if (wuState._boundContainer && wuState._boundContainer !== container && wuState._onActionClick) {
    try {
      wuState._boundContainer.removeEventListener("click", wuState._onActionClick);
    } catch (_) {}
    wuState._boundContainer = null;
  }
  if (!wuState._onActionClick) {
    wuState._onActionClick = (e) => handleWriteupsActionClick(e);
  }
  if (wuState._boundContainer !== container) {
    container.addEventListener("click", wuState._onActionClick);
    wuState._boundContainer = container;
  }

  // Settings (threshold / window) load once per salon; missing doc = defaults.
  void loadWriteupSettings(sid).then(() => {
    if (wuState._mountedKey === `${sid}::${stid}` && wuState._lastIncidentList !== null) {
      renderWriteupsIntoContainer(container);
    }
  });

  const key = `${sid}::${stid}`;
  if (wuState._mountedKey !== key) {
    container.innerHTML = renderLoadingHtml();
    ensureIncidentsSubscription(sid, stid, () => {
      if (wuState._boundContainer) renderWriteupsIntoContainer(wuState._boundContainer);
    });
    // Phase 2: formal write-ups list (drafts + sent) for the same employee.
    ensureFormalSubscription(sid, stid, () => {
      if (wuState._boundContainer) renderWriteupsIntoContainer(wuState._boundContainer);
    });
    return;
  }
  renderWriteupsIntoContainer(container);
}

if (typeof window !== "undefined") {
  window.ffMountStaffWriteups = ffMountStaffWriteups;
  window.ffStaffWriteupsUnmount = ffStaffWriteupsUnmount;
  window.ffCurrentUserCanManageWriteups = ffCurrentUserCanManageWriteups;
}
