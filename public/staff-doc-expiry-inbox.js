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

/** Stable day bucket for id (UTC date of expiry instant) — matches Cloud Function. */
function expirationYmdUtcBucket(expMs) {
  const d = new Date(expMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function sanitizeInboxDocIdSegment(s) {
  return String(s || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 200);
}

/**
 * Same physical file can appear as two staff document rows (e.g. License vs Certification).
 * Dedupe Inbox rows per manager using file path / filename fingerprint + expiry day.
 */
function fileFingerprintForDedupe(data) {
  const p = trimStr(data.storagePath || data.filePath || "");
  if (p) {
    const base = p.split("/").pop() || p;
    return base.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  }
  const title = trimStr(data.title || data.type || "doc");
  const uuidish = title.match(/([a-f0-9]{8}-[a-f0-9-]{4,}[^.\s]*\.\w+)/i);
  if (uuidish) return uuidish[1].replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
  return title.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);
}

function buildDoc30InboxDocId({ forUid, staffId, expMs, data }) {
  const expYmd = expirationYmdUtcBucket(expMs);
  const fp = fileFingerprintForDedupe(data);
  const id = `auto_doc30_${sanitizeInboxDocIdSegment(forUid)}_${sanitizeInboxDocIdSegment(staffId)}_${expYmd}_${sanitizeInboxDocIdSegment(fp)}`;
  return id.length > 1400 ? id.slice(0, 1400) : id;
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

    // Current viewer's active location — used to scope the end-of-run toast
    // so a manager at Brickell doesn't get a toast about Key-Biscayne items.
    const viewerActiveLocationId =
      typeof window !== "undefined" && typeof window.ffGetActiveLocationId === "function"
        ? String(window.ffGetActiveLocationId() || "").trim()
        : "";
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
    let inboxItemsForActiveLocation = 0;
    let docsChecked = 0;
    let docsInExpiryWindow = 0;

    let staffColSnap;
    try {
      staffColSnap = await getDocs(collection(db, `salons/${salonId}/staff`));
    } catch (e) {
      console.warn("[StaffDocExpiry Inbox] cannot list staff (role / rules?)", e);
      if (typeof window !== "undefined") {
        window.ffLastStaffDocExpiryInboxRun = {
          at: Date.now(),
          salonId,
          error: String(e?.code || e?.message || e),
          hint: "Listing salon/staff failed — owner/admin/manager required to scan all staff documents.",
        };
      }
      return;
    }

    // Build a staffId -> staff-doc lookup so we can resolve each recipient's
    // own allowedLocationIds when routing inbox alerts by branch.
    const staffRowsByIdLookup = {};
    for (const sDoc of staffColSnap.docs) {
      staffRowsByIdLookup[sDoc.id] = sDoc.data() || {};
    }

    /**
     * Filter a recipient list to managers who actually cover the subject's
     * location. Owners pass through unchanged (they run the salon), as do
     * legacy managers whose staff record has no allowedLocationIds — the
     * latter predates the per-location model and is treated as salon-wide.
     */
    function filterRecipientsForLocation(recipients, targetLocationId) {
      if (!targetLocationId) return recipients;
      return recipients.filter((rec) => {
        const recRole = String(rec?.role || "").toLowerCase();
        if (recRole === "owner") return true;
        const recStaffId = String(rec?.staffId || "").trim();
        if (!recStaffId) return true; // can't resolve → keep (fail-open)
        const recStaff = staffRowsByIdLookup[recStaffId];
        if (!recStaff) return true;
        const allowed = Array.isArray(recStaff.allowedLocationIds)
          ? recStaff.allowedLocationIds.map((id) => String(id || "").trim()).filter(Boolean)
          : [];
        if (!allowed.length) return true; // salon-wide
        return allowed.includes(targetLocationId);
      });
    }
    for (const staffDoc of staffColSnap.docs) {
      const staffId = staffDoc.id;
      const stRow = staffDoc.data() || {};
      if (stRow.isArchived === true) continue;

      const subjectStaffName = trimStr(stRow.name) || "Staff member";

      // Resolve the subject staff's location so each inbox reminder can be
      // scoped to the correct branch (matches the pattern used by
      // birthday-reminders.js). Prefer the primary location; fall back to
      // the first allowed location if no primary is set; otherwise null.
      const subjectLocationId =
        (stRow && typeof stRow.primaryLocationId === "string" && stRow.primaryLocationId.trim())
          ? stRow.primaryLocationId.trim()
          : (Array.isArray(stRow && stRow.allowedLocationIds) && stRow.allowedLocationIds[0]
              ? String(stRow.allowedLocationIds[0]).trim() || null
              : null);

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
        /* Match Cloud Function: first alert while 1…30 calendar days remain (not only exactly 30). */
        if (diffDays <= 0 || diffDays > 30) continue;
        docsInExpiryWindow += 1;

        const subjectMember = memberRows.find((m) => String(m.staffId || "").trim() === String(staffId).trim());
        const rowCreatedByUid = subjectMember && subjectMember.uid ? subjectMember.uid : senderUid;
        const rowCreatedByName = subjectMember && subjectMember.uid ? subjectStaffName : senderName;
        const rowCreatedByStaffId = String(staffId);

        const documentTitle = trimStr(data.title || data.type) || "Document";
        const documentType = trimStr(data.type) || "Document";
        const message = buildExpiryMessage({
          subjectStaffName,
          documentTitle,
          documentType,
          diffDays,
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
          daysUntilExpiry: diffDays,
        };

        const docRef = doc(db, `salons/${salonId}/staff/${staffId}/documents`, documentId);

        try {
          const createdInTx = await runTransaction(db, async (transaction) => {
            const fresh = await transaction.get(docRef);
            if (!fresh.exists()) return 0;
            const fd = fresh.data() || {};
            if (String(fd.lifecycleStatus || "").toLowerCase() === "archived") return 0;
            if (String(fd.approvalStatus || "").toLowerCase() !== "approved") return 0;
            if (fd.thirtyDayReminderSentAt) return 0;

            const d2 = salonCalendarDaysUntilExpiry(expirationToMillis(fd.expirationDate), ty, tm, td, tz);
            if (d2 <= 0 || d2 > 30) return 0;

            // Only alert managers who actually cover the subject staff's
            // branch. Without this, a manager at Brickell would get an
            // Inbox row about a Key-Biscayne employee whose document is
            // expiring — noisy and wrong by the "two businesses" model.
            const recipientsForThisSubject = filterRecipientsForLocation(
              managersAndAdmins,
              subjectLocationId,
            );
            const planned = recipientsForThisSubject.map((rec) => {
              const forUid = rec.uid;
              const itemId = buildDoc30InboxDocId({
                forUid,
                staffId,
                expMs,
                data: fd,
              });
              const itemRef = doc(db, `salons/${salonId}/inboxItems`, itemId);
              return { rec, itemRef, forUid };
            });

            const existingSnaps = [];
            for (const p of planned) {
              existingSnaps.push({ p, snap: await transaction.get(p.itemRef) });
            }

            let newRows = 0;
            for (const { p, snap } of existingSnaps) {
              if (snap.exists()) continue;
              const forUid = p.forUid;
              const rec = p.rec;
              const forStaffId = String(rec.staffId || "");
              const forStaffName = String(rec.name || "Manager").trim() || forUid;
              transaction.set(p.itemRef, {
                tenantId: salonId,
                locationId: subjectLocationId,
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
                createdByUid: rowCreatedByUid,
                createdByStaffId: rowCreatedByStaffId,
                createdByName: rowCreatedByName,
                createdByRole,
                forUid,
                forStaffId,
                forStaffName,
                createdAt: serverTimestamp(),
                lastActivityAt: serverTimestamp(),
                updatedAt: null,
              });
              newRows += 1;
            }

            transaction.update(docRef, {
              thirtyDayReminderSentAt: serverTimestamp(),
              lifecycleStatus: "expiring_soon",
              updatedAt: serverTimestamp(),
            });
            return newRows;
          });
          if (createdInTx > 0) {
            inboxItemsCreated += createdInTx;
            // Track rows relevant to the currently-viewing user's branch so
            // the end-of-run toast count reflects what they can actually
            // see in their Inbox (avoids "8 alerts" when only 2 are for
            // the active location).
            if (
              !viewerActiveLocationId ||
              !subjectLocationId ||
              subjectLocationId === viewerActiveLocationId
            ) {
              inboxItemsForActiveLocation += createdInTx;
            }
            console.info(
              "[StaffDocExpiry Inbox] Created reminder(s) for",
              subjectStaffName,
              documentTitle,
              "→",
              createdInTx,
              "new manager row(s) (deduped by file+expiry)",
            );
          } else if (createdInTx === 0) {
            /* Transaction may have returned 0 if all inbox rows already existed (duplicate doc rows for same file). */
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
        docsInExpiryWindow1to30: docsInExpiryWindow,
        inboxRowsCreated: inboxItemsCreated,
        hint:
          inboxItemsCreated === 0 && docsInExpiryWindow > 0
            ? "Docs in window but no new rows (dedupe / transaction) — check console."
            : inboxItemsCreated === 0 && docsInExpiryWindow === 0
              ? "No approved staff documents with expiration in 1–30 days. Set expiry on upload or wait until inside 30 days."
              : undefined,
      };
    }

    if (inboxItemsForActiveLocation > 0 && typeof window.showToast === "function") {
      window.showToast(
        `Document expiry: ${inboxItemsForActiveLocation} Inbox alert(s) for managers (30 days before expiration).`,
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
