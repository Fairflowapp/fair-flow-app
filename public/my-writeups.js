/**
 * my-writeups.js — employee-facing "My Write-Ups" area (Phase 2).
 *
 * Lives in My Profile (avatar menu -> My Profile). The tab button is hidden
 * unless the signed-in employee has at least one ISSUED formal write-up —
 * employees never see internal incidents, excused incidents, private notes,
 * drafts or audit history, only documents at:
 *   salons/{salonId}/staff/{ownStaffId}/writeupDocuments/{writeupId}
 * (readable by the employee themselves per firestore.rules; created only by
 * the trusted backend, immutable from every client).
 *
 * Employee actions (open / respond / acknowledge) go through the
 * writeupEmployeeAction callable so timestamps are server-authoritative and
 * audited. There is deliberately no "Decline" button — refusal outside the
 * app is recorded by an Owner/Admin on their side.
 */
import {
  collection,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import {
  wuEscapeHtml as escapeHtml,
  wuFormatWhen,
  renderIssuedDocumentHtml,
  openWriteupPrintWindow,
} from "./staff-writeups-formal-render.js?v=20260802_writeups_phase2b";
import { writeupWarningLevelLabel } from "./staff-writeups-state.js?v=20260802_writeups_phase2b";

function trimStr(v) {
  return String(v == null ? "" : v).trim();
}

function toast(msg, variant) {
  try {
    if (window.ffToast && typeof window.ffToast.show === "function") {
      window.ffToast.show(msg, { variant: variant || "info" });
      return;
    }
  } catch (_) {}
}

const state = {
  salonId: "",
  staffId: "",
  unsubDocs: null,
  unsubNotifs: null,
  /** @type {Array<Record<string, unknown>> | null} */
  docs: null,
  seenNotifIds: new Set(),
  panelBound: false,
};

function ownStaffId() {
  try {
    return trimStr(
      window.__ff_authedStaffId ||
        (typeof localStorage !== "undefined" ? localStorage.getItem("ff_authedStaffId_v1") : "") ||
        "",
    );
  } catch (_) {
    return "";
  }
}

function currentSalonId() {
  try {
    return trimStr(window.currentSalonId || "");
  } catch (_) {
    return "";
  }
}

function toDateMaybe(v) {
  try {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === "function") return v.toDate();
    return null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subscriptions (started once identity is known; silently no-op otherwise)
// ---------------------------------------------------------------------------

function stopSubscriptions() {
  [state.unsubDocs, state.unsubNotifs].forEach((u) => {
    try {
      if (typeof u === "function") u();
    } catch (_) {}
  });
  state.unsubDocs = null;
  state.unsubNotifs = null;
}

function ensureSubscriptions() {
  const salonId = currentSalonId();
  const staffId = ownStaffId();
  const user = auth && auth.currentUser;
  if (!salonId || !staffId || !user) return;
  if (state.salonId === salonId && state.staffId === staffId && state.unsubDocs) return;

  stopSubscriptions();
  state.salonId = salonId;
  state.staffId = staffId;
  state.docs = null;

  state.unsubDocs = onSnapshot(
    collection(db, "salons", salonId, "staff", staffId, "writeupDocuments"),
    (snap) => {
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      list.sort((a, b) => {
        const ta = toDateMaybe(a.sentAt)?.getTime() ?? 0;
        const tb = toDateMaybe(b.sentAt)?.getTime() ?? 0;
        return tb - ta;
      });
      state.docs = list;
      syncTabVisibility();
      renderPanelIfVisible();
      maybeConsumeDeepLink();
    },
    () => {
      // permission-denied / identity not linked — employee simply has no area.
      state.docs = [];
      syncTabVisibility();
    },
  );

  state.unsubNotifs = onSnapshot(
    query(
      collection(db, "salons", salonId, "staffPrivateNotifications"),
      where("forStaffId", "==", staffId),
    ),
    (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type !== "added") return;
        const n = ch.doc.data() || {};
        if (n.type !== "writeup_sent" || n.read === true) return;
        if (state.seenNotifIds.has(ch.doc.id)) return;
        state.seenNotifIds.add(ch.doc.id);
        toast("You have received an important document. Open My Profile → My Write-Ups.", "info");
      });
    },
    () => {},
  );
}

// ---------------------------------------------------------------------------
// My Profile tab visibility + panel rendering
// ---------------------------------------------------------------------------

function tabButton() {
  return document.getElementById("myProfileWriteupsTabBtn");
}

function panelEl() {
  return document.getElementById("myProfilePanelWriteups");
}

function syncTabVisibility() {
  const btn = tabButton();
  if (!btn) return;
  const has = Array.isArray(state.docs) && state.docs.length > 0;
  btn.style.display = has ? "block" : "none";
  const unread = has && state.docs.some((d) => !d.openedInAppAt && String(d.status || "") !== "superseded");
  let dot = btn.querySelector("[data-ff-wu-dot]");
  if (unread && !dot) {
    dot = document.createElement("span");
    dot.setAttribute("data-ff-wu-dot", "1");
    dot.style.cssText =
      "display:inline-block;width:7px;height:7px;border-radius:999px;background:#7c3aed;margin-left:6px;vertical-align:middle;";
    btn.appendChild(dot);
  } else if (!unread && dot) {
    dot.remove();
  }
}

function statusChipHtml(d) {
  let label = "Sent";
  let c = { bg: "#faf5ff", color: "#6d28d9", border: "#ddd6fe" };
  const status = String(d.status || "");
  if (status === "acknowledged" || d.acknowledgedAt) {
    label = "Acknowledged";
    c = { bg: "#f0fdf4", color: "#15803d", border: "#bbf7d0" };
  } else if (status === "superseded") {
    label = "Superseded";
    c = { bg: "#f9fafb", color: "#374151", border: "#e5e7eb" };
  } else if (!d.openedInAppAt) {
    label = "New";
    c = { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" };
  }
  return `<span style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;background:${c.bg};color:${c.color};border:1px solid ${c.border};">${escapeHtml(label)}</span>`;
}

function renderPanelIfVisible() {
  const panel = panelEl();
  if (!panel || panel.style.display === "none") return;
  renderPanel(panel);
}

function renderPanel(panel) {
  if (!panel) return;
  if (state.docs === null) {
    panel.innerHTML = `<div class="ff-myp-card ff-myp-stack"><p style="margin:0;font-size:13px;color:#6b7280;">Loading…</p></div>`;
    return;
  }
  if (!state.docs.length) {
    panel.innerHTML = `<div class="ff-myp-card ff-myp-stack"><p style="margin:0;font-size:13px;color:#6b7280;">No documents.</p></div>`;
    return;
  }
  const cards = state.docs
    .map(
      (d) => `<button type="button" data-ff-myw-open="${escapeHtml(d.id)}" style="display:block;width:100%;text-align:left;border:1px solid #e5e7eb;border-radius:10px;padding:13px 14px;background:#fff;margin-bottom:10px;cursor:pointer;font-family:inherit;">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:6px;">
          ${statusChipHtml(d)}
          <span style="font-size:12px;font-weight:700;color:#111827;">${escapeHtml(writeupWarningLevelLabel(d.warningLevel))}</span>
        </div>
        <div style="font-size:11px;color:#6b7280;">From ${escapeHtml(d.salonName || "your salon")} · ${escapeHtml(wuFormatWhen(d.sentAt))}</div>
      </button>`,
    )
    .join("");
  panel.innerHTML = `<div class="ff-myp-card ff-myp-stack">
    <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:4px;">My Write-Ups</div>
    <p style="margin:0 0 14px 0;font-size:12px;color:#6b7280;line-height:1.5;">Formal documents sent to you. Open a document to review, add your response, and acknowledge receipt.</p>
    ${cards}</div>`;

  if (!state.panelBound) {
    state.panelBound = true;
    panel.addEventListener("click", (e) => {
      const btn = e.target && e.target.closest && e.target.closest("[data-ff-myw-open]");
      if (!btn) return;
      e.preventDefault();
      openDocumentView(btn.getAttribute("data-ff-myw-open"));
    });
  }
}

// ---------------------------------------------------------------------------
// Employee actions via the backend callable
// ---------------------------------------------------------------------------

async function employeeAction(writeupId, action, response) {
  const { getFunctions, httpsCallable } = await import(
    "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js"
  );
  const fn = httpsCallable(getFunctions(undefined, "us-central1"), "writeupEmployeeAction");
  await fn({
    salonId: state.salonId,
    staffId: state.staffId,
    writeupId,
    action,
    ...(response ? { response } : {}),
  });
}

function openDocumentView(writeupId) {
  const d = (state.docs || []).find((x) => x.id === writeupId);
  if (!d) return;

  // Server-authoritative "Opened in Fair Flow" timestamp (idempotent, best effort).
  if (!d.openedInAppAt) {
    void employeeAction(writeupId, "open").catch(() => {});
  }

  const rid = `ffmyw_${Date.now()}`;
  const canRespond = !d.acknowledgedAt;
  const canAck = !d.acknowledgedAt && String(d.status || "") !== "superseded";

  const responseFormHtml = canRespond
    ? `<div style="margin-bottom:16px;">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px;">${d.employeeResponse ? "Update your response" : "Add your response (optional)"}</div>
        <textarea id="${rid}_resp" rows="3" placeholder="Your side of what happened, if you would like to add it." style="width:100%;padding:11px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:12px;color:#111827;box-sizing:border-box;font-family:inherit;resize:vertical;">${escapeHtml(d.employeeResponse || "")}</textarea>
        <button type="button" data-ff-myw-respond style="margin-top:8px;padding:8px 16px;border-radius:999px;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;font-weight:600;cursor:pointer;font-size:12px;font-family:inherit;">Save Response</button>
      </div>`
    : "";

  const ackActionsHtml = canAck
    ? `<button type="button" data-ff-myw-ack style="margin-top:10px;padding:10px 18px;border-radius:10px;border:none;background:#16a34a;color:#fff;font-weight:600;cursor:pointer;font-size:13px;font-family:inherit;">Acknowledge Receipt</button>`
    : "";

  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;min-height:100vh;min-height:100dvh;background:rgba(0,0,0,0.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow-y:auto;overflow-x:hidden;";
  overlay.innerHTML = `<div style="background:#fff;border-radius:16px;padding:20px 22px;max-width:760px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.28);margin:auto;flex-shrink:0;box-sizing:border-box;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
      <div style="font-size:16px;font-weight:700;color:#111827;">Formal Write-Up</div>
      <button type="button" data-ff-myw-print style="padding:8px 14px;border-radius:999px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-weight:600;cursor:pointer;font-size:12px;font-family:inherit;">Print / PDF</button>
    </div>
    <div style="max-height:66vh;overflow-y:auto;">${renderIssuedDocumentHtml(d, { responseFormHtml, ackActionsHtml })}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:14px;">
      <button type="button" data-ff-myw-close style="padding:10px 18px;border-radius:10px;border:1px solid #e5e7eb;background:#f9fafb;color:#374151;font-weight:600;cursor:pointer;font-size:14px;font-family:inherit;">Close</button>
    </div>
  </div>`;
  const finish = () => {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") finish();
  };
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);

  overlay.querySelector("[data-ff-myw-close]").onclick = () => finish();
  overlay.querySelector("[data-ff-myw-print]").onclick = () => {
    openWriteupPrintWindow(d);
  };

  const respondBtn = overlay.querySelector("[data-ff-myw-respond]");
  if (respondBtn) {
    respondBtn.onclick = async () => {
      const text = trimStr(overlay.querySelector(`#${rid}_resp`)?.value);
      if (!text) return toast("Write your response first.", "error");
      respondBtn.disabled = true;
      respondBtn.textContent = "Saving…";
      try {
        await employeeAction(writeupId, "respond", text);
        toast("Your response was saved.", "success");
        finish();
      } catch (err) {
        console.warn("[my-writeups] respond failed", err);
        toast(err && err.message ? err.message : "Could not save your response.", "error");
        respondBtn.disabled = false;
        respondBtn.textContent = "Save Response";
      }
    };
  }

  const ackBtn = overlay.querySelector("[data-ff-myw-ack]");
  if (ackBtn) {
    ackBtn.onclick = async () => {
      ackBtn.disabled = true;
      ackBtn.textContent = "Acknowledging…";
      try {
        await employeeAction(writeupId, "acknowledge");
        toast("Receipt acknowledged.", "success");
        finish();
      } catch (err) {
        console.warn("[my-writeups] acknowledge failed", err);
        toast(err && err.message ? err.message : "Could not acknowledge.", "error");
        ackBtn.disabled = false;
        ackBtn.textContent = "Acknowledge Receipt";
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Deep link (?ff_writeup= captured early in index.html)
// ---------------------------------------------------------------------------

function maybeConsumeDeepLink() {
  const pending = trimStr(window.__ffPendingWriteupDeepLinkId || "");
  if (!pending || !Array.isArray(state.docs)) return;
  const target = state.docs.find((d) => d.id === pending);
  if (!target) return;
  window.__ffPendingWriteupDeepLinkId = "";
  try {
    if (typeof window.goToMyProfile === "function") window.goToMyProfile();
    if (typeof window.ffSwitchMyProfileTab === "function") {
      window.ffSwitchMyProfileTab("writeups", { open: true });
    }
  } catch (_) {}
  setTimeout(() => openDocumentView(pending), 250);
}

// ---------------------------------------------------------------------------
// Bootstrapping — wait quietly for identity, then subscribe
// ---------------------------------------------------------------------------

export function ffMountMyWriteups(panel) {
  ensureSubscriptions();
  renderPanel(panel || panelEl());
}

if (typeof window !== "undefined") {
  window.ffMountMyWriteups = ffMountMyWriteups;

  const tick = () => ensureSubscriptions();
  // Identity (salon + staff link) resolves at different moments across
  // login / PIN / refresh flows — poll gently and listen to staff sync events.
  const interval = setInterval(tick, 4000);
  window.addEventListener("ff-staff-cloud-updated", tick);
  try {
    auth.onAuthStateChanged(() => tick());
  } catch (_) {}
  // Keep polling forever is unnecessary; after 5 minutes rely on events only.
  setTimeout(() => clearInterval(interval), 5 * 60 * 1000);
  tick();
}
