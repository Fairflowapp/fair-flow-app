/**
 * Automatic Inbox alerts for managers when a staff document is exactly 30 calendar days
 * before expiration (salon timezone). Same cadence as birthday-reminders.js (~5 min while app open).
 * Dedupes with staff document field thirtyDayReminderSentAt (aligned with Cloud Function).
 */
import { getApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const _app = getApp();
const db = getFirestore(_app);
const auth = getAuth(_app);

function trimStr(v) {
  return v == null ? "" : String(v).trim();
}

/** Salon calendar timezone — same source as birthday-reminders.js */
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

function getSalonCalendarTodayParts() {
  const tz = getSalonTimeZone();
  try {
    const now = new Date();
    const s = now.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d] = s.split("-").map(Number);
    if (y && m && d) return { y, m, d };
  } catch (_) {}
  const f = new Date();
  return { y: f.getFullYear(), m: f.getMonth() + 1, d: f.getDate() };
}

function toDateMaybe(v) {
  if (v == null) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const s = v.trim().slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T12:00:00.000Z`);
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function expirationToMillis(raw) {
  if (raw == null || raw === "") return null;
  try {
    const d = toDateMaybe(raw);
    if (!d) return null;
    return d.getTime();
  } catch (_) {
    return null;
  }
}

/** Calendar date parts of the expiration instant, in salon TZ (for day comparison). */
function expiryPartsInSalonTz(expMs, tz) {
  const d = new Date(expMs);
  try {
    const s = d.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const [y, m, d0] = s.split("-").map(Number);
    if (y && m && d0) return { y, m, d: d0 };
  } catch (_) {}
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
  };
}

/** Whole calendar days from "today" (salon) to expiry day (salon). */
function salonCalendarDaysUntilExpiry(expMs, todayY, todayM, todayD, tz) {
  const ep = expiryPartsInSalonTz(expMs, tz);
  const a = Date.UTC(todayY, todayM - 1, todayD);
  const b = Date.UTC(ep.y, ep.m - 1, ep.d);
  return Math.round((b - a) / 86400000);
}

function buildExpiryMessage({ subjectStaffName, documentTitle, documentType, diffDays }) {
  const who = subjectStaffName || "A staff member";
  const title = documentTitle || documentType || "Document";
  if (diffDays <= 0) {
    return `${who}'s ${title} expires today.`;
  }
  if (diffDays === 1) {
    return `${who}'s ${title} expires tomorrow.`;
  }
  return `${who}'s ${title} expires in ${diffDays} days.`;
}

export async function runStaffDocExpiryInboxRemindersOnce() {
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

    const tz = getSalonTimeZone();
    const today = getSalonCalendarTodayParts();
    const ty = today.y;
    const tm = today.m;
    const td = today.d;

    let membersSnap = { docs: [] };
    try {
      membersSnap = await getDocs(collection(db, `salons/${salonId}/members`));
    } catch (e) {
      console.warn("[StaffDocExpiry Inbox] members load failed", e);
    }
    const memberRows = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));

    const senderUid = user.uid;
    const senderName = uData.name || uData.displayName || uData.email || "Admin";
    const senderMember = memberRows.find((m) => m.uid === senderUid);
    const createdByStaffId = String(senderMember?.staffId || uData.staffId || "");
    const createdByRole = role;

    let managersAndAdmins = memberRows.filter((m) =>
      ["admin", "owner", "manager"].includes(String(m.role || "").toLowerCase()),
    );
    const seenUids = new Set();
    managersAndAdmins = managersAndAdmins.filter((m) => {
      const u = m.uid;
      if (!u || seenUids.has(u)) return false;
      seenUids.add(u);
      return true;
    });
    if (managersAndAdmins.length === 0) {
      managersAndAdmins = [
        {
          uid: senderUid,
          staffId: createdByStaffId,
          name: senderName,
          role,
        },
      ];
    }

    let inboxItemsCreated = 0;
    let docsChecked = 0;

    const staffColSnap = await getDocs(collection(db, `salons/${salonId}/staff`));
    for (const staffDoc of staffColSnap.docs) {
      const staffId = staffDoc.id;
      const stRow = staffDoc.data() || {};
      if (stRow.isArchived === true) continue;

      const subjectStaffName = trimStr(stRow.name) || "Staff member";

      let docsSnap;
      try {
        docsSnap = await getDocs(collection(db, `salons/${salonId}/staff/${staffId}/documents`));
      } catch (e) {
        console.warn("[StaffDocExpiry Inbox] list documents failed", salonId, staffId, e);
        continue;
      }

      for (const dSnap of docsSnap.docs) {
        docsChecked += 1;
        const documentId = dSnap.id;
        const data = dSnap.data() || {};

        const life = String(data.lifecycleStatus || "").toLowerCase();
        if (life === "archived") continue;

        const approval = String(data.approvalStatus || "").toLowerCase();
        if (approval !== "approved") continue;

        if (data.thirtyDayReminderSentAt) continue;

        const expMs = expirationToMillis(data.expirationDate);
        if (expMs == null) continue;

        const diffDays = salonCalendarDaysUntilExpiry(expMs, ty, tm, td, tz);
        if (diffDays !== 30) continue;

        const documentTitle = trimStr(data.title || data.type) || "Document";
        const documentType = trimStr(data.type) || "Document";
        const message = buildExpiryMessage({
          subjectStaffName,
          documentTitle,
          documentType,
          diffDays: 30,
        });

        const expTs = Timestamp.fromMillis(expMs);
        const dataPayload = {
          source: "staff_documents",
          staffId,
          documentId,
          documentTitle,
          documentType,
          expirationDate: expTs,
          message,
          subjectStaffName,
          automated: true,
          daysUntilExpiry: 30,
        };

        const docRef = doc(db, `salons/${salonId}/staff/${staffId}/documents`, documentId);
        const inboxCol = collection(db, `salons/${salonId}/inboxItems`);

        try {
          const did = await runTransaction(db, async (transaction) => {
            const fresh = await transaction.get(docRef);
            if (!fresh.exists()) return false;
            const fd = fresh.data() || {};
            if (String(fd.lifecycleStatus || "").toLowerCase() === "archived") return false;
            if (String(fd.approvalStatus || "").toLowerCase() !== "approved") return false;
            if (fd.thirtyDayReminderSentAt) return false;

            const d2 = salonCalendarDaysUntilExpiry(expirationToMillis(fd.expirationDate), ty, tm, td, tz);
            if (d2 !== 30) return false;

            transaction.update(docRef, {
              thirtyDayReminderSentAt: serverTimestamp(),
              lifecycleStatus: "expiring_soon",
              updatedAt: serverTimestamp(),
            });

            for (const rec of managersAndAdmins) {
              const forUid = rec.uid;
              const forStaffId = String(rec.staffId || "");
              const forStaffName = String(rec.name || "Manager").trim() || forUid;
              const itemRef = doc(inboxCol);
              transaction.set(itemRef, {
                tenantId: salonId,
                locationId: null,
                type: "document_expiring_soon",
                status: "open",
                priority: "normal",
                assignedTo: null,
                sentToStaffIds: [],
                sentToNames: [],
                message,
                source: "staff_documents",
                staffId,
                documentId,
                documentTitle,
                documentType,
                expirationDate: expTs,
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
              });
            }
            return true;
          });
          if (did) {
            inboxItemsCreated += managersAndAdmins.length;
            console.info(
              "[StaffDocExpiry Inbox] Created reminder(s) for",
              subjectStaffName,
              documentTitle,
              "→",
              managersAndAdmins.length,
              "manager(s)",
            );
          }
        } catch (txErr) {
          console.warn("[StaffDocExpiry Inbox] transaction failed", staffId, documentId, txErr);
        }
      }
    }

    if (typeof window !== "undefined") {
      window.ffLastStaffDocExpiryInboxRun = {
        at: Date.now(),
        salonId,
        salonTimeZone: tz,
        salonDate: `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`,
        docsChecked,
        inboxRowsCreated: inboxItemsCreated,
      };
    }

    if (inboxItemsCreated > 0 && typeof window.showToast === "function") {
      window.showToast(
        `Document expiry: ${inboxItemsCreated} Inbox alert(s) for managers (30 days before expiration).`,
        8000,
      );
    }
  } catch (e) {
    console.warn("[StaffDocExpiry Inbox] run failed", e);
  }
}

if (typeof window !== "undefined") {
  window.ffRunStaffDocExpiryInboxRemindersSoon = runStaffDocExpiryInboxRemindersOnce;
}
