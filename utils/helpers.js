import {
  getFirestore,
  doc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

export async function updateLastActive(staffId) {
  try {
    if (!staffId) return;
    
    const salonId = (typeof window !== 'undefined' && window.currentSalonId)
      ? window.currentSalonId
      : (typeof globalThis !== 'undefined' ? globalThis.currentSalonId : null);
    
    if (!salonId) {
      console.warn('[updateLastActive] No salonId available');
      return;
    }
    
    const db = getFirestore();
    const staffRef = doc(db, 'salons', salonId, 'staff', staffId);
    
    await updateDoc(staffRef, {
      'activity.lastActiveAt': serverTimestamp()
    });
  } catch (e) {
    console.error('[updateLastActive] Error updating last active:', e);
  }
}
