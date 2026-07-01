/**
 * staff-documents-expiry-chat.js — "document expiring soon" chat-reminder flow split out
 * of staff-documents.js: role gate, recipient-uid resolution, the 1:1 reminder sender,
 * the guarded notify entrypoint, and the explicit-context variant used by the Inbox alert.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  setDoc,
  serverTimestamp,
  increment,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";
import { sdState } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import { trimStr, toDateMaybe, calendarDaysUntilExpiry } from "./staff-documents-format.js?v=20260701_staffdoc_format_split";
import { ffToast } from "./staff-documents-ui.js?v=20260701_staffdoc_ui_split";

/** Align with media-upload / schedule: managers, assistant managers, front desk, admins, owners. */
function ffUserCanSendExpiryChatReminder(roleLc) {
  return ["manager", "admin", "owner", "front_desk", "assistant_manager"].includes(roleLc);
}

function ffStaffDocAbortWithToast(msg) {
  ffToast(msg, "error");
  const e = new Error(String(msg));
  e.ffToastShown = true;
  return e;
}

/**
 * Firebase uid for chat: staff row may omit firebaseUid while salons/{sid}/members/{uid}
 * has staffId (written when the user opens Inbox / profile).
 */
async function ffResolveRecipientUidForChat(dbConn, salonId, staffFirestoreId, srow) {
  let uid = trimStr(srow.firebaseUid || srow.firebaseAuthUid || srow.authUid);
  if (uid) return uid;
  const sid = trimStr(salonId);
  const stid = trimStr(staffFirestoreId);
  if (!sid || !stid) return "";
  try {
    const q = query(
      collection(dbConn, "salons", sid, "members"),
      where("staffId", "==", stid),
      limit(3),
    );
    const snap = await getDocs(q);
    if (snap.empty) return "";
    if (snap.docs.length === 1) return trimStr(snap.docs[0].id);
    const byEmail = trimStr(srow.email || "").toLowerCase();
    if (byEmail) {
      for (const d of snap.docs) {
        const em = String(d.data()?.email || "")
          .trim()
          .toLowerCase();
        if (em && em === byEmail) return trimStr(d.id);
      }
    }
    return trimStr(snap.docs[0].id);
  } catch (e) {
    console.warn("[staff-documents] members lookup for recipient uid", e);
    return "";
  }
}

/**
 * Sends a 1:1 chat message to the staff member (Firebase uid on staff doc) reminding them
 * their document is expiring soon and to upload via Inbox.
 */
async function ffSendExpiryChatReminderFromStaffDoc({ salonId, staffId, docId }) {
  const sid = trimStr(salonId);
  const stid = trimStr(staffId);
  const did = trimStr(docId);
  const senderUid = auth.currentUser?.uid;
  if (!sid || !stid || !did || !senderUid) {
    throw ffStaffDocAbortWithToast("Missing context.");
  }

  const userSnap = await getDoc(doc(db, "users", senderUid));
  const role = String(userSnap.data()?.role || "").toLowerCase();
  if (!ffUserCanSendExpiryChatReminder(role)) {
    throw ffStaffDocAbortWithToast("Only managers can send this reminder.");
  }

  const staffSnap = await getDoc(doc(db, "salons", sid, "staff", stid));
  if (!staffSnap.exists()) {
    throw ffStaffDocAbortWithToast("Staff member not found.");
  }
  const srow = staffSnap.data() || {};
  let recipientUid = await ffResolveRecipientUidForChat(db, sid, stid, srow);
  recipientUid = trimStr(recipientUid);
  const recipientName = trimStr(srow.name) || "Staff";
  if (!recipientUid) {
    throw ffStaffDocAbortWithToast(
      "This person has not linked their login yet. They must sign in once before you can message them in chat.",
    );
  }
  if (recipientUid === senderUid) {
    throw ffStaffDocAbortWithToast("You cannot send this reminder to yourself.");
  }

  const docSnap = await getDoc(doc(db, "salons", sid, "staff", stid, "documents", did));
  if (!docSnap.exists()) {
    throw ffStaffDocAbortWithToast("Document not found.");
  }
  const d = docSnap.data() || {};
  const docType = trimStr(d.type) || "document";
  const expDate = toDateMaybe(d.expirationDate);
  const daysUntil = expDate ? calendarDaysUntilExpiry(expDate.getTime()) : 0;
  const dayLabel = daysUntil === 1 ? "day" : "days";
  const title = `${docType} — expiring soon`;
  let uploadLink = "";
  try {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://fairflowapp-db841.web.app";
    const u = new URL(origin);
    u.pathname = "/";
    u.searchParams.set("ffInboxUpload", "1");
    u.searchParams.set("docType", docType);
    u.searchParams.set("renewForDoc", did);
    uploadLink = u.toString();
  } catch (e) {
    console.warn("[staff-documents] upload deep link", e);
  }
  const message =
    `Your ${docType} is expiring in ${daysUntil} ${dayLabel}. Please upload a new version.` +
    (uploadLink ? `\n\nTap to open upload (same tab or new tab): ${uploadLink}` : "");

  const senderName =
    trimStr(userSnap.data()?.name || userSnap.data()?.displayName) || "Manager";
  const senderRole = trimStr(userSnap.data()?.role) || "";

  // Same shape as chat.js template sends — Firestore rules allow templateId+title (and message body).
  const STAFF_DOC_EXPIRY_TEMPLATE_ID = "ff_staff_doc_expiry_reminder";

  // Resolve the sender's current location so this reminder is scoped to the
  // same branch as the rest of their chat (mirrors chat.js _activeLocKey).
  let locKey = "default";
  try {
    if (typeof window !== "undefined") {
      if (typeof window.ffGetActiveLocationId === "function") {
        const v = window.ffGetActiveLocationId();
        if (typeof v === "string" && v.trim()) locKey = v.trim();
      } else if (typeof window.__ff_active_location_id === "string" && window.__ff_active_location_id.trim()) {
        locKey = window.__ff_active_location_id.trim();
      }
    }
  } catch (_) {}

  const pair = [senderUid, recipientUid].sort().join("__");
  const convId = locKey === "default" ? pair : `loc_${locKey}__${pair}`;
  const convRef = doc(db, `salons/${sid}/conversations`, convId);
  const msgRef = doc(collection(db, `salons/${sid}/conversations/${convId}/messages`));

  // Security rules evaluate each batch op against DB state *before* the batch runs.
  // Message create uses get(conversation).participants — so the conversation doc must
  // exist in a prior committed write, not in the same batch as the first message.
  const convSnap = await getDoc(convRef);
  if (!convSnap.exists()) {
    await setDoc(
      convRef,
      { participants: [senderUid, recipientUid].sort(), createdAt: serverTimestamp(), locationId: locKey },
      { merge: true },
    );
  }

  const batch = writeBatch(db);
  batch.set(msgRef, {
    templateId: STAFF_DOC_EXPIRY_TEMPLATE_ID,
    senderUid,
    senderName: String(senderName),
    senderRole: String(senderRole),
    recipientUid,
    recipientName: String(recipientName),
    sentAt: serverTimestamp(),
    readBy: [senderUid],
    title: String(title),
    message: String(message),
  });
  batch.set(
    convRef,
    {
      lastMessageAt: serverTimestamp(),
      lastMessageAtMs: Date.now(),
      lastTitle: title,
      lastMessage: message,
      lastSenderUid: senderUid,
      lastSenderName: senderName,
      lastSenderRole: senderRole,
      updatedAt: serverTimestamp(),
      updatedAtMs: Date.now(),
      unreadFor: { [recipientUid]: increment(1) },
    },
    { merge: true },
  );
  await batch.commit();
  ffToast("Chat reminder sent.", "success");
}

async function ffRunExpiryChatNotify(docId) {
  const did = trimStr(docId);
  const { salonId: sid0, staffId: st0 } = sdState._mountCtx;
  const dk = `${sid0}|${st0}|${did}`;
  const now0 = Date.now();
  if (dk === sdState._ffExpiryNotifyDedupe.key && now0 - sdState._ffExpiryNotifyDedupe.at < 1500) {
    ffToast("Reminder just sent. Try again in a moment.", "info");
    return false;
  }
  if (sdState._ffExpiryNotifyInFlight) {
    ffToast("Still sending the previous reminder…", "info");
    return false;
  }
  // Set immediately after checks — otherwise two parallel calls can both pass the guard and send twice.
  sdState._ffExpiryNotifyInFlight = true;
  try {
    ffToast("Sending reminder…", "info");
    if (!auth.currentUser) {
      ffToast("Sign in required.", "error");
      return false;
    }
    const { salonId, staffId } = sdState._mountCtx;
    if (!salonId || !staffId || !did) {
      ffToast("Missing context. Refresh the page.", "error");
      return false;
    }

    await ffSendExpiryChatReminderFromStaffDoc({ salonId, staffId, docId: did });
    sdState._ffExpiryNotifyDedupe = { key: dk, at: Date.now() };
    console.log("[staff-documents] Chat reminder flow finished (check toast + Chat).");
    return true;
  } catch (err) {
    console.warn("[staff-documents] expiry_chat_notify", err);
    if (!err?.ffToastShown) {
      const code = String(err?.code || "");
      const hint =
        code === "permission-denied"
          ? "Permission denied (chat). If this persists after refresh, contact support."
          : String(err?.message || err || "Could not send chat message.");
      ffToast(hint, "error");
    }
    return false;
  } finally {
    sdState._ffExpiryNotifyInFlight = false;
  }
}

/** Run the same expiry chat reminder as Staff → Documents, with explicit salon/staff (e.g. Inbox alert modal). */
export async function ffSendExpiryChatReminderForStaffDocContext({ salonId, staffId, docId }) {
  const sid = trimStr(salonId);
  const stid = trimStr(staffId);
  const did = trimStr(docId);
  const prevCtx = sdState._mountCtx;
  try {
    sdState._mountCtx = { salonId: sid, staffId: stid };
    await ffRunExpiryChatNotify(did);
  } finally {
    sdState._mountCtx = prevCtx;
  }
}

export { ffRunExpiryChatNotify };
