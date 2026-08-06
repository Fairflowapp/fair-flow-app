// Sticky Notes — shift handover notes for the reception Live screen.
// Notes live at salons/{salonId}/stickyNotes and sync in real time so a note
// written by the morning shift appears instantly for the evening shift.
// Done notes are auto-deleted 24h after they were checked off, so the board
// cleans itself but the next shift still sees what was handled.
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

const DONE_NOTE_TTL_MS = 24 * 60 * 60 * 1000;
const NOTE_COLORS = ['yellow', 'red', 'lightred', 'lightyellow', 'sky', 'green', 'purple'];

let notesSalonId = null;
let notesUser = null;
let notesUnsub = null;
let stickyNotes = [];
const cleanupAttempted = new Set();

function cleanText(value) {
  return String(value || '').trim();
}

function reportNoteError(action, err) {
  console.warn(`[StickyNotes] ${action} failed`, err);
  if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
    window.ffToast.show(`${action} failed. Please try again.`, { variant: 'error', durationMs: 3200 });
  }
}

async function resolveNotesSalonId(user) {
  const activeSalonId = typeof window !== 'undefined' && window.currentSalonId
    ? String(window.currentSalonId).trim()
    : '';
  if (activeSalonId) return activeSalonId;
  if (!user) return '';
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    return snap.exists() ? String(snap.data()?.salonId || '').trim() : '';
  } catch (err) {
    console.warn('[StickyNotes] resolve salon failed', err);
    return '';
  }
}

function currentNoteAuthorName() {
  try {
    if (typeof window.ffResolveCurrentStaffRowFromFfStaffV1 === 'function') {
      const row = window.ffResolveCurrentStaffRowFromFfStaffV1();
      const name = cleanText(row?.name || row?.staffName || row?.displayName || row?.fullName);
      if (name) return name;
    }
  } catch (_) {}
  return cleanText(window.__ff_authedStaffName || sessionStorage.getItem('ff_actor_name') || notesUser?.displayName) || 'Team';
}

function refreshLiveNotesCard() {
  if (typeof window.ffLiveRefreshNotesCard === 'function') {
    try { window.ffLiveRefreshNotesCard(); } catch (_eLive) {}
  }
}

// Delete done notes whose doneAtMs is older than the TTL. Runs on every
// snapshot; the attempted-set prevents retry loops when a delete is rejected.
function cleanupExpiredDoneNotes() {
  const cutoff = Date.now() - DONE_NOTE_TTL_MS;
  stickyNotes.forEach((note) => {
    if (!note.done) return;
    const doneAtMs = Number(note.doneAtMs) || 0;
    if (!doneAtMs || doneAtMs > cutoff) return;
    if (cleanupAttempted.has(note.id)) return;
    cleanupAttempted.add(note.id);
    deleteDoc(doc(db, `salons/${notesSalonId}/stickyNotes`, note.id))
      .catch((err) => console.warn('[StickyNotes] auto-cleanup failed', err));
  });
}

function subscribeStickyNotes() {
  if (!notesSalonId) return;
  if (notesUnsub) notesUnsub();
  notesUnsub = onSnapshot(
    query(collection(db, `salons/${notesSalonId}/stickyNotes`), orderBy('createdAtMs', 'desc')),
    (snap) => {
      stickyNotes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      cleanupExpiredDoneNotes();
      refreshLiveNotesCard();
    },
    (err) => console.warn('[StickyNotes] subscription failed', err)
  );
}

function requireNotesContext() {
  if (!notesSalonId) {
    if (typeof window.ffToast === 'object' && window.ffToast && typeof window.ffToast.show === 'function') {
      window.ffToast.show('Notes are still loading. Try again in a moment.', { variant: 'info', durationMs: 2200 });
    }
    return false;
  }
  return true;
}

// Live screen reads the current notes list for its card.
window.ffGetStickyNotes = function () {
  return Array.isArray(stickyNotes) ? stickyNotes.slice() : [];
};

window.ffStickyNoteAdd = async function (text, color) {
  if (!requireNotesContext()) return false;
  const body = cleanText(text);
  if (!body) return false;
  const noteColor = NOTE_COLORS.includes(color) ? color : 'yellow';
  try {
    await addDoc(collection(db, `salons/${notesSalonId}/stickyNotes`), {
      text: body,
      color: noteColor,
      done: false,
      createdAt: serverTimestamp(),
      createdAtMs: Date.now(),
      createdByUid: notesUser?.uid || null,
      createdByName: currentNoteAuthorName()
    });
    return true;
  } catch (err) {
    reportNoteError('Add note', err);
    return false;
  }
};

window.ffStickyNoteToggleDone = async function (noteId) {
  if (!requireNotesContext()) return false;
  const note = stickyNotes.find((item) => item.id === noteId);
  if (!note) return false;
  const nextDone = !note.done;
  try {
    await updateDoc(doc(db, `salons/${notesSalonId}/stickyNotes`, noteId), {
      done: nextDone,
      doneAt: nextDone ? serverTimestamp() : null,
      doneAtMs: nextDone ? Date.now() : null,
      doneByUid: nextDone ? (notesUser?.uid || null) : null,
      doneByName: nextDone ? currentNoteAuthorName() : null
    });
    return true;
  } catch (err) {
    reportNoteError('Update note', err);
    return false;
  }
};

window.ffStickyNoteDelete = async function (noteId) {
  if (!requireNotesContext()) return false;
  if (!noteId) return false;
  try {
    await deleteDoc(doc(db, `salons/${notesSalonId}/stickyNotes`, noteId));
    return true;
  } catch (err) {
    reportNoteError('Delete note', err);
    return false;
  }
};

onAuthStateChanged(auth, async (user) => {
  notesUser = user || null;
  if (!user) {
    notesSalonId = null;
    stickyNotes = [];
    refreshLiveNotesCard();
    return;
  }
  const salonId = await resolveNotesSalonId(user);
  if (!salonId) return;
  if (notesSalonId === salonId) return;
  notesSalonId = salonId;
  subscribeStickyNotes();
});

setTimeout(async () => {
  if (notesSalonId || !auth.currentUser) return;
  const salonId = await resolveNotesSalonId(auth.currentUser);
  if (!salonId) return;
  notesUser = auth.currentUser;
  notesSalonId = salonId;
  subscribeStickyNotes();
}, 2500);
