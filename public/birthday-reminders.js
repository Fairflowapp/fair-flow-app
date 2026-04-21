/**
 * Creates Inbox items for admins/managers X days before each staff birthday.
 * Employees do not receive these items (not creators, not recipients of their own reminder).
 */
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
  deleteField,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

/** Same Firebase app as app.js — avoid circular import (app.js → birthday-reminders → app.js). */
const _app = getApp();
const db = getFirestore(_app);
const auth = getAuth(_app);
const TODAY_CACHE_KEY = "ff_birthday_today_parts_v1";
const TODAY_CACHE_MS = 5 * 60 * 1000;

/** Salon calendar timezone (IANA), e.g. Asia/Jerusalem — optional in settings.preferences.salonTimeZone */
function getSalonTimeZone() {
  try {
    const w =
      typeof window !== "undefined" &&
      window.settings &&
      window.settings.preferences &&
      typeof window.settings.preferences.salonTimeZone === "string"
        ? window.settings.preferences.salonTimeZone.trim()
        : "";
    if (w) return w;
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ffv24_settings") : null;
    if (raw) {
      const j = JSON.parse(raw);
      const z = j.preferences && j.preferences.salonTimeZone;
      if (typeof z === "string" && z.trim()) return z.trim();
    }
  } catch (_) {}
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch (_) {
    return "UTC";
  }
}

/**
 * "Today" for birthday math only: device clock interpreted in salon TZ — no network APIs.
 * Network time often disagrees with the user's OS date by one day and breaks "1 day before" reminders.
 */
function getSalonCalendarTodayPartsForBirthday() {
  const tz = getSalonTimeZone();
  try {
    const now = new Date();
    const s = now.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d] = s.split("-").map(Number);
    if (y && m && d) return { y, m, d, source: "device_salon_tz" };
  } catch (_) {}
  const f = new Date();
  return { y: f.getFullYear(), m: f.getMonth() + 1, d: f.getDate(), source: "device_fallback" };
}

/**
 * Today's calendar date (y,m,d) for the salon timezone — prefers network time APIs over device clock.
 */
async function getAuthoritativeTodayParts() {
  const tz = getSalonTimeZone();
  try {
    const cached = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(TODAY_CACHE_KEY) : null;
    if (cached) {
      const o = JSON.parse(cached);
      if (o.tz === tz && Date.now() - o.t < TODAY_CACHE_MS && o.y && o.m && o.d) {
        return { y: o.y, m: o.m, d: o.d, source: "cache" };
      }
    }
  } catch (_) {}

  const urls = [
    `https://timeapi.io/api/Time/current/zone?timeZone=${encodeURIComponent(tz)}`,
    `https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const j = await r.json();
      const dt = j.dateTime != null ? j.dateTime : j.datetime;
      const datePart = String(dt || "").split("T")[0];
      const parts = datePart.split("-").map(Number);
      const y = parts[0];
      const m = parts[1];
      const d = parts[2];
      if (y && m && d) {
        try {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.setItem(TODAY_CACHE_KEY, JSON.stringify({ tz, y, m, d, t: Date.now() }));
          }
        } catch (_) {}
        return { y, m, d, source: "network" };
      }
    } catch (_) {}
  }

  console.warn(
    "[Birthday] Could not fetch network date; using device clock interpreted in",
    tz,
    "(set preferences.salonTimeZone in ffv24_settings if needed)"
  );
  try {
    const now = new Date();
    const s = now.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d] = s.split("-").map(Number);
    if (y && m && d) return { y, m, d, source: "device" };
  } catch (_) {}
  const f = new Date();
  return { y: f.getFullYear(), m: f.getMonth() + 1, d: f.getDate(), source: "device-local" };
}

function getBirthdayReminderDaysBefore() {
  let days = 7;
  try {
    let w =
      typeof window !== "undefined" &&
      window.settings &&
      window.settings.preferences &&
      window.settings.preferences.birthdayReminderDaysBefore != null
        ? window.settings.preferences.birthdayReminderDaysBefore
        : null;
    if (typeof w === "string" && /^\d+$/.test(w.trim())) w = parseInt(w.trim(), 10);
    if (w != null && Number.isFinite(Number(w))) {
      days = Number(w);
    } else {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem("ffv24_settings") : null;
      if (raw) {
        const j = JSON.parse(raw);
        let p = j.preferences && j.preferences.birthdayReminderDaysBefore;
        if (typeof p === "string" && /^\d+$/.test(String(p).trim())) p = parseInt(String(p).trim(), 10);
        if (typeof p === "number" && Number.isFinite(p)) days = p;
      }
    }
  } catch (_) {}
  days = Math.round(Number(days));
  if (!Number.isFinite(days)) days = 7;
  return Math.max(0, Math.min(90, days));
}

function parseBirthdayParts(birthday) {
  const s = String(birthday || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return { month: m, day: d, hasYear: true, year: y };
  }
  if (/^\d{2}-\d{2}$/.test(s)) {
    const [m, d] = s.split("-").map(Number);
    return { month: m, day: d, hasYear: false, year: null };
  }
  return null;
}

/**
 * Calendar days from "today" (ty/tm/td) to next occurrence of month/day (ignore birth year).
 * Uses UTC midnight math so it does not depend on the browser's local timezone for the calculation.
 */
function daysUntilNextBirthday(month, day, ty, tm, td) {
  const start = Date.UTC(ty, tm - 1, td);
  let yy = ty;
  let target = Date.UTC(yy, month - 1, day);
  if (target < start) {
    yy += 1;
    target = Date.UTC(yy, month - 1, day);
  }
  return Math.round((target - start) / 86400000);
}

/** Next birthday calendar date; year matches the upcoming occurrence. */
function nextBirthdayDate(month, day, ty, tm, td) {
  let yy = ty;
  const start = Date.UTC(ty, tm - 1, td);
  let target = Date.UTC(yy, month - 1, day);
  if (target < start) {
    yy += 1;
    target = Date.UTC(yy, month - 1, day);
  }
  return new Date(target);
}

function formatBirthdayDisplay(birthday) {
  const p = parseBirthdayParts(birthday);
  if (!p) return "";
  if (p.hasYear) {
    const dt = new Date(p.year, p.month - 1, p.day);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const dt = new Date(2000, p.month - 1, p.day);
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Full diagnostic for console: run `ffDebugBirthdayReminders()` after login.
 * Does not create Inbox items — only reads Firestore + prints why each staff is in/out of window.
 */
export async function diagnoseBirthdayReminders() {
  const report = {
    at: new Date().toISOString(),
    salonTimeZone: getSalonTimeZone(),
    earlyExit: null,
    uid: null,
    role: null,
    salonId: null,
    daysBefore: null,
    salonDate: null,
    dateSource: null,
    memberManagerCount: 0,
    staffRows: [],
  };

  try {
    const user = auth.currentUser;
    if (!user) {
      report.earlyExit = "not_signed_in";
      return report;
    }
    report.uid = user.uid;

    const uSnap = await getDoc(doc(db, "users", user.uid));
    if (!uSnap.exists()) {
      report.earlyExit = "no_users_doc";
      return report;
    }
    const uData = uSnap.data();
    const role = String(uData.role || "").toLowerCase();
    report.role = role;
    if (!["admin", "owner", "manager"].includes(role)) {
      report.earlyExit = "role_not_manager";
      report.hint = "Only owner / admin / manager run birthday reminders.";
      return report;
    }

    const salonId = uData.salonId || (typeof window !== "undefined" ? window.currentSalonId : null);
    report.salonId = salonId;
    if (!salonId) {
      report.earlyExit = "no_salon_id";
      return report;
    }

    const daysBefore = getBirthdayReminderDaysBefore();
    const today = getSalonCalendarTodayPartsForBirthday();
    const ty = today.y;
    const tm = today.m;
    const td = today.d;
    report.daysBefore = daysBefore;
    report.salonDate = `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
    report.dateSource = today.source;

    let staffList = [];
    const staffStore =
      typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
    staffList = Array.isArray(staffStore.staff) ? staffStore.staff.map((s) => ({ ...s })) : [];

    try {
      const staffColSnap = await getDocs(collection(db, `salons/${salonId}/staff`));
      const byId = new Map();
      for (const s of staffList) {
        if (s && s.id != null) byId.set(String(s.id), s);
      }
      for (const docSnap of staffColSnap.docs) {
        const id = docSnap.id;
        const data = docSnap.data() || {};
        const existing = byId.get(id);
        if (existing) {
          if (data.birthday != null && String(data.birthday).trim() !== "") existing.birthday = data.birthday;
          if (data.birthdayReminderSentForYear !== undefined) {
            existing.birthdayReminderSentForYear = data.birthdayReminderSentForYear;
          }
          if (data.isArchived !== undefined) existing.isArchived = data.isArchived;
          if (data.name != null && String(data.name).trim() !== "") existing.name = data.name;
        } else {
          byId.set(id, { id, ...data });
        }
      }
      staffList = Array.from(byId.values());
    } catch (e) {
      report.staffMergeError = String(e?.message || e);
    }

    let membersSnap = { docs: [] };
    try {
      membersSnap = await getDocs(collection(db, `salons/${salonId}/members`));
    } catch (e) {
      report.membersLoadError = String(e?.message || e);
    }
    const memberRows = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    report.memberManagerCount = memberRows.filter((m) =>
      ["admin", "owner", "manager"].includes(String(m.role || "").toLowerCase())
    ).length;

    const createdByStaffId = String(
      memberRows.find((m) => m.uid === user.uid)?.staffId || uData.staffId || ""
    );

    for (const staff of staffList) {
      const row = {
        id: staff.id,
        name: staff.name || "",
        birthday: staff.birthday || "",
        archived: staff.isArchived === true,
        untilDays: null,
        inWindow: null,
        nextBirthdayYear: null,
        reminderSentForYear: staff.birthdayReminderSentForYear ?? null,
        skipReason: null,
        wouldTryInbox: null,
      };

      if (row.archived) {
        row.skipReason = "archived";
        report.staffRows.push(row);
        continue;
      }
      const raw = staff.birthday;
      row.birthday = raw;
      if (!raw) {
        row.skipReason = "no_birthday_field";
        report.staffRows.push(row);
        continue;
      }
      const parts = parseBirthdayParts(raw);
      if (!parts) {
        row.skipReason = "bad_birthday_format (use YYYY-MM-DD)";
        report.staffRows.push(row);
        continue;
      }

      const until = daysUntilNextBirthday(parts.month, parts.day, ty, tm, td);
      row.untilDays = until;
      row.inWindow = until <= daysBefore && until >= 0;

      const nd = nextBirthdayDate(parts.month, parts.day, ty, tm, td);
      const nextBirthdayYear = nd.getUTCFullYear();
      row.nextBirthdayYear = nextBirthdayYear;

      if (!row.inWindow) {
        row.skipReason = `until=${until} not in 0…${daysBefore} (adjust dates or "Days in advance")`;
        report.staffRows.push(row);
        continue;
      }
      if (staff.birthdayReminderSentForYear === nextBirthdayYear) {
        row.skipReason = "already_reminded_this_year (birthdayReminderSentForYear matches)";
        row.wouldTryInbox = false;
        report.staffRows.push(row);
        continue;
      }

      const birthdayStaffIdStr = String(staff.id || "");
      const senderIsBirthdayStaff =
        createdByStaffId !== "" && birthdayStaffIdStr === createdByStaffId;
      let hasRecipient =
        memberRows.some(
          (m) =>
            ["admin", "owner", "manager"].includes(String(m.role || "").toLowerCase()) &&
            String(m.staffId || "") !== birthdayStaffIdStr
        ) ||
        (["admin", "owner", "manager"].includes(role) && !senderIsBirthdayStaff);

      if (!hasRecipient) {
        row.skipReason = "no_inbox_recipient (you are the only manager / birthday staff)";
        row.wouldTryInbox = false;
      } else {
        row.skipReason = null;
        row.wouldTryInbox = true;
      }
      report.staffRows.push(row);
    }

    report.summary = {
      staffTotal: staffList.length,
      withBirthday: staffList.filter((s) => s.birthday && s.isArchived !== true).length,
      inWindow: report.staffRows.filter((r) => r.inWindow === true).length,
      wouldCreate: report.staffRows.filter((r) => r.wouldTryInbox === true).length,
    };

    return report;
  } catch (e) {
    report.earlyExit = "exception";
    report.error = String(e?.message || e);
    return report;
  }
}

export function printBirthdayDiagnosisToConsole(report) {
  const r = report || {};
  console.group("%c[Birthday] Diagnosis", "font-weight:bold;font-size:13px;color:#7c3aed");
  if (r.earlyExit) {
    console.warn("Stopped:", r.earlyExit, r.hint || r.error || "");
  }
  console.log("Salon TZ:", r.salonTimeZone);
  console.log("Today (salon calendar):", r.salonDate, r.dateSource ? `(${r.dateSource})` : "");
  console.log('"Days in advance" setting:', r.daysBefore);
  console.log("Your role:", r.role, "| salonId:", r.salonId || "(missing)");
  console.log("Manager rows in members/:", r.memberManagerCount);
  if (r.staffMergeError) console.warn("Staff merge error:", r.staffMergeError);
  if (r.membersLoadError) console.warn("Members load error:", r.membersLoadError);
  if (Array.isArray(r.staffRows) && r.staffRows.length) {
    console.table(
      r.staffRows.map((x) => ({
        name: x.name,
        until: x.untilDays,
        inWindow: x.inWindow,
        wouldInbox: x.wouldTryInbox,
        skip: x.skipReason || "",
      }))
    );
  }
  if (r.summary) console.log("Summary:", r.summary);
  console.log("After a reminder run, inspect: ffLastBirthdayRun");
  console.log("To force another reminder attempt: ffRunBirthdayChatRemindersSoon()");
  console.groupEnd();
}

/** Call from DevTools: await ffDebugBirthdayReminders() */
export async function ffDebugBirthdayReminders() {
  const rep = await diagnoseBirthdayReminders();
  printBirthdayDiagnosisToConsole(rep);
  try {
    if (typeof window !== "undefined") window.ffLastBirthdayDebug = rep;
  } catch (_) {}
  return rep;
}

export async function runBirthdayChatRemindersOnce() {
  try {
    const user = auth.currentUser;
    if (!user) return;

    const uSnap = await getDoc(doc(db, "users", user.uid));
    if (!uSnap.exists()) return;
    const uData = uSnap.data();
    const role = String(uData.role || "").toLowerCase();
    if (!["admin", "owner", "manager"].includes(role)) return;

    const salonId = uData.salonId || (typeof window !== "undefined" ? window.currentSalonId : null);
    if (!salonId) return;

    const daysBefore = getBirthdayReminderDaysBefore();
    const today = getSalonCalendarTodayPartsForBirthday();
    const ty = today.y;
    const tm = today.m;
    const td = today.d;

    const staffStore =
      typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : { staff: [] };
    let staffList = Array.isArray(staffStore.staff) ? staffStore.staff.map((s) => ({ ...s })) : [];

    /** Merge birthdays + reminder flags from Firestore — local cache can lag right after save. */
    try {
      const staffColSnap = await getDocs(collection(db, `salons/${salonId}/staff`));
      const byId = new Map();
      for (const s of staffList) {
        if (s && s.id != null) byId.set(String(s.id), s);
      }
      for (const docSnap of staffColSnap.docs) {
        const id = docSnap.id;
        const data = docSnap.data() || {};
        const existing = byId.get(id);
        if (existing) {
          if (data.birthday != null && String(data.birthday).trim() !== "") {
            existing.birthday = data.birthday;
          }
          if (data.birthdayReminderSentForYear !== undefined) {
            existing.birthdayReminderSentForYear = data.birthdayReminderSentForYear;
          }
          if (data.isArchived !== undefined) existing.isArchived = data.isArchived;
          if (data.name != null && String(data.name).trim() !== "") existing.name = data.name;
        } else {
          byId.set(id, { id, ...data });
        }
      }
      staffList = Array.from(byId.values());
    } catch (e) {
      console.warn("[Birthday] staff merge from Firestore failed — using ffGetStaffStore only", e);
    }

    let membersSnap = { docs: [] };
    try {
      membersSnap = await getDocs(collection(db, `salons/${salonId}/members`));
    } catch (e) {
      console.warn("[Birthday] members load failed — using current user only", e);
    }

    const memberRows = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    const senderUid = user.uid;
    const senderName =
      uData.name || uData.displayName || uData.email || "Admin";
    const senderMember = memberRows.find((m) => m.uid === senderUid);
    const createdByStaffId = String(senderMember?.staffId || uData.staffId || "");
    const createdByRole = role;

    let inboxItemsCreated = 0;
    /** Per staff with a birthday: why Inbox was or was not created (see ffLastBirthdayRun.staffEval). */
    const staffEval = [];
    const evName = (s) => String(s.name || s.id || "?").slice(0, 48);

    console.info("[Birthday] run", {
      salonDate: `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`,
      dateSource: today.source,
      daysBeforeSetting: daysBefore,
      staffTotal: staffList.length,
      withBirthdayField: staffList.filter((s) => s.birthday && s.isArchived !== true).length,
    });

    for (const staff of staffList) {
      if (staff.isArchived === true) continue;
      const raw = staff.birthday;
      if (!raw) continue;

      const parts = parseBirthdayParts(raw);
      if (!parts) {
        staffEval.push({ name: evName(staff), birthday: String(raw), outcome: "bad_date_format" });
        continue;
      }

      const until = daysUntilNextBirthday(parts.month, parts.day, ty, tm, td);
      // Within N calendar days before (inclusive). Exact match was too brittle; transaction still sends once per year.
      if (until > daysBefore || until < 0) {
        staffEval.push({
          name: evName(staff),
          untilDays: until,
          daysBeforeSetting: daysBefore,
          outcome: "outside_window",
          hint:
            until > daysBefore
              ? `Birthday is in ${until} days; "Days in advance" is only ${daysBefore}. Increase "Days in advance" to at least ${until}, or set birthday sooner.`
              : "Negative days — check salon timezone / birthday date.",
        });
        continue;
      }

      const nd = nextBirthdayDate(parts.month, parts.day, ty, tm, td);
      const nextBirthdayYear = nd.getUTCFullYear();
      const sentFor = staff.birthdayReminderSentForYear;
      if (sentFor === nextBirthdayYear) {
        console.info("[Birthday] skip — already reminded for this year", staff.name || staff.id, {
          sentFor,
          nextBirthdayYear,
        });
        staffEval.push({
          name: evName(staff),
          untilDays: until,
          outcome: "already_reminded_this_year",
          birthdayReminderSentForYear: sentFor,
          nextBirthdayYear,
          hint: "Clear birthdayReminderSentForYear on staff doc or change birthday and save to retest.",
        });
        continue;
      }

      const name = String(staff.name || "Staff").trim();
      const pretty = formatBirthdayDisplay(raw);
      const summaryLine = `${name}'s birthday is ${pretty}${until === 0 ? " (today)" : ` in ${until} day${until === 1 ? "" : "s"}`}.`;

      const managersAndAdmins = memberRows.filter((m) =>
        ["admin", "owner", "manager"].includes(String(m.role || "").toLowerCase())
      );
      const birthdayStaffIdStr = String(staff.id || "");
      let recipients = managersAndAdmins.filter(
        (m) => String(m.staffId || "") !== birthdayStaffIdStr
      );
      const seenRecipientUids = new Set();
      recipients = recipients.filter((m) => {
        const u = m.uid;
        if (!u || seenRecipientUids.has(u)) return false;
        seenRecipientUids.add(u);
        return true;
      });
      // Signed-in owner/admin/manager must get a "To handle" row when they are not the birthday
      // staff member — even if they are missing from salons/{id}/members (only other admins listed).
      const rlSender = String(role).toLowerCase();
      const senderIsBirthdayStaff =
        createdByStaffId !== "" && birthdayStaffIdStr === createdByStaffId;
      if (
        ["admin", "owner", "manager"].includes(rlSender) &&
        !senderIsBirthdayStaff &&
        senderUid &&
        !seenRecipientUids.has(senderUid)
      ) {
        recipients.push({
          uid: senderUid,
          staffId: createdByStaffId,
          name: senderName,
          role: rlSender,
        });
        seenRecipientUids.add(senderUid);
      }
      if (recipients.length === 0) {
        const rl = String(role).toLowerCase();
        if (["admin", "owner", "manager"].includes(rl) && birthdayStaffIdStr !== createdByStaffId) {
          recipients = [
            {
              uid: senderUid,
              staffId: createdByStaffId,
              name: senderName,
              role: rl,
            },
          ];
          console.info(
            "[Birthday] Inbox recipient fallback: signed-in manager (members list empty or no manager rows).",
            staff.name || staff.id
          );
        }
      }
      if (recipients.length === 0) {
        console.info(
          "[Birthday] No inbox recipients (only the birthday person is management, or session is not manager-level).",
          staff.name || staff.id
        );
        if (typeof window.showToast === "function") {
          window.showToast(`🎂 ${summaryLine} (add managers/admins in Members to receive Inbox reminders.)`, 12000);
        }
        await setDoc(
          doc(db, `salons/${salonId}/staff`, staff.id),
          { birthdayReminderSentForYear: nextBirthdayYear, updatedAtMs: Date.now() },
          { merge: true }
        );
        staffEval.push({
          name: evName(staff),
          untilDays: until,
          outcome: "no_inbox_recipients_marked_sent_only",
          hint: "No manager to notify (or you are the birthday staff). No Inbox row.",
        });
        continue;
      }

      const dataPayload = {
        kind: "staff_birthday_reminder",
        subjectStaffId: staff.id,
        subjectStaffName: name,
        birthdayDisplay: pretty,
        daysUntil: until,
        nextBirthdayYear,
        details: summaryLine,
        automated: true,
      };

      const inboxCol = collection(db, `salons/${salonId}/inboxItems`);
      let didCreate = false;
      try {
        didCreate = await runTransaction(db, async (transaction) => {
          const staffRef = doc(db, `salons/${salonId}/staff`, staff.id);
          const staffSnap = await transaction.get(staffRef);
          const prev = staffSnap.exists() ? staffSnap.data() : {};
          if (prev.birthdayReminderSentForYear === nextBirthdayYear) {
            return false;
          }
          transaction.set(
            staffRef,
            { birthdayReminderSentForYear: nextBirthdayYear, updatedAtMs: Date.now() },
            { merge: true }
          );
          // Stamp the subject staff's primary location on the inbox item so
          // the UI can scope it to the correct branch without having to look
          // up staff allowedLocationIds at render time.
          const subjectLocationId =
            (staff && typeof staff.primaryLocationId === 'string' && staff.primaryLocationId.trim())
              ? staff.primaryLocationId.trim()
              : (Array.isArray(staff && staff.allowedLocationIds) && staff.allowedLocationIds[0]
                  ? String(staff.allowedLocationIds[0])
                  : null);
          for (const rec of recipients) {
            const forUid = rec.uid;
            const forStaffId = String(rec.staffId || "");
            const forStaffName = String(rec.name || "Manager").trim() || forUid;
            const requestDoc = {
              tenantId: salonId,
              locationId: subjectLocationId,
              type: "staff_birthday_reminder",
              status: "open",
              priority: "normal",
              assignedTo: null,
              sentToStaffIds: [],
              sentToNames: [],
              data: dataPayload,
              managerNotes: null,
              responseNote: null,
              decidedBy: null,
              decidedAt: null,
              needsInfoQuestion: null,
              staffReply: null,
              visibility: "managers_only",
              unreadForManagers: true,
              createdByUid: senderUid,
              createdByStaffId,
              createdByName: senderName,
              createdByRole,
              forUid,
              forStaffId,
              forStaffName,
              createdAt: serverTimestamp(),
              lastActivityAt: serverTimestamp(),
              updatedAt: null,
            };
            const itemRef = doc(inboxCol);
            transaction.set(itemRef, requestDoc);
          }
          return true;
        });
      } catch (txErr) {
        console.error("[Birthday] Firestore transaction failed", txErr);
        if (typeof window.showToast === "function") {
          window.showToast(
            "Birthday reminder could not be saved: " +
              String(txErr?.message || txErr).slice(0, 140),
            14000
          );
        }
        if (typeof window !== "undefined") {
          window.ffLastBirthdayRun = {
            at: Date.now(),
            salonId,
            error: String(txErr?.message || txErr),
          };
        }
        continue;
      }

      if (didCreate) {
        inboxItemsCreated += recipients.length;
        staffEval.push({
          name: evName(staff),
          untilDays: until,
          outcome: "inbox_created",
          inboxRows: recipients.length,
        });
        console.info("[Birthday] Inbox reminders created (transaction)", recipients.length, "recipients for", name);
        if (typeof window.showToast === "function") {
          window.showToast(`🎂 Birthday reminder added to Inbox for management (${recipients.length}).`, 8000);
        }
      } else {
        staffEval.push({
          name: evName(staff),
          untilDays: until,
          outcome: "transaction_skipped_already_sent",
          hint: "Another tab may have sent this reminder first (race).",
        });
      }
    }

    if (typeof window !== "undefined") {
      const salonDateStr = `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
      let whyNoInbox = null;
      if (inboxItemsCreated === 0) {
        const outside = staffEval.filter((e) => e.outcome === "outside_window");
        const already = staffEval.filter((e) => e.outcome === "already_reminded_this_year");
        if (outside.length) {
          whyNoInbox =
            `No birthday in the ${daysBefore}-day window. Example: ${outside[0].name} is in ${outside[0].untilDays} days (need 0–${daysBefore}).`;
        } else if (already.length) {
          whyNoInbox = "Reminder already recorded for this year for matching staff — see staffEval.";
        } else if (!staffEval.length) {
          whyNoInbox = "No staff with a valid birthday field (or all archived).";
        } else {
          whyNoInbox = "See staffEval[] for each person.";
        }
      }
      window.ffLastBirthdayRun = {
        at: Date.now(),
        salonId,
        daysBefore,
        inboxItemsCreated,
        salonDate: salonDateStr,
        salonTimeZone: getSalonTimeZone(),
        staffEval,
        whyNoInbox,
      };
      if (inboxItemsCreated === 0 && whyNoInbox) {
        console.warn("[Birthday] No Inbox items this run —", whyNoInbox);
      }
    }

    try {
      const preview = [];
      for (const s of staffList) {
        if (s.isArchived === true || !s.birthday) continue;
        const p = parseBirthdayParts(s.birthday);
        if (!p) continue;
        const u = daysUntilNextBirthday(p.month, p.day, ty, tm, td);
        if (u <= 60) preview.push(`${String(s.name || s.id).slice(0, 24)}: ${u}d`);
      }
      if (preview.length) {
        console.info(
          "[Birthday] Next birthdays (days until):",
          preview.join("; "),
          "| Inbox when until is 0…" + daysBefore + " (Notifications → days in advance)"
        );
      }
    } catch (_) {}
  } catch (e) {
    console.warn("[Birthday] runBirthdayChatRemindersOnce", e);
    try {
      if (typeof window !== "undefined") {
        window.ffLastBirthdayRun = { at: Date.now(), error: String(e?.message || e) };
      }
      if (typeof window.showToast === "function") {
        window.showToast("Birthday reminder check failed: " + String(e?.message || e).slice(0, 120), 12000);
      }
    } catch (_) {}
  }
}

/**
 * Creates one real Inbox row (same type as automated reminders) addressed to you — proves rules + UI.
 * Does not touch staff birthdayReminderSentForYear.
 */
export async function sendBirthdayInboxTestPing() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const uSnap = await getDoc(doc(db, "users", user.uid));
  if (!uSnap.exists()) throw new Error("No user profile in Firestore");
  const uData = uSnap.data();
  const role = String(uData.role || "").toLowerCase();
  if (!["admin", "owner", "manager"].includes(role)) {
    throw new Error("Only owner, admin, or manager can receive this test");
  }
  const salonId = uData.salonId || (typeof window !== "undefined" ? window.currentSalonId : null);
  if (!salonId) throw new Error("No salonId on user account");

  let memberRows = [];
  try {
    const membersSnap = await getDocs(collection(db, `salons/${salonId}/members`));
    memberRows = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  } catch (_) {}
  const senderMember = memberRows.find((m) => m.uid === user.uid);
  const createdByStaffId = String(senderMember?.staffId || uData.staffId || "");
  const senderName = String(uData.name || uData.displayName || uData.email || "Manager").trim() || user.uid;

  const dataPayload = {
    kind: "staff_birthday_reminder",
    testPing: true,
    subjectStaffName: "Pipeline test",
    subjectStaffId: "__ff_test__",
    birthdayDisplay: "—",
    daysUntil: 0,
    nextBirthdayYear: new Date().getFullYear(),
    details:
      "If you see this under Staff birthday reminder, Inbox + Firestore are working. You can archive or delete it.",
    automated: true,
  };

  const ref = await addDoc(collection(db, `salons/${salonId}/inboxItems`), {
    tenantId: salonId,
    locationId: null,
    type: "staff_birthday_reminder",
    status: "open",
    priority: "normal",
    assignedTo: null,
    sentToStaffIds: [],
    sentToNames: [],
    data: dataPayload,
    managerNotes: null,
    responseNote: null,
    decidedBy: null,
    decidedAt: null,
    needsInfoQuestion: null,
    staffReply: null,
    visibility: "managers_only",
    unreadForManagers: true,
    createdByUid: user.uid,
    createdByStaffId,
    createdByName: senderName,
    createdByRole: role,
    forUid: user.uid,
    forStaffId: createdByStaffId,
    forStaffName: senderName,
    createdAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
    updatedAt: null,
  });

  if (typeof window !== "undefined" && typeof window.showToast === "function") {
    window.showToast("Test Inbox item created — open Inbox → Team → Open.", 9000);
  }
  return { ok: true, inboxItemId: ref.id, salonId };
}

/** Removes birthdayReminderSentForYear on all staff — use after tests so automated reminders can fire again. */
export async function clearBirthdayReminderSentFlagsForSalon() {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const uSnap = await getDoc(doc(db, "users", user.uid));
  if (!uSnap.exists()) throw new Error("No user profile");
  const uData = uSnap.data();
  const role = String(uData.role || "").toLowerCase();
  if (!["admin", "owner", "manager"].includes(role)) {
    throw new Error("Only owner, admin, or manager can reset flags");
  }
  const salonId = uData.salonId || (typeof window !== "undefined" ? window.currentSalonId : null);
  if (!salonId) throw new Error("No salonId");

  const staffSnap = await getDocs(collection(db, `salons/${salonId}/staff`));
  const docs = staffSnap.docs;
  const CHUNK = 400;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => {
      batch.update(d.ref, {
        birthdayReminderSentForYear: deleteField(),
        updatedAtMs: Date.now(),
      });
    });
    await batch.commit();
  }
  if (typeof window !== "undefined" && typeof window.showToast === "function") {
    window.showToast(`Cleared birthday “sent” flags on ${docs.length} staff — run reminders again.`, 8000);
  }
  return { cleared: docs.length, salonId };
}

if (typeof window !== "undefined") {
  window.runBirthdayChatRemindersOnce = runBirthdayChatRemindersOnce;
  window.diagnoseBirthdayReminders = diagnoseBirthdayReminders;
  window.ffDebugBirthdayReminders = ffDebugBirthdayReminders;
  window.printBirthdayDiagnosisToConsole = printBirthdayDiagnosisToConsole;
  window.sendBirthdayInboxTestPing = sendBirthdayInboxTestPing;
  window.clearBirthdayReminderSentFlagsForSalon = clearBirthdayReminderSentFlagsForSalon;
}
