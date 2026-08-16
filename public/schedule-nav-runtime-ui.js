// schedule-nav-runtime-ui.js
// Schedule UI runtime — week filter, navigation, event binding, window hooks.
// Extracted verbatim from schedule-nav-runtime.js (nav-runtime split T2).

import { refreshSchedulePreview } from "./schedule-nav-runtime-preview.js?v=20260816_cell_notes7";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  renderScheduleBoard,
  renderScheduleSummary,
  setSchedulePreviewMode,
  setSchedulePreviewView,
} from "./schedule-render.js?v=20260816_cell_notes7";
import {
  discardSavedScheduleWeekDraftAndReload,
  notifyStaffScheduleChanges,
  saveScheduleWeekDraftToCloud,
} from "./schedule-draft.js?v=20260816_cell_notes7";
import {
  canViewScheduleBoardForCurrentWeek,
  ensureSchedulePublishListener,
  teardownSchedulePublishListener,
  toggleScheduleWeekPublished,
  updateSchedulePublishToggleUi,
} from "./schedule-cloud.js?v=20260702_schedule_cloud";
import {
  addDays,
  getScheduleStaffKey,
  getStartOfWeek,
  isTechnicianScheduleStaff,
  syncScheduleWeekFilterUi,
} from "./schedule-format.js?v=20260806_sched_12h_picker";
import {
  ffScheduleAppToast,
  submitScheduleWeekAck,
  teardownScheduleAckListener,
  teardownScheduleChangePingListener,
} from "./schedule-ack.js?v=20260702_schedule_ack";
import { getScheduleAccessContext } from "./schedule-shift-edit.js?v=20260816_cell_notes7";
import {
  renderScheduleCrossLocationConflictBanner,
  renderScheduleViewTabs,
  scheduleInboxUserIsFirestoreManager,
} from "./schedule-nav-core.js?v=20260703_schedule_nav_wiring_fix";

function applyScheduleWeekFilter() {
  const filterSelect = document.getElementById("scheduleWeekFilter");
  const customDateInput = document.getElementById("scheduleCustomWeekDate");
  const mode = filterSelect?.value || "current";

  if (mode === "previous") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), -7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "next") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 7);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in2") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 14);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in3") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 21);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "in4") {
    scheduleState.schedulePreviewWeekStart = addDays(getStartOfWeek(new Date()), 28);
    syncScheduleWeekFilterUi();
    refreshSchedulePreview();
    return;
  }

  if (mode === "custom") {
    syncScheduleWeekFilterUi();
    const dateValue = customDateInput?.value;
    if (!dateValue) return;
    scheduleState.schedulePreviewWeekStart = getStartOfWeek(new Date(`${dateValue}T00:00:00`));
    refreshSchedulePreview();
    return;
  }

  scheduleState.schedulePreviewWeekStart = getStartOfWeek(new Date());
  syncScheduleWeekFilterUi();
  refreshSchedulePreview();
}

function hideScheduleScreen() {
  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "none";
  const btn = document.getElementById("scheduleBtn");
  if (btn) btn.classList.remove("active");
  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();
}

export async function goToSchedule() {
  const schedCtx =
    typeof window.ffGetSchedulePermissionContext === "function"
      ? window.ffGetSchedulePermissionContext()
      : getScheduleAccessContext();
  if (schedCtx.noAccess) {
    ffScheduleAppToast("You do not have permission to open Schedule.", 4000);
    return;
  }

  try {
    if (typeof window.ffDismissQueueBootSkeleton === "function") window.ffDismissQueueBootSkeleton();
  } catch (_) {}

  if (typeof window.ffCloseGlobalBlockingOverlays === "function") {
    try {
      window.ffCloseGlobalBlockingOverlays();
    } catch (e) {}
  }
  if (typeof window.closeStaffMembersModal === "function") {
    window.closeStaffMembersModal();
  }
  const screenIdsToHide = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "ticketsScreen",
    "trainingScreen",
    "userProfileScreen",
    "manageQueueScreen",
    "timeClockScreen",
    "dashboardScreen",
    "queueAnalyticsScreen",
    "ticketsAnalyticsScreen",
    "timeAnalyticsScreen",
    "tasksAnalyticsScreen",
  ];
  screenIdsToHide.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const ownerView = document.getElementById("owner-view");
  const joinBar = document.getElementById("joinBar");
  const queueControls = document.getElementById("queueControls");
  const wrap = document.querySelector(".wrap");
  if (ownerView) ownerView.style.display = "none";
  if (joinBar) joinBar.style.display = "none";
  if (queueControls) queueControls.style.display = "none";
  if (wrap) wrap.style.display = "none";

  const screen = document.getElementById("scheduleScreen");
  if (screen) screen.style.display = "flex";

  document.querySelectorAll(".btn-pill").forEach((button) => button.classList.remove("active"));
  const scheduleBtn = document.getElementById("scheduleBtn");
  if (scheduleBtn) scheduleBtn.classList.add("active");

  await refreshSchedulePreview();

  if (typeof window.ffUpdateMobileHeaderTitle === "function") window.ffUpdateMobileHeaderTitle();

  if (Array.isArray(scheduleState.schedulePreviewState.staffList) && scheduleState.schedulePreviewState.staffList.length) {
    const sid = String(
      typeof window !== "undefined" && window.__ff_authedStaffId
        ? window.__ff_authedStaffId
        : (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") || "",
    ).trim();
    const me = scheduleState.schedulePreviewState.staffList.find((s) => getScheduleStaffKey(s) === sid);
    const shouldFocusOwnSchedule =
      schedCtx.viewOwnOnly ||
      (me && isTechnicianScheduleStaff(me) && !scheduleInboxUserIsFirestoreManager());
    if (me && shouldFocusOwnSchedule && canViewScheduleBoardForCurrentWeek()) {
      if (schedCtx.viewOwnOnly) scheduleState.schedulePreviewMode = "my_shifts";
      scheduleState.schedulePreviewView = isTechnicianScheduleStaff(me) ? "technicians" : "management";
      renderScheduleViewTabs();
      renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
    }
  }
}

function setScheduleMobileControlsCollapsed(collapsed) {
  const screen = document.getElementById("scheduleScreen");
  const btn = document.getElementById("scheduleMobileControlsToggle");
  const icon = document.getElementById("scheduleMobileControlsToggleIcon");
  if (!screen || !btn) return;
  screen.classList.toggle("ff-schedule-controls-collapsed", collapsed === true);
  btn.setAttribute("aria-expanded", collapsed === true ? "false" : "true");
  btn.setAttribute("aria-label", collapsed === true ? "Show schedule controls" : "Collapse schedule controls");
  btn.setAttribute("title", collapsed === true ? "Show controls" : "Collapse controls");
  if (icon) icon.textContent = collapsed === true ? "\u25BC" : "\u25B2";
}

function bindScheduleUi() {
  const scheduleOpenSettingsBtn = document.getElementById("scheduleScreenOpenSettingsBtn");
  if (scheduleOpenSettingsBtn && !scheduleOpenSettingsBtn.__ffOpenScheduleSettingsBound) {
    scheduleOpenSettingsBtn.__ffOpenScheduleSettingsBound = true;
    scheduleOpenSettingsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // Close the board first so goToUserProfile does not use ff-overlay-from-schedule (same layout as Settings → Schedule from the menu).
      hideScheduleScreen();
      if (typeof window !== "undefined" && typeof window.goToUserProfile === "function") {
        window.goToUserProfile("schedule");
      }
    });
  }

  const scheduleMobileControlsToggle = document.getElementById("scheduleMobileControlsToggle");
  if (scheduleMobileControlsToggle && !scheduleMobileControlsToggle.__ffScheduleMobileControlsBound) {
    scheduleMobileControlsToggle.__ffScheduleMobileControlsBound = true;
    scheduleMobileControlsToggle.addEventListener("click", (e) => {
      e.preventDefault();
      const screen = document.getElementById("scheduleScreen");
      const collapsed = !(screen && screen.classList.contains("ff-schedule-controls-collapsed"));
      setScheduleMobileControlsCollapsed(collapsed);
    });
  }

  document.getElementById("scheduleBtn")?.addEventListener("click", goToSchedule);
  document.getElementById("scheduleViewMyShiftsBtn")?.addEventListener("click", () => setSchedulePreviewMode("my_shifts"));
  document.getElementById("scheduleViewBuildScheduleBtn")?.addEventListener("click", () => setSchedulePreviewMode("build"));
  document.getElementById("scheduleViewManagementBtn")?.addEventListener("click", () => setSchedulePreviewView("management"));
  document.getElementById("scheduleViewTechniciansBtn")?.addEventListener("click", () => setSchedulePreviewView("technicians"));
  document.getElementById("scheduleWeekFilter")?.addEventListener("change", () => {
    syncScheduleWeekFilterUi();
    const mode = document.getElementById("scheduleWeekFilter")?.value || "next";
    if (mode !== "custom") applyScheduleWeekFilter();
  });
  document.getElementById("scheduleApplyCustomWeekBtn")?.addEventListener("click", applyScheduleWeekFilter);

  const schedulePublishToggleBtn = document.getElementById("schedulePublishToggleBtn");
  if (schedulePublishToggleBtn && !schedulePublishToggleBtn.__ffSchedulePublishBound) {
    schedulePublishToggleBtn.__ffSchedulePublishBound = true;
    schedulePublishToggleBtn.addEventListener("click", () => {
      toggleScheduleWeekPublished();
    });
  }

  const scheduleSaveDraftBtn = document.getElementById("scheduleSaveDraftBtn");
  if (scheduleSaveDraftBtn && !scheduleSaveDraftBtn.__ffScheduleSaveDraftBound) {
    scheduleSaveDraftBtn.__ffScheduleSaveDraftBound = true;
    scheduleSaveDraftBtn.addEventListener("click", () => {
      saveScheduleWeekDraftToCloud();
    });
  }

  const scheduleNotifyChangesBtn = document.getElementById("scheduleNotifyChangesBtn");
  if (scheduleNotifyChangesBtn && !scheduleNotifyChangesBtn.__ffScheduleNotifyChangesBound) {
    scheduleNotifyChangesBtn.__ffScheduleNotifyChangesBound = true;
    scheduleNotifyChangesBtn.addEventListener("click", () => {
      notifyStaffScheduleChanges();
    });
  }

  const scheduleDiscardSavedDraftBtn = document.getElementById("scheduleDiscardSavedDraftBtn");
  if (scheduleDiscardSavedDraftBtn && !scheduleDiscardSavedDraftBtn.__ffScheduleDiscardSavedDraftBound) {
    scheduleDiscardSavedDraftBtn.__ffScheduleDiscardSavedDraftBound = true;
    scheduleDiscardSavedDraftBtn.addEventListener("click", () => {
      discardSavedScheduleWeekDraftAndReload();
    });
  }

  ["queueBtn", "ticketsBtn", "tasksBtn", "chatBtn", "inboxBtn", "mediaBtn", "appsBtn", "trainingBtn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn && !btn.__ffScheduleHideBound) {
      btn.__ffScheduleHideBound = true;
      btn.addEventListener("click", () => {
        if (id !== "scheduleBtn") hideScheduleScreen();
      }, { capture: true });
    }
  });

  if (typeof window !== "undefined" && !window.__ffSchedulePublishKickStarted) {
    window.__ffSchedulePublishKickStarted = true;
    let tries = 0;
    const kickId = setInterval(() => {
      tries += 1;
      if (String(window.currentSalonId || "").trim()) {
        ensureSchedulePublishListener();
        clearInterval(kickId);
      } else if (tries > 80) {
        clearInterval(kickId);
      }
    }, 400);
  }

  // Multi-location isolation: when the user switches branches, every cloud
  // listener is tied to the old branch's doc id → tear them down, reset the
  // caches, and re-bind against the new location-specific paths. If the
  // Schedule screen is currently visible we also trigger a full preview
  // refresh so the grid doesn't show stale cross-branch data.
  if (typeof document !== "undefined" && !document.__ffScheduleLocChangeBound) {
    document.__ffScheduleLocChangeBound = true;
    const handler = () => {
      try {
        teardownSchedulePublishListener();
        teardownScheduleAckListener();
        teardownScheduleChangePingListener();
        scheduleState.schedulePublishedMap = {};
        scheduleState.scheduleWeekAckSeenAtByStaffId = {};
        scheduleState.scheduleWeekPingAtByStaffId = {};
        scheduleState.lastSeenWeekDraftSnapshotJsonByWeek = {};
        scheduleState.schedulePreviewState = {
          draft: null,
          validation: null,
          weekRange: null,
          staffList: [],
          requests: [],
          businessHours: undefined,
          standByByDate: {},
        };
        if (typeof window !== "undefined") {
          window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
        }
        ensureSchedulePublishListener();
        const screen = document.getElementById("scheduleScreen");
        if (screen && screen.style.display !== "none" && typeof refreshSchedulePreview === "function") {
          void refreshSchedulePreview();
        }
      } catch (e) {
        console.warn("[ScheduleUI] location change handler failed", e);
      }
    };
    document.addEventListener("ff-active-location-changed", handler);
    window.addEventListener("ff-active-location-changed", handler);
    const settingsUpdatedHandler = () => {
      const screen = document.getElementById("scheduleScreen");
      if (screen && screen.style.display !== "none") {
        renderScheduleCrossLocationConflictBanner();
        renderScheduleBoard(scheduleState.schedulePreviewState.draft, scheduleState.schedulePreviewState.validation, scheduleState.schedulePreviewState.staffList);
      }
    };
    document.addEventListener("ff-schedule-settings-changed", settingsUpdatedHandler);
    window.addEventListener("ff-schedule-settings-changed", settingsUpdatedHandler);
    // When the owner edits a staff member's Locations tab we also need to
    // re-evaluate who belongs in the current branch's grid.
    const staffUpdatedHandler = () => {
      const screen = document.getElementById("scheduleScreen");
      if (screen && screen.style.display !== "none" && typeof refreshSchedulePreview === "function") {
        void refreshSchedulePreview();
      }
    };
    document.addEventListener("ff-staff-cloud-updated", staffUpdatedHandler);
    window.addEventListener("ff-staff-cloud-updated", staffUpdatedHandler);
  }
}

if (typeof window !== "undefined") {
  window.ffScheduleRefreshPermissionChrome = () => {
    updateSchedulePublishToggleUi();
    renderScheduleSummary(
      scheduleState.schedulePreviewState?.validation,
      scheduleState.schedulePreviewState?.validation?.days || [],
    );
  };
  window.goToSchedule = goToSchedule;
  window.ffSchedulePreviewState = scheduleState.schedulePreviewState;
  window.refreshSchedulePreview = refreshSchedulePreview;
  window.setSchedulePreviewView = setSchedulePreviewView;
  window.setSchedulePreviewMode = setSchedulePreviewMode;
  window.toggleScheduleWeekPublished = toggleScheduleWeekPublished;
  window.submitScheduleWeekAck = submitScheduleWeekAck;
  window.notifyStaffScheduleChanges = notifyStaffScheduleChanges;
  window.ffDiscardSavedScheduleWeekDraft = discardSavedScheduleWeekDraftAndReload;

  // Console utility: list duplicate staff members by name. Useful for finding
  // accidentally-duplicated profiles (e.g. two "Test Multi" Admins) that cause
  // doubled rows in the Schedule / Staff sidebar. Usage: ffListDuplicateStaff()
  // Merge the unique data from the "archive" staff record into the "keep"
  // staff record (only fills blanks on keep; never overwrites existing data),
  // then archives the duplicate. This is the safe way to resolve duplicated
  // staff profiles that share the same person but drift on some fields.
  //
  // Usage: await ffMergeAndArchiveDuplicateStaff("KEEP_ID", "ARCHIVE_ID")
  window.ffMergeAndArchiveDuplicateStaff = async function ffMergeAndArchiveDuplicateStaff(keepId, archiveId) {
    const kId = String(keepId || "").trim();
    const aId = String(archiveId || "").trim();
    if (!kId || !aId || kId === aId) {
      console.warn("[StaffDedupe] provide two distinct IDs: keepId, archiveId");
      return false;
    }
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
    const list = Array.isArray(store?.staff) ? store.staff : [];
    const keepIdx = list.findIndex((s) => String(s?.id || "") === kId);
    const archIdx = list.findIndex((s) => String(s?.id || "") === aId);
    if (keepIdx === -1) { console.warn("[StaffDedupe] keepId not found:", kId); return false; }
    if (archIdx === -1) { console.warn("[StaffDedupe] archiveId not found:", aId); return false; }
    const keep = list[keepIdx];
    const arch = list[archIdx];

    // Only fill blanks on keep — never clobber existing data.
    const blank = (v) => v === undefined || v === null ||
      (typeof v === "string" && v.trim() === "") ||
      (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);

    const merged = { ...keep };
    const fieldsToCopy = [
      "allowedLocationIds", "primaryLocationId", "locationScheduleAvailability",
      "defaultSchedule", "constraints", "weeklyHoursTarget", "employmentType",
      "technicianTypes", "permissions", "buttonColor", "color", "fontColor", "fcolor",
      "managerType", "phone", "birthday", "pin",
    ];
    const copied = [];
    fieldsToCopy.forEach((f) => {
      if (blank(merged[f]) && !blank(arch[f])) {
        merged[f] = arch[f];
        copied.push(f);
      }
    });
    merged.updatedAtMs = Date.now();

    list[keepIdx] = merged;
    list[archIdx] = { ...arch, isArchived: true, updatedAtMs: Date.now() };

    if (typeof window.ffSaveStaffStore === "function") window.ffSaveStaffStore(store);
    try { document.dispatchEvent(new CustomEvent("ff-staff-cloud-updated")); } catch (_) {}

    console.log(`[StaffDedupe] Merged ${copied.length ? copied.join(", ") : "(nothing — keep already had all fields)"} from ${aId} into ${kId}.`);
    console.log(`[StaffDedupe] Archived ${aId}. Toggle "Show Archived Staff" in the sidebar to view archived rows.`);
    return true;
  };

  // Archive a staff record by Firestore ID (safer than delete — keeps history).
  // Usage: await ffArchiveStaffById("abc123")
  window.ffArchiveStaffById = async function ffArchiveStaffById(staffId) {
    const id = String(staffId || "").trim();
    if (!id) { console.warn("[StaffDedupe] missing id"); return false; }
    try {
      const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
      const list = Array.isArray(store?.staff) ? store.staff : [];
      const idx = list.findIndex((s) => String(s?.id || "") === id);
      if (idx === -1) { console.warn("[StaffDedupe] id not found in store:", id); return false; }
      const target = list[idx];
      list[idx] = { ...target, isArchived: true, updatedAtMs: Date.now() };
      if (typeof window.ffSaveStaffStore === "function") window.ffSaveStaffStore(store);
      console.log(`[StaffDedupe] Archived "${target.name}" (${id}). Toggle 'Show Archived Staff' to view archived rows.`);
      try { document.dispatchEvent(new CustomEvent("ff-staff-cloud-updated")); } catch (_) {}
      return true;
    } catch (err) {
      console.error("[StaffDedupe] archive failed", err);
      return false;
    }
  };

  window.ffListDuplicateStaff = function ffListDuplicateStaff() {
    try {
      const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
      const list = Array.isArray(store?.staff) ? store.staff : [];
      const byName = new Map();
      list.forEach((s) => {
        if (!s || s.isArchived === true) return;
        const name = String(s.name || s.fullName || "").trim().toLowerCase();
        if (!name) return;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push(s);
      });
      const dups = [];
      byName.forEach((arr, name) => {
        if (arr.length > 1) dups.push({ name, count: arr.length, records: arr });
      });
      if (!dups.length) {
        console.log("[StaffDedupe] No duplicate staff names detected.");
        return [];
      }
      // Emit a compact comparison table per name so the user can scan
      // the rows side-by-side and pick which one to keep. The table
      // highlights the fields that usually differ between a real profile
      // and an accidentally-re-invited duplicate.
      console.log(`[StaffDedupe] Found ${dups.length} duplicated staff name${dups.length === 1 ? "" : "s"}. Scroll down for tables.`);
      dups.forEach((d) => {
        const rows = d.records.map((r) => {
          const perLocKeys = r.locationScheduleAvailability && typeof r.locationScheduleAvailability === "object"
            ? Object.keys(r.locationScheduleAvailability).length
            : 0;
          const createdMs = typeof r.createdAt === "number" ? r.createdAt : (r.createdAt?.toMillis ? r.createdAt.toMillis() : null);
          const updatedMs = typeof r.updatedAtMs === "number" ? r.updatedAtMs : null;
          return {
            id: String(r.id || ""),
            idTail: String(r.id || "").slice(-6),
            email: String(r.email || ""),
            role: String(r.role || ""),
            allowedLocs: Array.isArray(r.allowedLocationIds) ? r.allowedLocationIds.length : 0,
            primaryLoc: String(r.primaryLocationId || ""),
            perLocSchedules: perLocKeys,
            inviteSentCount: r.invite?.sentCount || 0,
            invited: r.invited === true,
            hasPin: !!r.pin,
            created: createdMs ? new Date(createdMs).toISOString() : "",
            updated: updatedMs ? new Date(updatedMs).toISOString() : "",
          };
        });
        console.log(`── ${d.name} — ${d.count} records ──`);
        console.table(rows);
        console.log(`To archive one, copy its full id from the table above and run:`);
        console.log(`  await ffArchiveStaffById("<paste id here>")`);
      });
      return dups;
    } catch (err) {
      console.warn("[StaffDedupe] failed", err);
      return [];
    }
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindScheduleUi);
} else {
  bindScheduleUi();
}

export {
  hideScheduleScreen,
};
