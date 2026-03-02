console.log("[CLIENT BOOT] app.js v=20260205_3 loaded");
console.log("FF APP.JS LOADED", new Date().toISOString(), "search=", location.search);
console.log('[BUILD MARKER] app.js loaded', new Date().toISOString());

if (!window.__ff_authedStaffId) {
  window.__ff_authedStaffId = localStorage.getItem("ff_authedStaffId_v1") || null;
}

// Migration: Move yearly done entries from old key to standard key
(function migrateYearlyDoneStorage() {
  try {
    const oldKey = 'ff_tasks_yearly_done_v1';
    const standardKey = (typeof getTabStorageKey === 'function')
      ? getTabStorageKey('yearly', 'done')
      : 'ff_tasks_yearly_done_v1';
    
    // Only migrate if keys are different and old key exists
    if (oldKey !== standardKey) {
      const oldData = localStorage.getItem(oldKey);
      const standardData = localStorage.getItem(standardKey);
      
      if (oldData && (!standardData || JSON.parse(standardData || '[]').length === 0)) {
        // Move/merge entries from old key to standard key
        const oldList = JSON.parse(oldData);
        const standardList = JSON.parse(standardData || '[]');
        
        // Merge: add entries from old list that don't exist in standard list
        const standardIds = new Set(standardList.map(t => String(t.taskId || t.id || '').trim()));
        oldList.forEach(oldTask => {
          const oldId = String(oldTask.taskId || oldTask.id || '').trim();
          if (oldId && !standardIds.has(oldId)) {
            standardList.push(oldTask);
            standardIds.add(oldId);
          }
        });
        
        // Save to standard key
        localStorage.setItem(standardKey, JSON.stringify(standardList));
        console.log('[Migration] Moved yearly done entries from', oldKey, 'to', standardKey, `(${standardList.length} entries)`);
        
        // Delete old key
        localStorage.removeItem(oldKey);
        console.log('[Migration] Deleted old yearly done key:', oldKey);
      }
    }
  } catch (e) {
    console.warn('[Migration] Error migrating yearly done storage:', e);
  }
})();

// =====================
// Global Error Logging
// =====================
window.addEventListener("error", (e) => {
  console.error("GLOBAL ERROR:", e.message, e.error);
  console.error("Error stack:", e.error?.stack);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("PROMISE REJECTION:", e.reason);
  console.error("Rejection stack:", e.reason?.stack);
});

// =====================
// Firebase imports
// =====================
import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  signInAnonymously
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-storage.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  collectionGroup,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
  getFunctions,
  httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-functions.js";

// =====================
// Firebase config
// =====================
const firebaseConfig = {
  apiKey: "AIzaSyCoj6A2Eoa0uDrelIJxycZCL6cTw570FCI",
  authDomain: "fairflowapp-db841.firebaseapp.com",
  projectId: "fairflowapp-db841",
  storageBucket: "fairflowapp-db841.firebasestorage.app",
  messagingSenderId: "823186963319",
  appId: "1:823186963319:web:2bc2d386311b2898643f72",
  measurementId: "G-S7T9WN343B"
};

// =====================
// Init
// =====================
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
window.__ffAuth = auth;
window.__ffGetUid = () => auth.currentUser?.uid || null;
export const db = getFirestore(app);
window.ffDb = db;   // expose for non-module scripts (staff cloud sync)

// Set currentSalonId globally when user logs in (used by staff invite + staff cloud sync)
onAuthStateChanged(auth, async user => {
  if (!user) { window.currentSalonId = null; return; }
  try {
    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js");
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      window.currentSalonId = snap.data().salonId || null;
      console.log('[app.js] currentSalonId set:', window.currentSalonId);
    }
  } catch(e) { console.warn('[app.js] Failed to set currentSalonId', e); }
});

console.log("[CLIENT] Firebase functions SDK available:", typeof firebase !== "undefined");
const functions = getFunctions(app, "us-central1");
const storage = getStorage(app);
export { storage };

// Ensure we have an auth user (anonymous if needed) for HTTP callable invocations under domain-restricted sharing
async function ensureSignedIn() {
  if (!auth.currentUser) {
    const cred = await signInAnonymously(auth);
    console.log("[Invite] anonymous sign-in uid:", cred?.user?.uid || null);
  }
}

function waitForAuthReady() {
  return new Promise(resolve => {
    const unsub = onAuthStateChanged(auth, user => {
      if (user) {
        unsub();
        resolve(user);
      }
    });
  });
}

/** Sends staff invite via Firestore write – no HTTP/Callable, no CORS. Trigger processes in backend. */
export async function callSendStaffInvite(payload) {
  try {
    await ensureSignedIn();
    const user = auth.currentUser || await waitForAuthReady();
    if (!user) throw new Error("Not signed in");
    const docData = {
      createdByUid: user.uid,
      salonId: payload.salonId,
      staffId: payload.staffId || null,
      email: payload.email,
      role: payload.role,
      status: "pending",
      createdAt: serverTimestamp()
    };
    const ref = await addDoc(collection(db, "staffInviteRequests"), docData);
    console.log("[Invite] request created", ref.id);
    await addDoc(collection(db, "processInviteNow"), { requestId: ref.id, createdAt: serverTimestamp() });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsub();
        resolve({ ok: true, requestId: ref.id, data: { success: true } });
      }, 90000);
      const unsub = onSnapshot(
        doc(db, "staffInviteRequests", ref.id),
        (snap) => {
          const s = snap.data()?.status;
          if (s === "done") {
            clearTimeout(timeout);
            unsub();
            resolve({ ok: true, requestId: ref.id, data: { success: true } });
          } else if (s === "error") {
            clearTimeout(timeout);
            unsub();
            reject(new Error(snap.data()?.error || "Unknown error"));
          }
        },
        (err) => {
          clearTimeout(timeout);
          unsub();
          reject(err);
        }
      );
    });
  } catch (err) {
    console.error("[Invite] sendStaffInvite error", err?.code, err?.message, err);
    throw err;
  }
}
window.callSendStaffInvite = callSendStaffInvite;

console.log("[Init] Firebase initialized");

// =====================
// Invite mode detection (pre-DOM)
// =====================
let ffInviteTokenFromUrl = new URLSearchParams(window.location.search).get("invite");
if (!ffInviteTokenFromUrl && window.location.pathname.startsWith("/create-password/")) {
  const parts = window.location.pathname.split("/").filter(Boolean);
  if (parts[0] === "create-password" && parts[1]) {
    ffInviteTokenFromUrl = parts[1];
  }
}
window.__ffInviteToken = ffInviteTokenFromUrl;
window.__ffInviteModeActive = Boolean(ffInviteTokenFromUrl);
window.__ffInviteFinalized = false;

// Global variable to store current salon ID
let currentSalonId = null;

// Helper to generate default admin PIN
function generateDefaultAdminPin() {
  return String(Math.floor(1000 + Math.random() * 9000)); // 4 digits
}

// =====================
// UI helpers
// =====================
function showLoginError(msg) {
  const el = document.getElementById("login-error");
  if (el) el.textContent = msg || "";
}

function showSignupError(msg) {
  const el = document.getElementById("signup-error");
  if (el) el.textContent = msg || "";
}

// =====================
// Invite flow helpers
// =====================
async function ffSha256Hex(str) {
  const enc = new TextEncoder();
  const bytes = enc.encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ffFinalizeInvite(inviteToken, user) {
  if (!inviteToken || !user) return;
  if (window.__ffInviteFinalized) return;
  window.__ffInviteFinalized = true;
  window.__ffInviteModeActive = false;
  document.body.classList.remove("ff-invite-mode");

  console.log("[INVITE] token:", inviteToken, "email:", user.email, "uid:", user.uid);

  try {
    history.replaceState({}, "", window.location.pathname);
  } catch (e) {
    console.warn("[Invite] Failed to clean URL", e);
  }

  const root = document.getElementById("ffInviteRoot");
  if (root) root.remove();

  // Reload once to enter the normal app flow
  setTimeout(() => {
    window.location.reload();
  }, 50);
}

async function ffLoadInviteByToken(inviteToken) {
  if (!inviteToken) {
    return { ok: false, error: "Missing invite token." };
  }
  try {
    const inviteTokenHash = await ffSha256Hex(inviteToken);
    const inviteRef = doc(db, "staffInviteTokens", inviteTokenHash);
    const snap = await getDoc(inviteRef);
    if (!snap.exists()) {
      return { ok: false, error: "Invite invalid or expired." };
    }
    const data = snap.data ? snap.data() : {};
    if (!data) {
      return { ok: false, error: "Invite not found or expired." };
    }
    if (data.used === true) {
      return { ok: false, error: "Invite already used." };
    }
    if (data.status && data.status !== "pending") {
      return { ok: false, error: "Invite already used." };
    }
    if (data.usedAt) {
      return { ok: false, error: "Invite already used." };
    }
    if (data.expiresAt && typeof data.expiresAt.toMillis === "function") {
      if (data.expiresAt.toMillis() < Date.now()) {
        return { ok: false, error: "Invite expired." };
      }
    }
    const emailLower = String(data.emailLower || data.email || "").trim();
    if (!emailLower) {
      return { ok: false, error: "Invite email missing." };
    }
    return { ok: true, invite: { ...data, emailLower } };
  } catch (e) {
    console.error("[Invite] Failed to load invite", e);
    return { ok: false, error: "Failed to load invite." };
  }
}

function ffShowInviteFlow(inviteToken) {
  if (!inviteToken) return;
  if (document.getElementById("ffInviteRoot")) return;

  window.__ffInviteModeActive = true;
  document.body.classList.add("ff-invite-mode");

  const root = document.createElement("div");
  root.id = "ffInviteRoot";
  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.background = "rgba(248, 249, 252, 0.98)";
  root.style.zIndex = "999999";
  root.style.display = "flex";
  root.style.alignItems = "center";
  root.style.justifyContent = "center";
  root.style.padding = "24px";
  root.style.pointerEvents = "auto";

  const card = document.createElement("div");
  card.style.background = "#ffffff";
  card.style.border = "1px solid #e5e7eb";
  card.style.borderRadius = "12px";
  card.style.boxShadow = "0 10px 30px rgba(0, 0, 0, 0.08)";
  card.style.padding = "24px";
  card.style.width = "100%";
  card.style.maxWidth = "420px";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.gap = "12px";
  card.style.pointerEvents = "auto";

  const title = document.createElement("h2");
  title.textContent = "Create Password";
  title.style.margin = "0";
  title.style.fontSize = "20px";

  const subtitle = document.createElement("p");
  subtitle.textContent = "Create a password to finish your invite.";
  subtitle.style.margin = "0";
  subtitle.style.color = "#4b5563";
  subtitle.style.fontSize = "14px";

  const formEl = document.createElement("div");
  formEl.style.display = "flex";
  formEl.style.flexDirection = "column";
  formEl.style.gap = "10px";

  const emailInput = document.createElement("input");
  emailInput.type = "email";
  emailInput.placeholder = "Email";
  emailInput.autocomplete = "email";
  emailInput.style.width = "100%";
  emailInput.style.padding = "10px 12px";
  emailInput.style.border = "1px solid #d1d5db";
  emailInput.style.borderRadius = "8px";
  emailInput.style.fontSize = "14px";
  emailInput.readOnly = true;
  emailInput.style.pointerEvents = "auto";

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.placeholder = "Password";
  passwordInput.autocomplete = "new-password";
  passwordInput.style.width = "100%";
  passwordInput.style.padding = "10px 12px";
  passwordInput.style.border = "1px solid #d1d5db";
  passwordInput.style.borderRadius = "8px";
  passwordInput.style.fontSize = "14px";
  passwordInput.style.pointerEvents = "auto";

  const confirmInput = document.createElement("input");
  confirmInput.type = "password";
  confirmInput.placeholder = "Confirm Password";
  confirmInput.autocomplete = "new-password";
  confirmInput.style.width = "100%";
  confirmInput.style.padding = "10px 12px";
  confirmInput.style.border = "1px solid #d1d5db";
  confirmInput.style.borderRadius = "8px";
  confirmInput.style.fontSize = "14px";
  confirmInput.style.pointerEvents = "auto";

  const primaryBtn = document.createElement("button");
  primaryBtn.type = "button";
  primaryBtn.textContent = "Create password";
  primaryBtn.style.width = "100%";
  primaryBtn.style.padding = "10px 12px";
  primaryBtn.style.borderRadius = "8px";
  primaryBtn.style.border = "1px solid #111827";
  primaryBtn.style.background = "#111827";
  primaryBtn.style.color = "#ffffff";
  primaryBtn.style.cursor = "pointer";
  primaryBtn.style.pointerEvents = "auto";

  const errorEl = document.createElement("div");
  errorEl.style.color = "#b91c1c";
  errorEl.style.fontSize = "13px";
  errorEl.style.minHeight = "18px";

  const loadingEl = document.createElement("div");
  loadingEl.textContent = "Loading invite...";
  loadingEl.style.color = "#4b5563";
  loadingEl.style.fontSize = "12px";
  loadingEl.style.display = "block";

  function setLoading(isLoading, text) {
    loadingEl.textContent = text || "Finalizing your access...";
    loadingEl.style.display = isLoading ? "block" : "none";
    primaryBtn.disabled = isLoading;
    emailInput.disabled = isLoading;
    passwordInput.disabled = isLoading;
    confirmInput.disabled = isLoading;
  }

  function setError(message) {
    errorEl.textContent = message || "";
  }

  let inviteEmail = "";
  let mode = "create";

  function setMode(nextMode) {
    mode = nextMode === "signin" ? "signin" : "create";
    if (mode === "signin") {
      title.textContent = "Sign in";
      subtitle.textContent = "This email already has an account. Sign in to accept the invite.";
      confirmInput.style.display = "none";
      primaryBtn.textContent = "Sign in";
      passwordInput.autocomplete = "current-password";
    } else {
      title.textContent = "Create Password";
      subtitle.textContent = "Create a password to finish your invite.";
      confirmInput.style.display = "block";
      primaryBtn.textContent = "Create password";
      passwordInput.autocomplete = "new-password";
    }
  }

  async function handlePrimaryAction() {
    const email = emailInput.value.trim();
    const password = passwordInput.value || "";
    const confirm = confirmInput.value || "";
    if (!email || !password) {
      setError("Please enter your password.");
      return;
    }
    if (mode === "create" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setError("");
    setLoading(true, "Loading...");

    try {
      const credential = mode === "signin"
        ? await signInWithEmailAndPassword(auth, email, password)
        : await createUserWithEmailAndPassword(auth, email, password);

      setLoading(true, "Finalizing your access...");
      try {
        // Write to Firestore → trigger will process (bypasses IAM/callable issues)
        console.log("[Invite] Writing to finalizeInviteRequests");
        const requestRef = await addDoc(collection(db, "finalizeInviteRequests"), {
          inviteToken: inviteToken,
          uid: credential.user.uid,
          email: email,
          createdAt: serverTimestamp()
        });
        console.log("[Invite] Request created", requestRef.id);
        
        // Wait for trigger to process (listen for status change)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsub();
            reject(new Error("Finalize timeout - please refresh and try signing in"));
          }, 90000); // 90 second timeout (cold starts can be slow)
          
          const unsub = onSnapshot(
            doc(db, "finalizeInviteRequests", requestRef.id),
            (snap) => {
              const s = snap.data()?.status;
              if (s === "done") {
                clearTimeout(timeout);
                unsub();
                console.log("[Invite] Finalize success");
                resolve();
              } else if (s === "error") {
                clearTimeout(timeout);
                unsub();
                const errorMsg = snap.data()?.error || "Unknown error";
                console.error("[Invite] Finalize failed", errorMsg);
                reject(new Error(errorMsg));
              }
            },
            (err) => {
              clearTimeout(timeout);
              unsub();
              reject(err);
            }
          );
        });
      } catch (finalizeErr) {
        const msg = finalizeErr?.message || String(finalizeErr);
        console.error("[Invite] Finalize failed", { message: msg });
        alert(`Invite finalize failed: ${msg}`);
        setLoading(false);
        setError("Invite finalize failed. Please try again or contact the owner.");
        return;
      }

      ffFinalizeInvite(inviteToken, credential.user);
    } catch (err) {
      console.error("[Invite] Auth error", err);
      if (err?.code === "auth/email-already-in-use") {
        setMode("signin");
        setLoading(false);
        setError("Account already exists. Please sign in.");
        return;
      }
      setLoading(false);
      setError(err?.message || "Authentication failed. Please try again.");
    }
  }

  primaryBtn.addEventListener("click", handlePrimaryAction);

  card.appendChild(title);
  card.appendChild(subtitle);
  formEl.appendChild(emailInput);
  formEl.appendChild(passwordInput);
  formEl.appendChild(confirmInput);
  formEl.appendChild(primaryBtn);
  card.appendChild(formEl);
  card.appendChild(errorEl);
  card.appendChild(loadingEl);

  root.appendChild(card);
  document.body.appendChild(root);

  async function loadInvite() {
    loadingEl.textContent = "Loading invite...";
    loadingEl.style.display = "block";
    formEl.style.display = "none";
    try {
      const result = await ffLoadInviteByToken(inviteToken);
      if (!result.ok) {
        title.textContent = "Invite issue";
        subtitle.textContent = result.error || "Invite not found or expired.";
        formEl.style.display = "none";
        loadingEl.style.display = "none";
        return;
      }
      inviteEmail = result.invite?.emailLower || result.invite?.email || "";
      emailInput.value = inviteEmail;
      formEl.style.display = "flex";
      loadingEl.style.display = "none";
      setMode("create");
    } catch (e) {
      console.error("[Invite] Load error", e);
      title.textContent = "Invite issue";
      subtitle.textContent = "Invite not found or expired.";
      formEl.style.display = "none";
      loadingEl.style.display = "none";
    }
  }

  loadInvite();
}

// =====================
// Image upload helpers
// =====================
function ffInferImageExtension(file) {
  const type = (file?.type || "").toLowerCase();
  if (type.includes("png")) return "png";
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

function ffAssertImageFile(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) {
    throw new Error("Invalid image file");
  }
}

async function ffUploadSalonBrandLogo({ salonId, file }) {
  if (!salonId) throw new Error("Missing salonId");
  ffAssertImageFile(file);
  const ext = ffInferImageExtension(file);
  const path = `salons/${salonId}/brand/logo.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return { url, path };
}

async function ffUploadStaffAvatar({ salonId, staffId, file }) {
  ffAssertImageFile(file);
  const ext = ffInferImageExtension(file);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Not authenticated");
  const path = `users/${uid}/avatar.${ext}`;
  const fileRef = storageRef(storage, path);
  await uploadBytes(fileRef, file);
  const url = await getDownloadURL(fileRef);
  return { url, path };
}

async function ffSaveSalonLogoMeta({ salonId, url, path }) {
  if (!salonId) throw new Error("Missing salonId");
  await updateDoc(doc(db, "salons", salonId), {
    brandLogoUrl: url,
    brandLogoPath: path,
    brandLogoUpdatedAtMs: Date.now()
  });
}

async function ffSaveStaffAvatarMeta({ url, path }) {
  const userId = (auth?.currentUser?.uid) || null;
  if (!userId) throw new Error("Missing userId");
  const avatarUpdatedAtMs = Date.now();
  await updateDoc(doc(db, "users", userId), {
    avatarUrl: url,
    avatarPath: path,
    avatarUpdatedAtMs
  });
  try {
    if (typeof window !== "undefined" && typeof window.ffApplyAvatarFromFirestore === "function") {
      window.ffApplyAvatarFromFirestore({ avatarUrl: url, avatarUpdatedAtMs, avatarPath: path });
    }
  } catch (e) {
    console.warn("[Avatar] Failed to apply avatar after update:", e);
  }
}

function ffStartAvatarListener(userId) {
  if (!userId) return;
  try {
    if (window.__ff_avatarUnsub) {
      window.__ff_avatarUnsub();
      window.__ff_avatarUnsub = null;
    }
  } catch (e) {
    console.warn("[Avatar] Failed to remove previous listener:", e);
  }
  const userDocRef = doc(db, "users", userId);
  window.__ff_avatarUnsub = onSnapshot(
    userDocRef,
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data() || {};
      const avatarUrl = data.avatarUrl || null;
      const avatarUpdatedAtMs = data.avatarUpdatedAtMs || null;
      const avatarPath = data.avatarPath || null;
      try {
        if (avatarUrl) {
          localStorage.setItem("ff_user_avatar_url_v1", avatarUrl);
        } else {
          localStorage.removeItem("ff_user_avatar_url_v1");
        }
        if (avatarUpdatedAtMs) {
          localStorage.setItem("ff_user_avatar_updated_at_v1", String(avatarUpdatedAtMs));
        } else {
          localStorage.removeItem("ff_user_avatar_updated_at_v1");
        }
      } catch (e) {
        console.warn("[Avatar] Failed to update cached avatar meta:", e);
      }
      if (typeof window !== "undefined" && typeof window.ffApplyAvatarFromFirestore === "function") {
        window.ffApplyAvatarFromFirestore({ avatarUrl, avatarUpdatedAtMs, avatarPath });
      } else if (typeof window !== "undefined") {
        window.__ff_avatarMeta = { avatarUrl, avatarUpdatedAtMs, avatarPath };
      }
    },
    (error) => {
      console.warn("[Avatar] Listener error:", error);
    }
  );
}

// =====================
// UI helpers for showing/hiding views
// =====================
function hideAuthScreens() {
  const loginSection = document.getElementById("login-section");
  const signupSection = document.getElementById("signup-section");
  const resetSection = document.getElementById("reset-password-section");
  if (loginSection) loginSection.style.display = "none";
  if (signupSection) signupSection.style.display = "none";
  if (resetSection) resetSection.style.display = "none";
}

function showLoginScreen() {
  const loginSection = document.getElementById("login-section");
  const signupSection = document.getElementById("signup-section");
  const resetSection = document.getElementById("reset-password-section");
  const mainApp = document.getElementById("main-app-content");
  const inboxScreen = document.getElementById("inboxScreen");
  const tasksScreen = document.getElementById("tasksScreen");
  if (loginSection) loginSection.style.display = "block";
  if (signupSection) signupSection.style.display = "none";
  if (resetSection) resetSection.style.display = "none";
  if (mainApp) mainApp.style.display = "none";
  if (inboxScreen) inboxScreen.style.display = "none";
  if (tasksScreen) tasksScreen.style.display = "none";
}

function showResetPasswordScreen() {
  const loginSection = document.getElementById("login-section");
  const signupSection = document.getElementById("signup-section");
  const resetSection = document.getElementById("reset-password-section");
  const mainApp = document.getElementById("main-app-content");

  if (loginSection) loginSection.style.display = "none";
  if (signupSection) signupSection.style.display = "none";
  if (mainApp) mainApp.style.display = "none";
  if (resetSection) resetSection.style.display = "block";

  // clear messages
  const resetError = document.getElementById("reset-error");
  const resetSuccess = document.getElementById("reset-success");
  if (resetError) resetError.textContent = "";
  if (resetSuccess) resetSuccess.textContent = "";
}

function showMainAppForRole(role) {
  const mainApp = document.getElementById("main-app-content");
  const ownerView = document.getElementById("owner-view");
  const receptionView = document.getElementById("reception-view");
  const staffView = document.getElementById("staff-view");

  if (!mainApp) {
    console.warn("[UI] main-app-content not found");
    return;
  }

  // hide auth
  hideAuthScreens();

  // show wrapper
  mainApp.style.display = "block";

  // hide all role views first
  if (ownerView) ownerView.style.display = "none";
  if (receptionView) receptionView.style.display = "none";
  if (staffView) staffView.style.display = "none";

  // show the right view
  if (role === "owner" && ownerView) {
    ownerView.style.display = "block";
    // Initialize dropdown when owner view becomes visible
    setTimeout(() => {
      if (typeof window.renderSelect === 'function') {
        console.log("[UI] Owner view shown, calling renderSelect");
        window.renderSelect();
      }
      if (typeof window.init === 'function') {
        console.log("[UI] Owner view shown, calling init");
        window.init();
      }
    }, 300);
  } else if (role === "reception" && receptionView) {
    receptionView.style.display = "block";
  } else if (role === "staff" && staffView) {
    staffView.style.display = "block";
  } else {
    console.warn("[UI] Unknown role, falling back to owner view:", role);
    if (ownerView) {
      ownerView.style.display = "block";
      // Initialize dropdown when owner view becomes visible
      setTimeout(() => {
        if (typeof window.renderSelect === 'function') {
          console.log("[UI] Owner view shown (fallback), calling renderSelect");
          window.renderSelect();
        }
        if (typeof window.init === 'function') {
          console.log("[UI] Owner view shown (fallback), calling init");
          window.init();
        }
      }, 300);
    }
  }
}

// =====================
// Toggle login <-> signup
// =====================
function switchToLogin() {
  showLoginScreen();
}

function switchToSignup() {
  const loginSection = document.getElementById("login-section");
  const signupSection = document.getElementById("signup-section");
  if (loginSection) loginSection.style.display = "none";
  if (signupSection) signupSection.style.display = "block";
}

// =====================
// Owner signup flow
// =====================
async function handleOwnerSignup() {
  showSignupError("");

  const businessNameEl = document.getElementById("signup-business-name");
  const ownerNameEl = document.getElementById("signup-owner-name");
  const emailEl = document.getElementById("signup-email");
  const passEl = document.getElementById("signup-password");
  const pass2El = document.getElementById("signup-password-confirm");

  const businessName = businessNameEl?.value.trim();
  const ownerName = ownerNameEl?.value.trim();
  const email = emailEl?.value.trim();
  const password = passEl?.value;
  const passwordConfirm = pass2El?.value;

  if (!businessName || !ownerName || !email || !password || !passwordConfirm) {
    showSignupError("Please fill all fields.");
    return;
  }
  if (password.length < 6) {
    showSignupError("Password must be at least 6 characters.");
    return;
  }
  if (password !== passwordConfirm) {
    showSignupError("Passwords do not match.");
    return;
  }

  try {
    console.log("[SignUp] Creating auth user for:", email);
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const user = cred.user;

    console.log("[SignUp] Auth user created:", user.uid);

    // create salon (business) document
    const generatedPin = generateDefaultAdminPin();
    const salonsRef = collection(db, "salons");
    const salonDocRef = await addDoc(salonsRef, {
      name: businessName,
      ownerUid: user.uid,
      adminPin: generatedPin,
      createdAt: serverTimestamp(),
      plan: "trial",
      status: "active"
    });

    console.log("[SignUp] Salon doc created:", salonDocRef.id);

    // create user profile document with role "owner"
    const userDocRef = doc(db, "users", user.uid);
    await setDoc(userDocRef, {
      role: "owner",
      salonId: salonDocRef.id,
      name: ownerName,
      email,
      createdAt: serverTimestamp()
    });

    console.log("[SignUp] User profile created:", user.uid);

    // After sign up, automatically navigate to owner view
    await loadUserRoleAndShowView(user);
  } catch (err) {
    console.error("[SignUp] Failed to create owner", err);
    showSignupError(err.message || "Sign up failed.");
  }
}

// =====================
// Email login flow
// =====================
async function handleEmailLogin() {
  showLoginError("");

  const emailEl = document.getElementById("login-email");
  const passEl = document.getElementById("login-password");

  const email = emailEl?.value.trim();
  const password = passEl?.value;

  if (!email || !password) {
    showLoginError("Please enter email and password.");
    return;
  }

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const user = cred.user;
    console.log("[Login] Signed in:", user.uid);

    // Clear any previous error
    showLoginError("");

    await loadUserRoleAndShowView(user);
  } catch (err) {
    console.error("[Login] Error", err);
    
    // Map Firebase error codes to user-friendly messages
    let message = "Email or password is incorrect. Please try again.";
    
    if (err.code === "auth/user-disabled") {
      message = "This account has been disabled. Please contact the owner.";
    } else if (err.code === "auth/too-many-requests") {
      message = "Too many attempts. Please wait a moment and try again.";
    } else if (err.code === "auth/invalid-credential") {
      message = "Email or password is incorrect. Please try again.";
    } else if (err.code === "auth/invalid-email") {
      message = "Invalid email address. Please check and try again.";
    } else if (err.code === "auth/user-not-found") {
      message = "No account found with this email address.";
    } else if (err.code === "auth/wrong-password") {
      message = "Incorrect password. Please try again.";
    } else if (err.code === "auth/network-request-failed") {
      message = "Network error. Please check your connection and try again.";
    }
    
    // Show only our custom message, not the raw Firebase error
    showLoginError(message);
  }
}

// =====================
// Google login flow
// =====================
async function handleGoogleLogin() {
  showLoginError("");
  const provider = new GoogleAuthProvider();

  try {
    const cred = await signInWithPopup(auth, provider);
    const user = cred.user;
    console.log("[Login] Google signed in:", user.uid);

    // Clear any previous error
    showLoginError("");

    await loadUserRoleAndShowView(user);
  } catch (err) {
    console.error("[Login] Google error", err);
    
    // Map Firebase error codes to user-friendly messages for Google login
    let message = "Google sign-in failed. Please try again.";
    
    if (err.code === "auth/popup-closed-by-user") {
      message = "Sign-in was cancelled. Please try again.";
    } else if (err.code === "auth/popup-blocked") {
      message = "Popup was blocked. Please allow popups and try again.";
    } else if (err.code === "auth/network-request-failed") {
      message = "Network error. Please check your connection and try again.";
    } else if (err.code === "auth/account-exists-with-different-credential") {
      message = "An account already exists with this email. Please use a different sign-in method.";
    }
    
    // Show only our custom message, not the raw Firebase error
    showLoginError(message);
  }
}

// =====================
// Load user role and show view
// =====================
async function loadUserRoleAndShowView(user) {
  try {
    const userDocRef = doc(db, "users", user.uid);
    const snap = await getDoc(userDocRef);

    if (!snap.exists()) {
      console.warn("[Auth] No user profile found for", user.uid);
      alert("No user profile found. Please contact your business owner.");
      // stay on login screen
      showLoginScreen();
      return;
    }

    const data = snap.data();
    const role = data.role || "owner";
    console.log("[Auth] Loaded user role:", role, "for uid:", user.uid);

    // Set admin cache immediately so Chat gear & Tasks Settings work without delay
    if (typeof window !== 'undefined') {
      window.ff_is_admin_cached = ['owner','admin'].includes((role||'').toLowerCase());
    }
    
    try {
      localStorage.removeItem("ff_user_avatar_v1");
    } catch (e) {
      console.warn("[Auth] Error clearing legacy avatar cache:", e);
    }

    ffStartAvatarListener(user.uid);

    // Store salonId for later use
    currentSalonId = data.salonId || null;
    // Update global reference
    if (typeof window !== 'undefined') {
      window.currentSalonId = currentSalonId;
    }

    // If owner, load salon document and update admin PIN
    if (role === "owner" && currentSalonId) {
      try {
        const salonDocRef = doc(db, "salons", currentSalonId);
        const salonSnap = await getDoc(salonDocRef);
        if (salonSnap.exists()) {
          const salonData = salonSnap.data();
          const adminPin = salonData.adminPin;
          if (adminPin) {
            // Update the in-memory settings.adminCode
            if (typeof window !== "undefined" && window.settings) {
              window.settings.adminCode = adminPin;
              // Also save to localStorage if the save function exists
              if (typeof window.save === "function") {
                window.save();
              } else if (typeof window.ls === "function") {
                window.ls("ffv24_settings", window.settings);
              }
            }
            console.log("[Auth] Loaded admin PIN from salon document");
          }
        }
      } catch (err) {
        console.error("[Auth] Failed to load salon document:", err);
      }
    }

    showMainAppForRole(role);
    
    // Reinitialize all buttons after view is shown
    if (role === "owner") {
      setTimeout(() => {
        try {
          // Reinitialize JOIN button
          if (typeof window.initializeJoinButton === 'function') {
            window.initializeJoinButton();
          } else {
            // Fallback: direct initialization
            const joinBtn = document.getElementById("joinBtn");
            if (joinBtn && typeof window.handleJoin === 'function') {
              joinBtn.onclick = window.handleJoin;
              joinBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                window.handleJoin();
              });
              joinBtn.style.cursor = 'pointer';
              joinBtn.style.pointerEvents = 'auto';
              joinBtn.disabled = false;
              joinBtn.removeAttribute('disabled');
              console.log("[Auth] JOIN button reinitialized after owner view shown");
            }
          }
          
          // Reinitialize navigation buttons
          if (typeof window.initializeNavigationButtons === 'function') {
            window.initializeNavigationButtons();
            console.log("[Auth] Navigation buttons reinitialized after owner view shown");
          }
        } catch (err) {
          console.error("[Auth] Error reinitializing buttons:", err);
        }
      }, 500);
    }

    // Update Settings visibility based on role
    if (typeof window.updateSettingsVisibilityForRole === "function") {
      window.updateSettingsVisibilityForRole(role);
    }
  } catch (err) {
    console.error("[Auth] Failed to load user profile:", err);
    alert("Failed to load user profile.");
    showLoginScreen();
  }
}

// =====================
// Auth state listener
// =====================
onAuthStateChanged(auth, async (user) => {
  if (window.__ffInviteModeActive && !window.__ffInviteFinalized) {
    console.log("[Invite] Invite mode active, suppressing normal auth flow");
    return;
  }
  if (!user) {
    console.log("[Auth] No user, showing login screen");
    if (typeof window !== 'undefined') window.ff_is_admin_cached = null;
    try {
      if (window.__ff_avatarUnsub) {
        window.__ff_avatarUnsub();
        window.__ff_avatarUnsub = null;
      }
      localStorage.removeItem("ff_user_avatar_v1");
    } catch (e) {
      console.warn("[Auth] Error cleaning up avatar listener/cache:", e);
    }
    showLoginScreen();
    return;
  }
  console.log("[Auth] User is signed in, loading role");
  await loadUserRoleAndShowView(user);
});

// =====================
// Wire UI after DOM is ready
// =====================
window.addEventListener("DOMContentLoaded", () => {
  console.log("[UI] DOMContentLoaded – wiring buttons");

  let inviteToken = new URLSearchParams(window.location.search).get("invite");
  if (!inviteToken && window.location.pathname.startsWith("/create-password/")) {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] === "create-password" && parts[1]) {
      inviteToken = parts[1];
      try {
        history.replaceState({}, "", "/?invite=" + encodeURIComponent(inviteToken));
      } catch (e) {
        console.warn("[Invite] Failed to normalize legacy URL", e);
      }
    }
  }
  if (inviteToken) {
    console.log("[Invite] Detected invite token");
    window.__ffInviteToken = inviteToken;
    window.__ffInviteModeActive = true;
    ffShowInviteFlow(inviteToken);
  }

  try {
    // Toggle buttons
    const showSignupBtn = document.getElementById("show-signup-button");
    const showLoginBtn = document.getElementById("show-login-button");

    if (showSignupBtn) {
      showSignupBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("[UI] Sign up link clicked");
        switchToSignup();
      });
    } else {
      console.warn("[UI] Missing element: show-signup-button");
    }

    if (showLoginBtn) {
      showLoginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("[UI] Back to login clicked");
        switchToLogin();
      });
    } else {
      console.warn("[UI] Missing element: show-login-button");
    }
  } catch (e) {
    console.error("[UI] initNav failed", e);
  }

  try {
    // Auth buttons
    const loginBtn = document.getElementById("login-button");
    const googleBtn = document.getElementById("google-login-button");
    const signupBtn = document.getElementById("signup-button");

    if (loginBtn) {
      loginBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleEmailLogin();
      });
    } else {
      console.warn("[UI] Missing element: login-button");
    }

    if (googleBtn) {
      // Remove any standalone 'G' text nodes in the login section
      const loginSection = document.getElementById("login-section");
      if (loginSection) {
        try {
          const walker = document.createTreeWalker(
            loginSection,
            NodeFilter.SHOW_TEXT,
            null
          );
          let node;
          const nodesToRemove = [];
          while (node = walker.nextNode()) {
            // Check if this is a standalone 'G' text node (not inside the button)
            if (node.textContent.trim() === "G") {
              const parent = node.parentElement;
              // Make sure it's not inside the Google button itself
              if (parent && !googleBtn.contains(node) && parent.id !== "google-login-button") {
                nodesToRemove.push(node);
              }
            }
          }
          // Remove all found 'G' text nodes
          nodesToRemove.forEach(n => {
            if (n.parentElement) {
              n.parentElement.removeChild(n);
            }
          });
        } catch (err) {
          console.warn("[UI] Error cleaning up 'G' text nodes:", err);
        }
      }
      
      googleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleGoogleLogin();
      });
    } else {
      console.warn("[UI] Missing element: google-login-button");
    }

    if (signupBtn) {
      signupBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleOwnerSignup();
      });
    } else {
      console.warn("[UI] Missing element: signup-button");
    }
  } catch (e) {
    console.error("[UI] initAuthButtons failed", e);
  }

  try {
    // ----- Simple Forgot Password flow (direct email send) -----
    const forgotPasswordButton = document.getElementById("forgot-password-button");
    const passwordResetMessage = document.getElementById("password-reset-message");

    if (forgotPasswordButton) {
      forgotPasswordButton.addEventListener("click", async (e) => {
        e.preventDefault();
        
        // Clear previous messages
        if (passwordResetMessage) {
          passwordResetMessage.textContent = "";
          passwordResetMessage.style.color = "";
        }

        // Get email from login field
        const emailInput = document.getElementById("login-email");
        let email = emailInput ? emailInput.value.trim() : "";

        // If email is empty, prompt user
        if (!email) {
          email = prompt("Please enter your email address:");
          if (!email) {
            return; // User cancelled
          }
          email = email.trim();
        }

        if (!email) {
          if (passwordResetMessage) {
            passwordResetMessage.style.color = "red";
            passwordResetMessage.textContent = "Please enter your email address.";
          }
          return;
        }

        try {
          console.log("[Forgot Password] Sending password reset email to", email);
          await sendPasswordResetEmail(auth, email);
          
          if (passwordResetMessage) {
            passwordResetMessage.style.color = "green";
            passwordResetMessage.textContent = "Password reset email sent. Please check your inbox.";
          }
        } catch (err) {
          console.error("[Forgot Password] Failed to send reset email", err);
          let message = "Could not send reset email. Please check the email address.";
          
          if (err.code === "auth/user-not-found") {
            message = "No account found with this email address.";
          } else if (err.code === "auth/invalid-email") {
            message = "Invalid email address.";
          }

          if (passwordResetMessage) {
            passwordResetMessage.style.color = "red";
            passwordResetMessage.textContent = message;
          }
        }
      });
    } else {
      console.warn("[UI] Missing element: forgot-password-button");
    }
  } catch (e) {
    console.error("[UI] initForgotPassword failed", e);
  }

  try {
    // ----- Reset password UI wiring (for reset password screen) -----
    const resetPasswordButton = document.getElementById("reset-password-button");
    const resetBackToLoginButton = document.getElementById("reset-back-to-login-button");

    if (resetBackToLoginButton) {
      resetBackToLoginButton.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("[Reset] Back to login");
        showLoginScreen();
      });
    } else {
      console.warn("[UI] Missing element: reset-back-to-login-button");
    }

    if (resetPasswordButton) {
      resetPasswordButton.addEventListener("click", async (e) => {
        e.preventDefault();
        const emailInput = document.getElementById("reset-email");
        const errorDiv = document.getElementById("reset-error");
        const successDiv = document.getElementById("reset-success");

        if (errorDiv) errorDiv.textContent = "";
        if (successDiv) successDiv.textContent = "";

        if (!emailInput) {
          console.error("[Reset] reset-email input not found");
          return;
        }

        const email = emailInput.value.trim();
        if (!email) {
          if (errorDiv) errorDiv.textContent = "Please enter your email.";
          return;
        }

        try {
          console.log("[Reset] Sending password reset email to", email);
          await sendPasswordResetEmail(auth, email);
          if (successDiv) {
            successDiv.textContent = "Reset link sent! Please check your email.";
          } else {
            alert("Reset link sent! Please check your email.");
          }
        } catch (err) {
          console.error("[Reset] Failed to send reset email", err);
          let message = "Failed to send reset email. Please try again.";

          if (err.code === "auth/user-not-found") {
            message = "No user found with this email.";
          } else if (err.code === "auth/invalid-email") {
            message = "Invalid email address.";
          }

          if (errorDiv) {
            errorDiv.textContent = message;
          } else {
            alert(message);
          }
        }
      });
    } else {
      console.warn("[UI] Missing element: reset-password-button");
    }
  } catch (e) {
    console.error("[UI] initResetPassword failed", e);
  }

  try {
    // Logout button handlers
    const logoutOwnerBtn = document.getElementById("logout-button");
    const logoutReceptionBtn = document.getElementById("logout-button-reception");
    const logoutStaffBtn = document.getElementById("logout-button-staff");

    async function handleLogout() {
      console.log("Log out clicked");
      try {
        // Ensure tasksScreen is hidden before logout (if it exists - Tasks feature removed)
        const tasksScreen = document.getElementById('tasksScreen');
        if (tasksScreen) {
          tasksScreen.style.display = 'none';
          tasksScreen.style.pointerEvents = 'none';
        }
        await signOut(auth);
        showLoginScreen();
      } catch (err) {
        console.error("[Auth] Logout failed:", err);
        alert("Logout failed, please try again.");
      }
    }

    if (logoutOwnerBtn) {
      logoutOwnerBtn.addEventListener("click", handleLogout);
    } else {
      console.warn("[UI] Missing element: logout-button");
    }
    if (logoutReceptionBtn) {
      logoutReceptionBtn.addEventListener("click", handleLogout);
    } else {
      console.warn("[UI] Missing element: logout-button-reception");
    }
    if (logoutStaffBtn) {
      logoutStaffBtn.addEventListener("click", handleLogout);
    } else {
      console.warn("[UI] Missing element: logout-button-staff");
    }

    const testPingBtn = document.getElementById("test-ping-btn");
    if (testPingBtn) {
      testPingBtn.addEventListener("click", async () => {
        try {
          await testCallablePing();
          alert("Ping OK – check console for PING RESULT");
        } catch (err) {
          alert("Ping failed: " + (err?.message || err) + " – check console for details");
        }
      });
    }
  } catch (e) {
    console.error("[UI] initLogout failed", e);
  }

  try {
    // By default show login section
    switchToLogin();
  } catch (e) {
    console.error("[UI] switchToLogin failed", e);
  }

  try {
    // Tasks screen event listeners
    const btnTasksBack = document.getElementById("btnTasksBack");
    if (btnTasksBack) {
      btnTasksBack.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("[Tasks] BACK button clicked");
        if (typeof window.closeTasks === 'function') {
          window.closeTasks();
        } else {
          console.error("[Tasks] closeTasks function not found");
        }
      });
      btnTasksBack.style.pointerEvents = 'auto';
      btnTasksBack.style.cursor = 'pointer';
      console.log("[Tasks] BACK button initialized");
    } else {
      console.warn("[Tasks] Missing element: btnTasksBack");
    }

    // Tab buttons
    const tabButtons = document.querySelectorAll('.tasks-tab');
    tabButtons.forEach(tab => {
      // Remove any existing listeners by cloning the element
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
      
      newTab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tabName = newTab.dataset.tab;
        console.log("[Tasks] Tab clicked:", tabName);
        if (tabName && typeof window.setTasksTab === 'function') {
          window.setTasksTab(tabName);
        } else {
          console.error("[Tasks] setTasksTab function not found or invalid tab name:", tabName);
        }
      });
      newTab.style.pointerEvents = 'auto';
      newTab.style.cursor = 'pointer';
    });
    console.log("[Tasks] Tab buttons initialized:", tabButtons.length);
    
    // Tasks Settings button
    const btnTasksSettings = document.getElementById("btnTasksSettings");
    if (btnTasksSettings) {
      btnTasksSettings.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openTasksSettings === 'function') {
          window.openTasksSettings();
        } else {
          console.error("[Tasks] openTasksSettings function not found");
        }
      });
      btnTasksSettings.style.pointerEvents = 'auto';
      btnTasksSettings.style.cursor = 'pointer';
      console.log("[Tasks] Settings button initialized");
    }
    
    // Tasks Settings Modal - Close button
    const tasksSettingsClose = document.getElementById("tasksSettingsClose");
    if (tasksSettingsClose) {
      tasksSettingsClose.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.closeTasksSettings === 'function') {
          window.closeTasksSettings();
        }
      });
    }
    
    // Tasks Settings Modal - Backdrop click
    const tasksSettingsModal = document.getElementById("tasksSettingsModal");
    if (tasksSettingsModal) {
      tasksSettingsModal.addEventListener("click", (e) => {
        if (e.target === tasksSettingsModal) {
          if (typeof window.closeTasksSettings === 'function') {
            window.closeTasksSettings();
          }
        }
      });
    }
    
    // Tasks Settings Modal - Toggle form button
    const tasksModalToggleForm = document.getElementById("tasksModalToggleForm");
    if (tasksModalToggleForm && !tasksModalToggleForm.dataset.listenerAttached) {
      tasksModalToggleForm.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.toggleTasksModalForm === 'function') {
          window.toggleTasksModalForm();
        }
      });
      tasksModalToggleForm.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Add button (inside form)
    const taskAddBtn = document.getElementById("taskAddBtn");
    if (taskAddBtn && !taskAddBtn.dataset.listenerAttached) {
      taskAddBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.addTaskToDraft === 'function') {
          window.addTaskToDraft();
        }
      });
      taskAddBtn.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Cancel button
    const taskCancelBtn = document.getElementById("taskCancelBtn");
    if (taskCancelBtn && !taskCancelBtn.dataset.listenerAttached) {
      taskCancelBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.cancelTasksModalForm === 'function') {
          window.cancelTasksModalForm();
        }
      });
      taskCancelBtn.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Clear error on input
    const taskNameInput = document.getElementById("taskNameInput");
    if (taskNameInput && !taskNameInput.dataset.listenerAttached) {
      taskNameInput.addEventListener("input", () => {
        const errorEl = document.getElementById("taskNameError");
        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }
      });
      taskNameInput.dataset.listenerAttached = 'true';
    }
    
    // Task Instructions Modal - Close button
    const taskInstructionsClose = document.getElementById("taskInstructionsClose");
    if (taskInstructionsClose && !taskInstructionsClose.dataset.listenerAttached) {
      taskInstructionsClose.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.closeTaskInstructionsModal === 'function') {
          window.closeTaskInstructionsModal();
        }
      });
      taskInstructionsClose.dataset.listenerAttached = 'true';
    }
    
    // Task Instructions Modal - Backdrop click
    const taskInstructionsModal = document.getElementById("taskInstructionsModal");
    if (taskInstructionsModal && !taskInstructionsModal.dataset.listenerAttached) {
      taskInstructionsModal.addEventListener("click", (e) => {
        if (e.target === taskInstructionsModal) {
          if (typeof window.closeTaskInstructionsModal === 'function') {
            window.closeTaskInstructionsModal();
          }
        }
      });
      taskInstructionsModal.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Save button
    const tasksModalSaveBtn = document.getElementById("tasksModalSaveBtn");
    if (tasksModalSaveBtn && !tasksModalSaveBtn.dataset.listenerAttached) {
      tasksModalSaveBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.saveTasksModal === 'function') {
          window.saveTasksModal();
        }
      });
      tasksModalSaveBtn.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Add button
    const tasksModalAddBtn = document.getElementById("tasksModalAddBtn");
    if (tasksModalAddBtn) {
      tasksModalAddBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.addTaskToCatalog === 'function') {
          window.addTaskToCatalog();
        }
      });
    }
    
    // Tasks Settings Modal - Clear error on input
    const tasksModalTaskName = document.getElementById("tasksModalTaskName");
    if (tasksModalTaskName) {
      tasksModalTaskName.addEventListener("input", () => {
        const errorDiv = document.getElementById("tasksModalTaskNameError");
        if (errorDiv) {
          errorDiv.style.display = 'none';
          errorDiv.textContent = '';
        }
      });
    }
    
    // Tasks Settings Modal - Allow Enter key to add task
    if (tasksModalTaskName) {
      tasksModalTaskName.addEventListener("keypress", (e) => {
        if (e.key === 'Enter' && typeof window.addTaskToCatalog === 'function') {
          e.preventDefault();
          window.addTaskToCatalog();
        }
      });
    }
    
  } catch (e) {
    console.error("[Tasks] Error initializing Tasks screen buttons:", e);
  }

  // Enforce history retention policy on app load
  enforceHistoryRetention();
  
  // Queue Auto Reset: call on startup and set up interval
  try {
    if (typeof window.ffMaybeAutoResetQueue === 'function') {
      window.ffMaybeAutoResetQueue(new Date());
    }
    
    // Set up interval timer (30 seconds) - guard with window flag
    if (!window.__queueAutoResetIntervalStarted) {
      window.__queueAutoResetIntervalStarted = true;
      setInterval(() => {
        if (typeof window.ffMaybeAutoResetQueue === 'function') {
          window.ffMaybeAutoResetQueue(new Date());
        }
      }, 30 * 1000);
      console.log('[AUTO_RESET][QUEUE] Interval timer started (30s)');
    }
  } catch (e) {
    console.error('[AUTO_RESET][QUEUE] Error initializing:', e);
  }
});

// Initialize Tasks screen buttons function (can be called when Tasks screen opens)
function initializeTasksScreenButtons() {
  try {
    // BACK button
    const btnTasksBack = document.getElementById("btnTasksBack");
    if (btnTasksBack) {
      // Remove any existing listeners by cloning
      const newBtn = btnTasksBack.cloneNode(true);
      btnTasksBack.parentNode.replaceChild(newBtn, btnTasksBack);
      
      newBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log("[Tasks] BACK button clicked");
        if (typeof window.closeTasks === 'function') {
          window.closeTasks();
        } else {
          console.error("[Tasks] closeTasks function not found");
        }
      });
      newBtn.style.pointerEvents = 'auto';
      newBtn.style.cursor = 'pointer';
      console.log("[Tasks] BACK button re-initialized");
    }

    // Tab buttons
    const tabButtons = document.querySelectorAll('.tasks-tab');
    tabButtons.forEach(tab => {
      // Remove any existing listeners by cloning
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
      
      newTab.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const tabName = newTab.dataset.tab;
        console.log("[Tasks] Tab clicked:", tabName);
        if (tabName && typeof window.setTasksTab === 'function') {
          window.setTasksTab(tabName);
        } else {
          console.error("[Tasks] setTasksTab function not found or invalid tab name:", tabName);
        }
      });
      newTab.style.pointerEvents = 'auto';
      newTab.style.cursor = 'pointer';
    });
    console.log("[Tasks] Tab buttons re-initialized:", tabButtons.length);
    
    // Tasks Settings button
    const btnTasksSettings = document.getElementById("btnTasksSettings");
    if (btnTasksSettings) {
      btnTasksSettings.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.openTasksSettings === 'function') {
          window.openTasksSettings();
        }
      };
      btnTasksSettings.style.pointerEvents = 'auto';
      btnTasksSettings.style.cursor = 'pointer';
    }
    
    // Tasks Settings Modal - Close button
    const tasksSettingsClose = document.getElementById("tasksSettingsClose");
    if (tasksSettingsClose) {
      tasksSettingsClose.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.closeTasksSettings === 'function') {
          window.closeTasksSettings();
        }
      };
    }
    
    // Tasks Settings Modal - Backdrop click
    const tasksSettingsModal = document.getElementById("tasksSettingsModal");
    if (tasksSettingsModal) {
      tasksSettingsModal.onclick = (e) => {
        if (e.target === tasksSettingsModal) {
          if (typeof window.closeTasksSettings === 'function') {
            window.closeTasksSettings();
          }
        }
      };
    }
    
    // Tasks Settings Modal - Toggle form button
    const tasksModalToggleForm = document.getElementById("tasksModalToggleForm");
    if (tasksModalToggleForm && !tasksModalToggleForm.dataset.listenerAttached) {
      tasksModalToggleForm.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.toggleTasksModalForm === 'function') {
          window.toggleTasksModalForm();
        }
      };
      tasksModalToggleForm.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Add button (inside form)
    const taskAddBtn = document.getElementById("taskAddBtn");
    if (taskAddBtn && !taskAddBtn.dataset.listenerAttached) {
      taskAddBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.addTaskToDraft === 'function') {
          window.addTaskToDraft();
        }
      };
      taskAddBtn.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Cancel button
    const taskCancelBtn = document.getElementById("taskCancelBtn");
    if (taskCancelBtn && !taskCancelBtn.dataset.listenerAttached) {
      taskCancelBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.cancelTasksModalForm === 'function') {
          window.cancelTasksModalForm();
        }
      };
      taskCancelBtn.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Clear error on input
    const taskNameInput = document.getElementById("taskNameInput");
    if (taskNameInput && !taskNameInput.dataset.listenerAttached) {
      taskNameInput.oninput = () => {
        const errorEl = document.getElementById("taskNameError");
        if (errorEl) {
          errorEl.style.display = 'none';
          errorEl.textContent = '';
        }
      };
      taskNameInput.dataset.listenerAttached = 'true';
    }
    
    // Task Instructions Modal - Close button
    const taskInstructionsClose = document.getElementById("taskInstructionsClose");
    if (taskInstructionsClose && !taskInstructionsClose.dataset.listenerAttached) {
      taskInstructionsClose.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.closeTaskInstructionsModal === 'function') {
          window.closeTaskInstructionsModal();
        }
      };
      taskInstructionsClose.dataset.listenerAttached = 'true';
    }
    
    // Task Instructions Modal - Backdrop click
    const taskInstructionsModal = document.getElementById("taskInstructionsModal");
    if (taskInstructionsModal && !taskInstructionsModal.dataset.listenerAttached) {
      taskInstructionsModal.onclick = (e) => {
        if (e.target === taskInstructionsModal) {
          if (typeof window.closeTaskInstructionsModal === 'function') {
            window.closeTaskInstructionsModal();
          }
        }
      };
      taskInstructionsModal.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Save button
    const tasksModalSaveBtn = document.getElementById("tasksModalSaveBtn");
    if (tasksModalSaveBtn && !tasksModalSaveBtn.dataset.listenerAttached) {
      tasksModalSaveBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.saveTasksModal === 'function') {
          window.saveTasksModal();
        }
      };
      tasksModalSaveBtn.dataset.listenerAttached = 'true';
    }
    
    // Tasks Settings Modal - Add button
    const tasksModalAddBtn = document.getElementById("tasksModalAddBtn");
    if (tasksModalAddBtn) {
      tasksModalAddBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof window.addTaskToCatalog === 'function') {
          window.addTaskToCatalog();
        }
      };
    }
    
    // Tasks Settings Modal - Clear error on input
    const tasksModalTaskName = document.getElementById("tasksModalTaskName");
    if (tasksModalTaskName) {
      tasksModalTaskName.oninput = () => {
        const errorDiv = document.getElementById("tasksModalTaskNameError");
        if (errorDiv) {
          errorDiv.style.display = 'none';
          errorDiv.textContent = '';
        }
      };
    }
    
  } catch (e) {
    console.error("[Tasks] Error re-initializing Tasks screen buttons:", e);
  }
}

// Expose for use in index.html
window.initializeTasksScreenButtons = initializeTasksScreenButtons;

// History retention policy: Keep last 90 days and max 10,000 entries
function enforceHistoryRetention() {
  try {
    const MAX_DAYS = 90;
    const MAX_ENTRIES = 10000;

    const raw = JSON.parse(localStorage.getItem('ffv24_log') || '[]');
    if (!Array.isArray(raw)) return;

    const now = Date.now();
    const cutoff = now - MAX_DAYS * 24 * 60 * 60 * 1000;

    // Keep entries that are within MAX_DAYS if they have ts.
    // If an entry has no ts, keep it (legacy safety).
    let filtered = raw.filter(e => {
      if (!e || typeof e !== 'object') return false;
      if (!e.ts) return true;
      return e.ts >= cutoff;
    });

    // Keep only the newest MAX_ENTRIES
    if (filtered.length > MAX_ENTRIES) {
      filtered = filtered.slice(-MAX_ENTRIES);
    }

    localStorage.setItem('ffv24_log', JSON.stringify(filtered));
  } catch (err) {
    console.error('[HISTORY RETENTION] failed', err);
  }
}

// Expose globally so it can be called from index.html's addHistoryEntry if needed
window.enforceHistoryRetention = enforceHistoryRetention;

// Helper function to load users from localStorage (prefer ffv24_users, else ff_users_v1)
function ffGetUsers() {
  try {
    const ffv24Users = JSON.parse(localStorage.getItem('ffv24_users') || '[]');
    if (Array.isArray(ffv24Users) && ffv24Users.length > 0) {
      return ffv24Users;
    }
    const ffUsers = JSON.parse(localStorage.getItem('ff_users_v1') || '[]');
    return Array.isArray(ffUsers) ? ffUsers : [];
  } catch (e) {
    console.error('[ffGetUsers] Error loading users:', e);
    return [];
  }
}

// Expose globally for use in index.html
window.ffGetUsers = ffGetUsers;

// Helper function to log Tasks actions to history
function addTasksHistoryEntry({ action, taskId, taskTitle, worker, role, performedBy, extra }) {
  try {
    const now = new Date();
    const entry = {
      source: 'tasks',
      dateTime: now.toISOString(),
      ts: now.getTime(),
      action: action || '-',
      taskId: taskId || null,
      taskTitle: taskTitle || null,
      role: role || '-',
      performedBy: performedBy || '-',
      worker: worker || '-',
      extra: extra || null,
    };
    // Call addHistoryEntry if available (defined in index.html), then extend the entry
    if (typeof addHistoryEntry === 'function') {
      addHistoryEntry(entry.action, entry.role, entry.performedBy, entry.worker, entry.source);
      // Extend the last entry with task-specific fields
      const logArr = JSON.parse(localStorage.getItem('ffv24_log') || '[]');
      if (logArr.length > 0) {
        const lastEntry = logArr[logArr.length - 1];
        lastEntry.taskId = entry.taskId;
        lastEntry.taskTitle = entry.taskTitle;
        lastEntry.extra = entry.extra;
        lastEntry.dateTime = entry.dateTime;
        lastEntry.ts = entry.ts;
        localStorage.setItem('ffv24_log', JSON.stringify(logArr));
      }
      // Enforce retention policy after writing (even if no entries to extend)
      enforceHistoryRetention();
    } else {
      // Fallback: write directly to ffv24_log
      const logArr = JSON.parse(localStorage.getItem('ffv24_log') || '[]');
      const historyEntry = {
        date: now.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }),
        time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        action: entry.action || '',
        role: entry.role || '',
        performedBy: entry.performedBy || '',
        worker: entry.worker || '',
        source: entry.source || 'tasks',
        ts: entry.ts,
        dateTime: entry.dateTime,
        taskId: entry.taskId,
        taskTitle: entry.taskTitle,
        extra: entry.extra
      };
      logArr.push(historyEntry);
      localStorage.setItem('ffv24_log', JSON.stringify(logArr));
    }
    // Enforce retention policy after writing
    enforceHistoryRetention();
    console.log('[TASKS HISTORY] wrote', entry);
  } catch (err) {
    console.error('[TASKS HISTORY] failed', err);
  }
}

// Safely move a task into the Pending list (tab-specific storage)
function moveTaskToPending(taskId, workerName) {
    console.log(`%c[MOVE TO PENDING] START`, 'color:blue;font-weight:bold', { taskId, workerName });
    const tabs = ['opening', 'closing', 'weekly', 'monthly', 'yearly'];
    
    // Find which tab contains this task
    for (let tab of tabs) {
        const activeKey = `ff_tasks_${tab}_active_v1`;
        const pendingKey = `ff_tasks_${tab}_pending_v1`;
        
        console.log(`[MOVE TO PENDING] Checking tab: ${tab}, activeKey: ${activeKey}, pendingKey: ${pendingKey}`);
        
        const activeTasks = JSON.parse(localStorage.getItem(activeKey) || '[]');
        console.log(`[MOVE TO PENDING] Active tasks count before: ${activeTasks.length}`);
        
        const taskIndex = activeTasks.findIndex(t => {
            const tId = t.taskId || t.id;
            return tId && String(tId) === String(taskId);
        });
        
        if (taskIndex >= 0) {
            // Found the task in active list
            const task = activeTasks[taskIndex];
            console.log(`[MOVE TO PENDING] Found task in ACTIVE at index ${taskIndex}:`, {
                tab,
                taskId,
                activeKey,
                pendingKey,
                taskBefore: { ...task },
                activeLengthBefore: activeTasks.length
            });
            
            // Update task in ACTIVE: set status='pending' and assignedTo
            task.status = 'pending';
            task.assignedTo = workerName;
            
            console.log(`[MOVE TO PENDING] Updated task in ACTIVE:`, {
                tab,
                taskId,
                status: task.status,
                assignedTo: task.assignedTo,
                activeLengthAfter: activeTasks.length,
                removedFromActive: false // Task is NOT removed, just updated
            });
            
            // Save updated ACTIVE list
            localStorage.setItem(activeKey, JSON.stringify(activeTasks));
            console.log(`[MOVE TO PENDING] Saved ACTIVE list: ${activeKey}, length: ${activeTasks.length}`);
            
            // Add to pending list (create a copy for pending)
            const pendingTasks = JSON.parse(localStorage.getItem(pendingKey) || '[]');
            console.log(`[MOVE TO PENDING] Pending tasks count before: ${pendingTasks.length}`);
            
            // Check if already in pending to avoid duplicates
            const pendingIndex = pendingTasks.findIndex(t => {
                const tId = t.taskId || t.id;
                return tId && String(tId) === String(taskId);
            });
            
            if (pendingIndex < 0) {
                // Create a copy for pending list
                const pendingCopy = {
                    id: task.id || task.taskId,
                    taskId: task.taskId || task.id,
                    title: task.title || '',
                    instructions: task.instructions || task.info || task.details || '',
                    status: 'pending',
                    assignedTo: workerName
                };
                pendingTasks.push(pendingCopy);
                localStorage.setItem(pendingKey, JSON.stringify(pendingTasks));
                console.log(`[MOVE TO PENDING] Added to PENDING list: ${pendingKey}, length: ${pendingTasks.length}`);
                
                // Log to history after successful SELECT
                const taskTitle = task.title || '';
                const worker = workerName || '-';
                const currentTab = (typeof getCurrentTasksTab === 'function') ? getCurrentTasksTab() : (window.currentTasksTab || tab || null);
                addTasksHistoryEntry({
                    action: `Task Selected: ${taskTitle || taskId || ''}`.trim(),
                    taskId,
                    taskTitle,
                    worker,
                    role: '-',
                    performedBy: '-',
                    extra: currentTab ? { tab: currentTab, status: 'selected' } : { status: 'selected' }
                });
            } else {
                console.warn(`[MOVE TO PENDING] Task ${taskId} already exists in PENDING at index ${pendingIndex}, skipping duplicate`);
            }
            
            console.log(`%c[MOVE TO PENDING] COMPLETE`, 'color:green;font-weight:bold', {
                tab,
                taskId,
                activeKey,
                pendingKey,
                activeLength: activeTasks.length,
                pendingLength: pendingTasks.length,
                taskRemovedFromActive: false,
                taskAddedToPending: pendingIndex < 0
            });
            
            if (window.renderTasksList) {
                if (window.renderTasksList.length > 1) {
                    window.renderTasksList(tab, { force: true });
                } else {
                    window.renderTasksList(tab);
                }
            }
            
            // Update tab badges after moving task to pending
            if (typeof window.ffUpdateTasksTabBadges === 'function') {
                setTimeout(() => window.ffUpdateTasksTabBadges(), 50);
            }
            
            return;
        }
        
        // If not found in active, check catalog for initial state tasks (status null/empty)
        try {
            const catalog = window.ff_tasks_catalog_v1?.[tab] || 
                           (() => {
                               try {
                                   const stored = localStorage.getItem("ff_tasks_catalog_v1");
                                   if (stored) {
                                       const parsed = JSON.parse(stored);
                                       return parsed[tab] || [];
                                   }
                               } catch (e) {
                                   console.error(`[Tasks] Error loading catalog for ${tab}:`, e);
                               }
                               return [];
                           })();
            
            const catalogTaskIndex = catalog.findIndex(t => t && t.id === taskId);
            
            if (catalogTaskIndex >= 0) {
                const task = catalog[catalogTaskIndex];
                
                // Normalize status to check if task is in initial state
                const originalStatus = task.status;
                const status = (task.status ?? "").toLowerCase();
                const isInitial = (status === "" || status === "new" || status === "idle" || status === "catalog" || task.status === null);
                
                if (isInitial) {
                    // Task is in initial state - move it to pending
                    // Create a runtime copy based only on catalog template fields.
                    // IMPORTANT: Do NOT mutate or persist runtime fields into catalog.
                    const taskCopy = {
                        id: task.id,
                        title: task.title,
                        instructions: task.instructions || task.info || task.details || "",
                        status: "pending",
                        assignedTo: workerName
                    };
                    
                    // Add to pending list (runtime state only)
                    const pendingTasks = JSON.parse(localStorage.getItem(`ff_tasks_${tab}_pending_v1`) || '[]');
                    pendingTasks.push(taskCopy);
                    if (typeof writeTasksList === 'function') {
                      writeTasksList(tab, 'pending', pendingTasks);
                    } else {
                      localStorage.setItem(`ff_tasks_${tab}_pending_v1`, JSON.stringify(pendingTasks));
                    }
                    
                    const fromStatus = originalStatus === null ? "null" : (originalStatus || "empty");
                    console.log("[SELECT] moved to pending", { tab, id: taskId, from: fromStatus, to: "pending" });
                    
                    // Log to history after successful SELECT
                    const taskTitle = task.title || '';
                    const worker = workerName || '-';
                    const currentTab = (typeof getCurrentTasksTab === 'function') ? getCurrentTasksTab() : (window.currentTasksTab || tab || null);
                    addTasksHistoryEntry({
                        action: `Task Selected: ${taskTitle || taskId || ''}`.trim(),
                        taskId,
                        taskTitle,
                        worker,
                        role: '-',
                        performedBy: '-',
                        extra: currentTab ? { tab: currentTab, status: 'selected' } : { status: 'selected' }
                    });
                    
                    if (window.renderTasksList) {
                        if (window.renderTasksList.length > 1) {
                            window.renderTasksList(tab, { force: true });
                        } else {
                            window.renderTasksList(tab);
                        }
                    }
                    return;
                }
            }
        } catch (e) {
            console.error(`[Tasks] Error checking catalog for task ${taskId} in ${tab}:`, e);
        }
    }
    
    console.warn(`[Tasks] Task ${taskId} not found in any active list or catalog`);
}

// Expose to window for use in index.html
window.moveTaskToPending = moveTaskToPending;

// Mark task as done (tab-specific storage)
function markTaskDone(taskId, workerName) {
    console.log(`%c[MARK DONE] START`, 'color:orange;font-weight:bold', { taskId, workerName });
    
    // Determine current tab
    const tab = (typeof window.currentTasksTab !== 'undefined' && window.currentTasksTab) 
        ? window.currentTasksTab 
        : 'opening';
    
    const completionTime = Date.now();
    const normalizedTaskId = String(taskId);
    
    const pendingKey = `ff_tasks_${tab}_pending_v1`;
    const activeKey = `ff_tasks_${tab}_active_v1`;
    
    console.log(`[MARK DONE] Using tab: ${tab}, pendingKey: ${pendingKey}, activeKey: ${activeKey}`);
    
    // 1) Remove from pending and get task data
    const pendingTasks = JSON.parse(localStorage.getItem(pendingKey) || '[]');
    const pendingBeforeLength = pendingTasks.length;
    console.log(`[MARK DONE] Pending tasks count before: ${pendingBeforeLength}`);
    
    const pendingTaskIndex = pendingTasks.findIndex(t => {
        const tId = t.taskId || t.id;
        return tId && String(tId) === normalizedTaskId;
    });
    
    let pendingTask = null;
    let assignedEmployee = workerName; // Default to current employee
    
    if (pendingTaskIndex >= 0) {
        // Get pending task data
        pendingTask = pendingTasks[pendingTaskIndex];
        assignedEmployee = pendingTask.assignedTo || pendingTask.completedBy || workerName;
        
        console.log(`[MARK DONE] Found task in PENDING at index ${pendingTaskIndex}:`, {
            tab,
            taskId,
            pendingKey,
            pendingTask: { ...pendingTask },
            pendingLengthBefore: pendingBeforeLength
        });
        
        // Remove from pending
        pendingTasks.splice(pendingTaskIndex, 1);
        if (typeof writeTasksList === 'function') {
          const m = String(pendingKey).match(
            /^ff_tasks_(opening|closing|weekly|monthly|yearly)_(active|pending|done)_v1$/
          );
          if (m) {
            writeTasksList(m[1], m[2], pendingTasks);
          } else {
            localStorage.setItem(pendingKey, JSON.stringify(pendingTasks));
          }
        } else {
          localStorage.setItem(pendingKey, JSON.stringify(pendingTasks));
        }
        console.log(`[MARK DONE] Removed from PENDING: ${pendingKey}, length: ${pendingBeforeLength} -> ${pendingTasks.length}`);
    } else {
        console.warn(`[MARK DONE] Task ${taskId} not found in PENDING list`);
    }
    
    // 1) Normalize keyId ONCE
    const keyId = pendingTask 
        ? (pendingTask.taskId || pendingTask.id || normalizedTaskId)
        : normalizedTaskId;
    
    console.log(`[MARK DONE] Normalized keyId: ${keyId}`);
    
    // 2) Update or create in ACTIVE list
    const activeTasks = JSON.parse(localStorage.getItem(activeKey) || '[]');
    const activeBeforeLength = activeTasks.length;
    console.log(`[MARK DONE] Active tasks count before: ${activeBeforeLength}`);
    
    // Match on BOTH id/taskId
    const idx = activeTasks.findIndex(t => {
        const tId = t?.taskId || t?.id;
        return tId && String(tId) === String(keyId);
    });
    
    console.log(`[MARK DONE] Active task index: ${idx}, keyId: ${keyId}`);
    
    // For yearly tasks, store in done list with completedYear and scheduleYear
    if (tab === 'yearly') {
        // Use getTabStorageKey for standard storage key
        const doneKey = (typeof getTabStorageKey === 'function') 
            ? getTabStorageKey(tab, 'done')
            : `ff_tasks_${tab}_done_v1`;
        const doneList = JSON.parse(localStorage.getItem(doneKey) || '[]');
        const currentYear = new Date().getFullYear();
        
        // Get task data to extract scheduleYear
        const sourceTask = idx >= 0 ? activeTasks[idx] : pendingTask;
        
        // Get scheduleYear from task, or try catalog lookup
        let scheduleYear = sourceTask?.scheduleYear;
        if (scheduleYear === undefined && typeof ffGetYearlyCatalogMap === 'function') {
            const catalogMap = ffGetYearlyCatalogMap();
            const catalogTask = catalogMap.get(String(keyId).trim());
            if (catalogTask) {
                scheduleYear = catalogTask.scheduleYear;
            }
        }
        
        // Remove existing entry for this task if present
        const existingDoneIndex = doneList.findIndex(t => {
            const tId = t.taskId || t.id;
            return tId && String(tId) === String(keyId);
        });
        
        const doneTask = {
            id: keyId,
            taskId: keyId,
            title: sourceTask?.title || '',
            instructions: sourceTask?.instructions || sourceTask?.info || sourceTask?.details || '',
            status: 'done',
            completedAt: completionTime,
            completedBy: assignedEmployee,
            completedYear: currentYear,
            scheduleYear: scheduleYear
        };
        
        if (existingDoneIndex >= 0) {
            doneList[existingDoneIndex] = doneTask;
        } else {
            doneList.push(doneTask);
        }
        
        // Save done list
        if (typeof writeTasksList === 'function') {
            writeTasksList(tab, 'done', doneList);
        } else {
            localStorage.setItem(doneKey, JSON.stringify(doneList));
        }
        console.log(`[MARK DONE] Saved to yearly done list: ${doneKey}, count=${doneList.length}`);
        
        // Debug log (behind DEBUG_MODE check)
        if (window.DEBUG_MODE || localStorage.getItem('DEBUG_MODE') === 'true') {
            console.log('[DEBUG] Yearly done key:', doneKey);
            console.log('[DEBUG] Last done entry after MARK DONE:', doneTask);
        }
    }
    
    if (idx >= 0) {
        // Update existing active task
        const taskBefore = { ...activeTasks[idx] };
        activeTasks[idx].id = keyId;
        activeTasks[idx].taskId = keyId;
        activeTasks[idx].status = 'done';
        activeTasks[idx].completedAt = completionTime;
        activeTasks[idx].completedBy = assignedEmployee;
        activeTasks[idx].active = true;
        activeTasks[idx].assignedTo = null;
        
        console.log(`[MARK DONE] Updated existing task in ACTIVE:`, {
            tab,
            taskId: keyId,
            activeKey,
            taskBefore,
            taskAfter: { ...activeTasks[idx] },
            activeLengthBefore: activeBeforeLength,
            activeLengthAfter: activeTasks.length,
            removedFromActive: false // Task is NOT removed, just updated
        });
    } else {
        // Not found in ACTIVE - PUSH a completed copy
        const newTask = {
            id: keyId,
            taskId: keyId,
            title: pendingTask?.title || '',
            instructions: pendingTask?.instructions || pendingTask?.info || pendingTask?.details || '',
            active: true,
            status: 'done',
            completedAt: completionTime,
            completedBy: assignedEmployee,
            assignedTo: null
        };
        activeTasks.push(newTask);
        
        console.log(`[MARK DONE] Created new task in ACTIVE (not found):`, {
            tab,
            taskId: keyId,
            activeKey,
            newTask,
            activeLengthBefore: activeBeforeLength,
            activeLengthAfter: activeTasks.length,
            removedFromActive: false // Task was not in active, so nothing to remove
        });
    }
    
    // Save updated ACTIVE list
    if (typeof writeTasksList === 'function') {
      const m = String(activeKey).match(
        /^ff_tasks_(opening|closing|weekly|monthly|yearly)_(active|pending|done)_v1$/
      );
      if (m) {
        writeTasksList(m[1], m[2], activeTasks);
      } else {
        localStorage.setItem(activeKey, JSON.stringify(activeTasks));
      }
    } else {
      localStorage.setItem(activeKey, JSON.stringify(activeTasks));
    }
    console.log(`[MARK DONE] Saved ACTIVE list: ${activeKey}, length: ${activeTasks.length}`);
    
    // Verify completion
    const verifyActive = JSON.parse(localStorage.getItem(activeKey) || '[]');
    const completedCount = verifyActive.filter(t => t.status === 'done' || t.completedAt).length;
    console.log(`[MARK DONE] Active saved: ${completedCount} completed task(s) in ACTIVE list`);
    
    // Log to history after successful DONE
    // Use workerName (matched displayName from PIN validation) for history entry
    const completedTask = idx >= 0 ? activeTasks[idx] : (pendingTask || null);
    const taskTitle = completedTask?.title || pendingTask?.title || '';
    const worker = workerName || '-'; // Use matched displayName from PIN validation
    const currentTab = (typeof getCurrentTasksTab === 'function') ? getCurrentTasksTab() : (window.currentTasksTab || tab || null);
    addTasksHistoryEntry({
        action: `Task Completed: ${taskTitle || keyId || ''}`.trim(),
        taskId: keyId,
        taskTitle,
        worker,
        role: '-',
        performedBy: '-',
        extra: currentTab ? { tab: currentTab, status: 'done' } : { status: 'done' }
    });
    
    console.log(`%c[MARK DONE] COMPLETE`, 'color:green;font-weight:bold', {
        tab,
        taskId: keyId,
        pendingKey,
        activeKey,
        pendingLengthBefore: pendingBeforeLength,
        pendingLengthAfter: pendingTasks.length,
        activeLengthBefore: activeBeforeLength,
        activeLengthAfter: activeTasks.length,
        taskRemovedFromPending: pendingTaskIndex >= 0,
        taskRemovedFromActive: false,
        taskUpdatedInActive: idx >= 0,
        taskCreatedInActive: idx < 0
    });
    
    // 3) Re-render UI
    if (typeof window.loadTasks === 'function') {
        window.loadTasks();
    }
    if (window.renderTasksList) {
        if (window.renderTasksList.length > 1) {
            window.renderTasksList(tab, { force: true });
        } else {
            window.renderTasksList(tab);
        }
    }
    
    // Update tab badges after marking task as done
    if (typeof window.ffUpdateTasksTabBadges === 'function') {
        setTimeout(() => window.ffUpdateTasksTabBadges(), 50);
    }
    
    // Check for auto-reset after marking task as done (if opening/closing tab, no setTimeout)
    if (tab === 'opening') {
        try {
            if (typeof window.ffMaybeAutoResetOpening === 'function') {
                window.ffMaybeAutoResetOpening(new Date());
            }
        } catch (e) {
            // Silently ignore errors
        }
    } else if (tab === 'closing') {
        try {
            if (typeof window.ffMaybeAutoResetClosing === 'function') {
                window.ffMaybeAutoResetClosing(new Date());
            }
        } catch (e) {
            // Silently ignore errors
        }
    } else if (tab === 'weekly') {
        try {
            if (typeof window.ffMaybeAutoResetWeekly === 'function') {
                window.ffMaybeAutoResetWeekly(new Date());
            }
        } catch (e) {
            // Silently ignore errors
        }
    } else if (tab === 'monthly') {
        try {
            if (typeof window.ffMaybeAutoResetMonthly === 'function') {
                window.ffMaybeAutoResetMonthly(new Date());
            }
        } catch (e) {
            // Silently ignore errors
        }
    } else if (tab === 'yearly') {
        try {
            if (typeof window.ffMaybeAutoResetYearly === 'function') {
                window.ffMaybeAutoResetYearly(new Date());
            }
        } catch (e) {
            // Silently ignore errors
        }
    }
}

window.markTaskDone = markTaskDone;

// PIN Modal functions
let __pendingTaskId = null;
let pinModalDoneTaskId = null;

function openPinModal(taskId) {
    __pendingTaskId = taskId;
    pinModalDoneTaskId = null;
    const pinModal = document.getElementById("pinModal");
    const pinError = document.getElementById("pinError");
    const pinInput = document.getElementById("pinModalTaskInput");
    if (pinModal) pinModal.style.display = "flex";
    if (pinError) pinError.style.display = "none";
    if (pinInput) pinInput.value = "";
    if (pinInput) pinInput.focus();
}

function openPinModalForDone(taskId) {
    pinModalDoneTaskId = taskId;
    __pendingTaskId = null;
    const pinModal = document.getElementById("pinModal");
    const pinError = document.getElementById("pinError");
    const pinInput = document.getElementById("pinModalTaskInput");
    if (pinModal) pinModal.style.display = "flex";
    if (pinError) pinError.style.display = "none";
    if (pinInput) pinInput.value = "";
    if (pinInput) pinInput.focus();
}

function closePinModal() {
    const pinModal = document.getElementById("pinModal");
    if (pinModal) pinModal.style.display = "none";
    __pendingTaskId = null;
    pinModalDoneTaskId = null;
}

async function validatePinAndMove() {
    const pinError = document.getElementById("pinError");
    
    // Use ONLY ffAuthStaffByPinFromModal for PIN validation
    const auth = ffAuthStaffByPinFromModal(document);
    
    // Debug log
    console.log("[TASKS PIN] OK handler auth result:", auth);
    
    if (!auth.ok) {
        if (pinError) {
            if (auth.reason === "empty") {
                pinError.textContent = "Enter PIN";
            } else {
                pinError.textContent = "Incorrect PIN";
            }
            pinError.style.display = "block";
        }
        return;
    }
    
    // Success - set authenticated staff
    console.log("[PIN] auth raw", auth);
    console.log("[PIN] auth raw json", JSON.stringify(auth));
    // ✅ PIN auth: persist authed staffId for invites & permissions
    const authedStaffId =
      auth?.staffId ||
      auth?.id ||
      auth?.staff?.id ||
      auth?.staff?.staffId ||
      null;
    
    window.__ff_authedStaffId = authedStaffId;
    localStorage.setItem("ff_authedStaffId_v1", authedStaffId || "");
    
    console.log("[PIN] authed staff set", {
      authedStaffId,
      windowAuthed: window.__ff_authedStaffId,
      lsAuthed: localStorage.getItem("ff_authedStaffId_v1"),
    });
    
    window.__ff_authedStaffName = auth.name || undefined;
    
    const matchedName = auth.name || '';
    
    if (__pendingTaskId) {
        moveTaskToPending(__pendingTaskId, matchedName);
    }

    closePinModal();
}

function validatePinAndMarkDone() {
    const pinError = document.getElementById("pinError");
    
    // Use ONLY ffAuthStaffByPinFromModal for PIN validation
    const auth = ffAuthStaffByPinFromModal(document);
    
    // Debug log
    console.log("[TASKS PIN] OK handler auth result:", auth);
    
    if (!auth.ok) {
        if (pinError) {
            if (auth.reason === "empty") {
                pinError.textContent = "Enter PIN";
            } else {
                pinError.textContent = "Incorrect PIN";
            }
            pinError.style.display = "block";
        }
        return;
    }
    
    // Success - set authenticated staff
    console.log("[PIN] auth raw", auth);
    console.log("[PIN] auth raw json", JSON.stringify(auth));
    // ✅ PIN auth: persist authed staffId for invites & permissions
    const authedStaffId =
      auth?.staffId ||
      auth?.id ||
      auth?.staff?.id ||
      auth?.staff?.staffId ||
      null;
    
    window.__ff_authedStaffId = authedStaffId;
    localStorage.setItem("ff_authedStaffId_v1", authedStaffId || "");
    
    console.log("[PIN] authed staff set", {
      authedStaffId,
      windowAuthed: window.__ff_authedStaffId,
      lsAuthed: localStorage.getItem("ff_authedStaffId_v1"),
    });
    
    window.__ff_authedStaffName = auth.name || undefined;
    
    const matchedName = auth.name || '';

    if (pinModalDoneTaskId) {
        markTaskDone(pinModalDoneTaskId, matchedName);
    }
    
    closePinModal();
}

// Expose PIN modal functions to window
window.openPinModal = openPinModal;
window.openPinModalForDone = openPinModalForDone;
window.closePinModal = closePinModal;
window.validatePinAndMove = validatePinAndMove;
window.validatePinAndMarkDone = validatePinAndMarkDone;

// Connect modal buttons when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        const pinCancelBtn = document.getElementById("pinCancelBtn");
        const pinSubmitBtn = document.getElementById("pinSubmitBtn");
        const pinModal = document.getElementById("pinModal");
        const pinModalBackdrop = pinModal?.querySelector('.pin-modal-backdrop');
        
        if (pinCancelBtn) pinCancelBtn.onclick = closePinModal;
        // Submit button logic is handled dynamically based on which modal was opened
        if (pinSubmitBtn) {
            pinSubmitBtn.onclick = () => {
                if (pinModalDoneTaskId) {
                    validatePinAndMarkDone();
                } else if (__pendingTaskId) {
                    validatePinAndMove();
                }
            };
        }
        if (pinModalBackdrop) {
            pinModalBackdrop.onclick = (e) => {
                if (e.target === pinModalBackdrop) closePinModal();
            };
        }
        
        // Allow Enter key to submit PIN
        const pinInput = document.getElementById("pinModalTaskInput");
        if (pinInput) {
            pinInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    if (pinModalDoneTaskId) {
                        validatePinAndMarkDone();
                    } else if (__pendingTaskId) {
                        validatePinAndMove();
                    }
                }
            });
        }
    });
} else {
    // DOM already loaded
    const pinCancelBtn = document.getElementById("pinCancelBtn");
    const pinSubmitBtn = document.getElementById("pinSubmitBtn");
    const pinModal = document.getElementById("pinModal");
    const pinModalBackdrop = pinModal?.querySelector('.pin-modal-backdrop');
    
    if (pinCancelBtn) pinCancelBtn.onclick = closePinModal;
    // Submit button logic is handled dynamically based on which modal was opened
    if (pinSubmitBtn) {
        pinSubmitBtn.onclick = () => {
            if (pinModalDoneTaskId) {
                validatePinAndMarkDone();
            } else if (__pendingTaskId) {
                validatePinAndMove();
            }
        };
    }
    if (pinModalBackdrop) {
        pinModalBackdrop.onclick = (e) => {
            if (e.target === pinModalBackdrop) closePinModal();
        };
    }
    
    // Allow Enter key to submit PIN
    const pinInput = document.getElementById("pinModalTaskInput");
    if (pinInput) {
        pinInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                if (pinModalDoneTaskId) {
                    validatePinAndMarkDone();
                } else if (__pendingTaskId) {
                    validatePinAndMove();
                }
            }
        });
    }
}

// =====================
// Expose Firestore functions for Tasks feature
// =====================
window.saveTaskCompletion = async function(completionData) {
  try {
    if (!currentSalonId) {
      console.warn("[Tasks] No salon ID available, cannot save to Firestore");
      return;
    }
    
    const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js");
    
    const completionsRef = collection(db, "salons", currentSalonId, "taskCompletions");
    
    await addDoc(completionsRef, {
      ...completionData,
      createdAt: serverTimestamp()
    });
    
    console.log("[Tasks] Task completion saved to Firestore");
  } catch(err) {
    console.error("[Tasks] Failed to save task completion to Firestore:", err);
    throw err;
  }
};

// Expose db for direct access if needed
window.db = db;
window.currentSalonId = currentSalonId;

// =====================
// Admin PIN Management (Firestore)
// =====================

// Get admin PIN from Firestore (salons/{salonId}/settings/adminPin)
async function getAdminPinFromFirestore() {
  try {
    const salonId = currentSalonId;
    if (!salonId) {
      console.warn("[AdminPIN] No salonId available");
      return null;
    }
    
    const settingsDocRef = doc(db, "salons", salonId, "settings", "main");
    const snap = await getDoc(settingsDocRef);
    
    if (snap.exists()) {
      const data = snap.data();
      return data.adminPin || null;
    }
    return null;
  } catch (error) {
    console.error("[AdminPIN] Error reading admin PIN from Firestore:", error);
    return null;
  }
}

// Update admin PIN in Firestore (salons/{salonId}/settings/adminPin)
async function updateAdminPinInFirestore(newPin) {
  try {
    const salonId = currentSalonId;
    if (!salonId) {
      throw new Error("No salonId available");
    }
    
    const settingsDocRef = doc(db, "salons", salonId, "settings", "main");
    const snap = await getDoc(settingsDocRef);
    
    if (snap.exists()) {
      // Document exists, update only adminPin field
      await updateDoc(settingsDocRef, {
        adminPin: newPin
      });
    } else {
      // Document doesn't exist, create it with only adminPin
      await setDoc(settingsDocRef, {
        adminPin: newPin
      });
    }
    
    console.log("[AdminPIN] Admin PIN updated in Firestore");
    return true;
  } catch (error) {
    console.error("[AdminPIN] Error updating admin PIN in Firestore:", error);
    throw error;
  }
}

// Check if current user is owner
async function isCurrentUserOwner() {
  try {
    const user = auth.currentUser;
    if (!user) return false;
    
    const userDocRef = doc(db, "users", user.uid);
    const snap = await getDoc(userDocRef);
    
    if (snap.exists()) {
      const data = snap.data();
      return data.role === "owner";
    }
    return false;
  } catch (error) {
    console.error("[AdminPIN] Error checking user role:", error);
    return false;
  }
}

// =====================
// Admin PIN Reset via Email (Cloud Functions)
// =====================

// Generate PIN reset link - sends email to owner
// Note: salonId is retrieved from the authenticated user's document by the Cloud Function
async function generatePinResetLink() {
  try {
    const generateLink = httpsCallable(functions, 'generatePinResetLink');
    const result = await generateLink({});
    return { success: true, data: result.data };
  } catch (error) {
    console.error("[AdminPIN] Error generating reset link:", error);
    throw error;
  }
}

// Verify PIN reset token
async function verifyPinResetToken(token) {
  try {
    const verifyToken = httpsCallable(functions, 'verifyPinResetToken');
    const result = await verifyToken({ token });
    return { success: true, data: result.data };
  } catch (error) {
    console.error("[AdminPIN] Error verifying token:", error);
    throw error;
  }
}

// Confirm PIN reset with new PIN
async function confirmPinReset(token, newPin) {
  try {
    const confirmReset = httpsCallable(functions, 'confirmPinReset');
    const result = await confirmReset({ token, newPin });
    return { success: true, data: result.data };
  } catch (error) {
    console.error("[AdminPIN] Error confirming reset:", error);
    throw error;
  }
}

// =====================
// Staff Invite Email
// =====================
async function ffSendStaffInviteEmail({ email, role, staffId, salonId }) {
  try {
    if (!email) return { ok: false, reason: "no_email" };
    const emailLower = String(email).trim().toLowerCase();
    const roleValue = String(role || "technician").toLowerCase();
    const payload = {
      email: emailLower,
      role: roleValue,
      staffId: staffId || null,
      ...(salonId != null && { salonId }),
    };
    const data = await callSendStaffInvite(payload);
    return { ok: true, token: data?.token || null, inviteLink: data?.inviteLink || null, data: data ?? null };
  } catch (err) {
    console.error("[Invite] sendStaffInvite failed", {
      code: err?.code || "unknown",
      message: err?.message || String(err),
      details: err?.details
    });
    return { ok: false, reason: "error" };
  }
}

// Debug: minimal callable ping to verify infra (Gen1 callable execution)
async function testCallablePing() {
  const functionsInstance = getFunctions(app, "us-central1");
  const ping = httpsCallable(functionsInstance, "testCallablePing");
  try {
    const res = await ping({ hello: "world" });
    console.log("PING RESULT", res.data);
    return res.data;
  } catch (err) {
    console.error("PING FAILED", {
      code: err?.code,
      message: err?.message,
      details: err?.details
    });
    throw err;
  }
}

/** Test A: Trigger Email (mail collection). Call: testSendEmail("your@email.com") */
async function testSendEmail(email) {
  const fn = getFunctions(app, "us-central1");
  const res = await httpsCallable(fn, "testSendEmail")({ to: email || auth.currentUser?.email });
  console.log("[Test A - Trigger Email]", res.data);
  return res.data;
}

/** Test B: Nodemailer (SMTP). Call: testSendEmailNodemailer("your@email.com") */
async function testSendEmailNodemailer(email) {
  const fn = getFunctions(app, "us-central1");
  const res = await httpsCallable(fn, "testSendEmailNodemailer")({ to: email || auth.currentUser?.email });
  console.log("[Test B - Nodemailer]", res.data);
  return res.data;
}

/** Test via Firestore (no Callable = no CORS). Writes to mail, Trigger Email sends. */
async function testEmailViaFirestore(email) {
  const to = (email || auth.currentUser?.email || "").trim().toLowerCase();
  if (!to) return alert("Sign in or pass email: testEmailViaFirestore('your@email.com')");
  try {
    await addDoc(collection(db, "mail"), {
      to,
      message: {
        subject: "[Fair Flow] Test – Trigger Email",
        text: "If you got this, Trigger Email extension works.",
        html: "<p>If you got this, Trigger Email extension works.</p>"
      }
    });
    console.log("[Test] Wrote to mail collection, to:", to);
    alert("Test sent. Check " + to + " (and spam folder).");
    return { ok: true };
  } catch (e) {
    console.error("[Test] Failed:", e);
    alert("Error: " + (e?.message || e));
    return { ok: false, error: e?.message };
  }
}

/** Run email test (bypasses CORS – writes directly to Firestore). */
async function runEmailTests(email) {
  return testEmailViaFirestore(email);
}

// Load tasks for a specific tab from localStorage and refresh UI
function loadTasksForTab(tab) {
    console.log(`Loading tasks for tab: ${tab}`);
    
    // Load tasks from localStorage (they will be empty after reset)
    const activeTasks = JSON.parse(localStorage.getItem(`ff_tasks_${tab}_active_v1`) || '[]');
    const pendingTasks = JSON.parse(localStorage.getItem(`ff_tasks_${tab}_pending_v1`) || '[]');
    const doneTasks = JSON.parse(localStorage.getItem(`ff_tasks_${tab}_done_v1`) || '[]');
    
    console.log(`Loaded tasks - Active: ${activeTasks.length}, Pending: ${pendingTasks.length}, Done: ${doneTasks.length}`);
    
    // Refresh the UI
    if (typeof window.renderTasksList === "function") {
        window.renderTasksList(tab);
    } else {
        console.warn("renderTasksList() not found, UI may not refresh");
    }
}

// Helper function to validate reset PIN
async function validateResetPin(pin) {
    // Detect local dev environment
    const isLocal = ["127.0.0.1", "localhost"].includes(window.location.hostname);

    if (isLocal) {
        // Local dev: skip Firebase, use only local validation
        if (typeof window.isAdminCode === "function") {
            return window.isAdminCode(pin);
        } else {
            // Fallback: check against settings from localStorage
            try {
                const settings = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
                return (settings.adminCode || "").toString() === pin.toString();
            } catch (e) {
                console.error("RESET: Error checking PIN", e);
                return false;
            }
        }
    } else {
        // Production: use verifyPinResetToken as primary, with fallbacks
        let isValidPin = false;
        if (typeof window.verifyPinResetToken === "function") {
            try {
                const result = await window.verifyPinResetToken(pin);
                isValidPin = result && result.success;
            } catch (e) {
                console.warn("RESET: verifyPinResetToken failed, falling back to other methods", e);
            }
        }
        
        // Fallback: use isAdminCode or legacy settings check
        if (!isValidPin) {
            if (typeof window.isAdminCode === "function") {
                isValidPin = window.isAdminCode(pin);
            } else {
                try {
                    const settings = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
                    isValidPin = (settings.adminCode || "").toString() === pin.toString();
                } catch (e) {
                    console.error("RESET: Error checking PIN", e);
                }
            }
        }
        return isValidPin;
    }
}

// Perform the actual reset (called after PIN validation)
// STATE ONLY: Clears progress/state, does NOT touch catalog or rebuild tasks
window.doResetCurrentTab = function doResetCurrentTab() {
    console.log("RESET: Performing STATE-ONLY reset for current tab");

    // 1) Resolve tab from window.currentTasksTab
    const tab = window.currentTasksTab;
    if (!tab) {
        // Show inline error in confirm modal if it's still open
        const errorMsg = document.getElementById("resetConfirmError");
        if (errorMsg) {
            errorMsg.textContent = "No tab selected. Reset cannot proceed.";
            errorMsg.style.display = "block";
        } else {
            alert("No tab selected. Reset cannot proceed.");
        }
        console.error("RESET: No tab selected");
        return;
    }

    console.log("RESET: Resetting state for tab:", tab);

    // 2) Clear storage STATE KEYS for this tab ONLY (using correct format from getTabStorageKey)
    // IMPORTANT: Preserve ACTIVE list (task roster) and only clear progress lists (done/pending).
    // Format: ff_tasks_${tab}_${status}_v1 (matches getTabStorageKey helper)
    const STORAGE_ACTIVE = `ff_tasks_${tab}_active_v1`;
    const STORAGE_DONE = `ff_tasks_${tab}_done_v1`;
    const STORAGE_PENDING = `ff_tasks_${tab}_pending_v1`;
    
    // Also remove legacy format (ffv24_tasks_...) for done/pending if they exist
    const STORAGE_ACTIVE_LEGACY = `ffv24_tasks_${tab}_active_v1`;
    const STORAGE_DONE_LEGACY = `ffv24_tasks_${tab}_done_v1`;
    const STORAGE_PENDING_LEGACY = `ffv24_tasks_${tab}_pending_v1`;
    
    // Also check for legacy format without _v1 suffix
    const STORAGE_ACTIVE_LEGACY2 = `ffv24_tasks_${tab}_active`;
    const STORAGE_DONE_LEGACY2 = `ffv24_tasks_${tab}_done`;
    const STORAGE_PENDING_LEGACY2 = `ffv24_tasks_${tab}_pending`;

    console.log("RESET: Clearing progress STATE keys (done/pending only, preserving active):", STORAGE_DONE, STORAGE_PENDING);
    
    // Remove progress state keys (done, pending) - NOT catalog and NOT active roster
    localStorage.removeItem(STORAGE_DONE);
    localStorage.removeItem(STORAGE_PENDING);
    
    // Remove legacy progress keys if they exist
    localStorage.removeItem(STORAGE_DONE_LEGACY);
    localStorage.removeItem(STORAGE_PENDING_LEGACY);
    localStorage.removeItem(STORAGE_DONE_LEGACY2);
    localStorage.removeItem(STORAGE_PENDING_LEGACY2);
    
    // Remove any "selected" keys for this tab if they exist
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes(tab) && (key.includes('selected') || key.includes('_selected_'))) {
            // Safety: Do NOT remove anything containing "catalog"
            if (!key.toLowerCase().includes('catalog')) {
                keysToRemove.push(key);
            }
        }
    }
    keysToRemove.forEach(key => {
        console.log("RESET: Removing selected key:", key);
        localStorage.removeItem(key);
    });

    console.log("RESET: Storage STATE keys deleted. Catalog preserved.");

    // 3) Clear in-memory UI state (ONLY state, not catalog)
    console.log("RESET: Clearing in-memory task UI state");
    
    // Clear selected task state
    if (typeof window.selectedTaskId !== 'undefined') {
        window.selectedTaskId = null;
    }
    if (typeof window.selectedTask !== 'undefined') {
        window.selectedTask = null;
    }
    
    // Clear active task state
    if (typeof window.activeTaskId !== 'undefined') {
        window.activeTaskId = null;
    }
    if (typeof window.activeTask !== 'undefined') {
        window.activeTask = null;
    }
    
    // Clear pending task state
    if (typeof window.pendingTaskId !== 'undefined') {
        window.pendingTaskId = null;
    }
    if (typeof window.pendingTask !== 'undefined') {
        window.pendingTask = null;
    }
    
    // Clear app.js module-level state
    if (typeof __pendingTaskId !== 'undefined') {
        __pendingTaskId = null;
    }
    if (typeof pinModalDoneTaskId !== 'undefined') {
        pinModalDoneTaskId = null;
    }
    
    // Clear cache objects (state cache, not catalog)
    if (typeof window.tasksCache !== 'undefined' && window.tasksCache) {
        if (window.tasksCache[tab]) {
            delete window.tasksCache[tab];
        }
    }
    if (typeof window.myListCache !== 'undefined' && window.myListCache) {
        if (window.myListCache[tab]) {
            delete window.myListCache[tab];
        }
    }
    
    console.log("RESET: In-memory state cleared");

    // 4) Normalize ACTIVE list from catalog: ensure all catalog tasks exist in active,
    //     and reset runtime status fields in ACTIVE ONLY (do not touch catalog).
    console.log("RESET: Normalizing active list from catalog for tab:", tab);
    try {
        // Load catalog object (template only)
        let catalogObj = {};
        try {
            const raw = localStorage.getItem("ff_tasks_catalog_v1");
            if (raw) {
                catalogObj = JSON.parse(raw);
            }
        } catch (e) {
            console.warn("RESET: Error parsing catalog from localStorage:", e);
        }
        if (!catalogObj || Object.keys(catalogObj).length === 0) {
            catalogObj = window.ff_tasks_catalog_v1 || {};
        }
        const catalogList = Array.isArray(catalogObj?.[tab]) ? catalogObj[tab] : (window.ff_tasks_catalog_v1?.[tab] || []);

        // Load existing active list (roster)
        const activeKey = `ff_tasks_${tab}_active_v1`;
        let activeTasks = [];
        try {
            const activeRaw = localStorage.getItem(activeKey);
            if (activeRaw) {
                activeTasks = JSON.parse(activeRaw) || [];
            }
        } catch (e) {
            console.warn("RESET: Error parsing active list:", e);
        }

        // Index existing active tasks by stable id
        const activeById = new Map();
        activeTasks.forEach(t => {
            if (!t || typeof t !== "object") return;
            const keyId = t.taskId || t.id;
            if (keyId) {
                activeById.set(keyId, t);
            }
        });

        // For yearly tab, only reset tasks that are due today or overdue (not completed)
        if (tab === 'yearly') {
            const now = new Date();
            // Only operate on tasks where ffIsYearlyTaskActive(task, now) is true
            const tasksToReset = Array.from(activeById.values()).filter(task => {
                if (!task || typeof task !== "object") return false;
                return ffIsYearlyTaskActive(task, now);
            });
            
            // Add missing due tasks from catalog (same pattern as weekly/monthly)
            if (Array.isArray(catalogList)) {
                catalogList.forEach(catalogTask => {
                    if (!catalogTask || typeof catalogTask !== "object") return;
                    const keyId = catalogTask.taskId || catalogTask.id;
                    if (!keyId) return;
                    
                    // Only add if task is active (due/overdue) per ffIsYearlyTaskActive
                    if (ffIsYearlyTaskActive(catalogTask, now)) {
                        // Check if already in tasksToReset
                        const exists = tasksToReset.some(t => {
                            const tId = t.taskId || t.id;
                            return tId && String(tId) === String(keyId);
                        });
                        
                        if (!exists) {
                            // Add from catalog
                            activeById.set(keyId, {
                                id: keyId,
                                taskId: keyId,
                                title: catalogTask.title || '',
                                instructions: catalogTask.instructions || catalogTask.info || catalogTask.details || "",
                                scheduleMonth: catalogTask.scheduleMonth,
                                scheduleDay: catalogTask.scheduleDay,
                                scheduleYear: catalogTask.scheduleYear
                            });
                        }
                    }
                });
            }
            
            // Rebuild tasksToReset from activeById (includes newly added catalog tasks)
            const allTasksToReset = Array.from(activeById.values()).filter(task => {
                if (!task || typeof task !== "object") return false;
                return ffIsYearlyTaskActive(task, now);
            });
            
            // Reset runtime fields for active tasks only
            const normalizedActive = allTasksToReset.map(task => {
                const keyId = task.taskId || task.id;
                if (!keyId) return null;
                const clone = { ...task };
                // Normalize identity fields
                clone.id = keyId;
                clone.taskId = keyId;
                // Ensure active flag exists and is true for active-list items
                clone.active = clone.active == null ? true : clone.active;
                // Remove transient runtime status fields
                delete clone.status;
                delete clone.completedBy;
                delete clone.assignedTo;
                delete clone.completedAt;
                delete clone.selected;
                delete clone.selectedBy;
                delete clone.selectedAt;
                delete clone.pending;
                delete clone.done;
                return clone;
            }).filter(Boolean);
            
            localStorage.setItem(activeKey, JSON.stringify(normalizedActive));
            console.log(`RESET: Yearly active list normalized (due/overdue only), count=${normalizedActive.length}`);
        } else {
            // Merge catalog tasks into active list (add missing only)
            if (Array.isArray(catalogList)) {
                catalogList.forEach(task => {
                    if (!task || typeof task !== "object") return;
                    const keyId = task.taskId || task.id;
                    if (!keyId) return;
                    if (!activeById.has(keyId)) {
                        activeById.set(keyId, {
                            id: keyId,
                            title: task.title,
                            instructions: task.instructions || task.info || task.details || ""
                        });
                    }
                });
            }

            // Reset runtime fields in ACTIVE ONLY (status/assignment/completion), preserve roster
            // and ensure stable id/taskId/active flags.
            const normalizedActive = Array.from(activeById.values()).map(task => {
                if (!task || typeof task !== "object") return null;
                const keyId = task.taskId || task.id;
                if (!keyId) return null;
                const clone = { ...task };
                // Normalize identity fields
                clone.id = keyId;
                clone.taskId = keyId;
                // Ensure active flag exists and is true for active-list items
                clone.active = clone.active == null ? true : clone.active;
                // Remove transient runtime status fields
                delete clone.status;
                delete clone.completedBy;
                delete clone.assignedTo;
                delete clone.completedAt;
                delete clone.selected;
                delete clone.selectedBy;
                delete clone.selectedAt;
                delete clone.pending;
                delete clone.done;
                return clone;
            }).filter(Boolean);

            localStorage.setItem(activeKey, JSON.stringify(normalizedActive));
            console.log(`RESET: Active list normalized for tab ${tab}, count=${normalizedActive.length}`);
        }
    } catch (e) {
        console.error("RESET: Error normalizing active list from catalog:", e);
        // Continue with reset even if active normalization fails
    }

    // 5) Rerender from existing storage (renderer will show tasks in MY LIST using catalog + active)
    if (typeof window.renderTasksList === "function") {
        // Call with force option if supported, otherwise call normally
        // The renderer should naturally show all tasks as SELECT in MY LIST when state is empty
        if (window.renderTasksList.length > 1) {
            // Function accepts options parameter
            window.renderTasksList(tab, { force: true });
        } else {
            // Function only accepts tab parameter
            window.renderTasksList(tab);
        }
        console.log("RESET: UI refreshed for tab:", tab);
    } else {
        console.warn("RESET: renderTasksList not found, UI may not refresh");
    }

    // Log to history after successful RESET
    const currentTab = (typeof getCurrentTasksTab === 'function') ? getCurrentTasksTab() : (window.currentTasksTab || tab || null);
    // Get actor identity same way as Task Selected/Completed
    const actor = (typeof getHistoryActor === 'function') ? getHistoryActor() : { role: 'Admin', name: 'Admin' };
    const workerName = actor.name || '-';
    addTasksHistoryEntry({
        action: `Tasks Reset: ${currentTab || ''}`.trim(),
        taskId: null,
        taskTitle: null,
        worker: workerName,
        role: actor.role || '-',
        performedBy: actor.name || '-',
        extra: currentTab ? { tab: currentTab, reset: true } : { reset: true }
    });

    console.log("RESET: STATE-ONLY reset complete for tab:", tab);
};

// Reset tasks for current active tab - opens modals
function resetTasksForCurrentTab() {
    console.log("RESET: Opening confirmation modal");

    // Get current tab
    const tab = window.currentTasksTab;
    
    // Get modal elements
    const confirmModal = document.getElementById("tasksResetConfirmModal");
    if (!confirmModal) {
        console.error("RESET: Confirmation modal not found");
        return;
    }

    // Get elements for updating modal content
    const tabLabelSpan = document.getElementById("resetConfirmTabLabel");
    const errorMsg = document.getElementById("resetConfirmError");
    const yesBtn = document.getElementById("resetConfirmYes");

    // Map tab to human label
    const tabLabels = {
        "opening": "Opening",
        "closing": "Closing",
        "weekly": "Weekly",
        "monthly": "Monthly",
        "yearly": "Yearly"
    };
    const tabLabel = tabLabels[tab] || (tab ? tab.charAt(0).toUpperCase() + tab.slice(1) : "");

    // Check if tab is missing
    if (!tab) {
        // Show error in modal
        if (errorMsg) {
            errorMsg.textContent = "No tab selected.";
            errorMsg.style.display = "block";
        }
        if (tabLabelSpan) {
            tabLabelSpan.textContent = "";
        }
        // Disable Yes button
        if (yesBtn) {
            yesBtn.disabled = true;
        }
        // Still show modal so user can see the error
        confirmModal.style.display = "flex";
        return;
    }

    // Tab exists - clear error and enable Yes button
    if (errorMsg) {
        errorMsg.textContent = "";
        errorMsg.style.display = "none";
    }
    if (tabLabelSpan) {
        tabLabelSpan.textContent = tabLabel;
    }
    if (yesBtn) {
        yesBtn.disabled = false;
    }

    // Show modal
    confirmModal.style.display = "flex";
}

// Expose functions to window for use in index.html
window.getAdminPinFromFirestore = getAdminPinFromFirestore;
// updateAdminPinInFirestore is NOT exposed - PIN can only be reset via email flow
window.isCurrentUserOwner = isCurrentUserOwner;
window.showLoginScreen = showLoginScreen;
window.generatePinResetLink = generatePinResetLink;
window.verifyPinResetToken = verifyPinResetToken;
window.confirmPinReset = confirmPinReset;
window.ffSendStaffInviteEmail = ffSendStaffInviteEmail;
window.ffInferImageExtension = ffInferImageExtension;
window.ffAssertImageFile = ffAssertImageFile;
window.ffUploadSalonBrandLogo = ffUploadSalonBrandLogo;
window.ffUploadStaffAvatar = ffUploadStaffAvatar;
window.ffSaveSalonLogoMeta = ffSaveSalonLogoMeta;
window.ffSaveStaffAvatarMeta = ffSaveStaffAvatarMeta;
window.resetTasksForCurrentTab = resetTasksForCurrentTab;
window.loadTasksForTab = loadTasksForTab;
window.validateResetPin = validateResetPin;
window.doResetCurrentTab = doResetCurrentTab;
window.testCallablePing = testCallablePing;
window.testSendEmail = testSendEmail;
window.testSendEmailNodemailer = testSendEmailNodemailer;
window.testEmailViaFirestore = testEmailViaFirestore;
window.runEmailTests = runEmailTests;

// Expose auth for owner check
window.auth = auth;

// =====================
// Tasks Tab Badge Helpers
// =====================

function ffSafeParseJSON(str, fallback) {
  try {
    if (!str || typeof str !== 'string') return fallback;
    const parsed = JSON.parse(str);
    return parsed !== null && parsed !== undefined ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

function ffIsTaskCompleted(task) {
  if (!task || typeof task !== 'object') return false;
  
  // Check status field (case-insensitive)
  const status = String(task.status || '').toLowerCase().trim();
  if (status === 'done' || status === 'completed') {
    return true;
  }
  
  // Check boolean completion flags
  if (task.completed === true || task.isCompleted === true) {
    return true;
  }
  if (task.done === true || task.isDone === true) {
    return true;
  }
  
  // Check completion timestamp/author fields
  if (task.completedAt || task.completedBy) {
    return true;
  }
  
  return false;
}

// ============================================
// Catalog Normalization Helpers
// ============================================

// Safe JSON parse with fallback
function safeParse(json, fallback = null) {
  try {
    if (!json) return fallback;
    return JSON.parse(json);
  } catch (e) {
    console.warn('[Catalog] Error parsing JSON:', e);
    return fallback;
  }
}

// Get raw catalog object (could be array or object)
function getCatalogRaw() {
  try {
    const raw = localStorage.getItem('ff_tasks_catalog_v1');
    if (!raw) return null;
    return safeParse(raw, null);
  } catch (e) {
    console.warn('[Catalog] Error reading catalog:', e);
    return null;
  }
}

// Get catalog array for a specific tab (normalizes array/object to array)
function getCatalogArray(tab) {
  try {
    const catalogObj = getCatalogRaw();
    if (!catalogObj) return [];
    
    const tabCatalog = catalogObj[tab];
    if (!tabCatalog) return [];
    
    // If already an array, return it
    if (Array.isArray(tabCatalog)) {
      return tabCatalog;
    }
    
    // If object map, convert to array
    if (typeof tabCatalog === 'object' && tabCatalog !== null) {
      return Object.values(tabCatalog);
    }
    
    return [];
  } catch (e) {
    console.warn('[Catalog] Error getting catalog array for tab:', tab, e);
    return [];
  }
}

// Update a catalog item by taskId (preserves catalog shape: array stays array, object stays object)
// Expose globally for use in index.html
window.updateCatalogItem = function(taskId, patch) {
  try {
    const catalogObj = getCatalogRaw();
    if (!catalogObj || typeof catalogObj !== 'object') {
      console.warn('[Catalog] Cannot update: catalog is not an object');
      return false;
    }
    
    // Try each tab
    const tabs = ['opening', 'closing', 'weekly', 'monthly', 'yearly'];
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tabCatalog = catalogObj[tab];
      if (!tabCatalog) continue;
      
      const taskIdStr = String(taskId).trim();
      
      // If array: find by id/taskId and update
      if (Array.isArray(tabCatalog)) {
        const index = tabCatalog.findIndex(item => {
          if (!item || typeof item !== 'object') return false;
          const itemId = String(item.taskId || item.id || '').trim();
          return itemId === taskIdStr;
        });
        
        if (index >= 0) {
          catalogObj[tab][index] = { ...tabCatalog[index], ...patch };
          localStorage.setItem('ff_tasks_catalog_v1', JSON.stringify(catalogObj));
          // Update window cache if exists
          if (window.ff_tasks_catalog_v1) {
            window.ff_tasks_catalog_v1[tab] = catalogObj[tab];
          }
          return true;
        }
      }
      // If object map: find key where item.id/taskId matches and update
      else if (typeof tabCatalog === 'object' && tabCatalog !== null) {
        // Check if taskId is a key
        if (tabCatalog[taskIdStr]) {
          catalogObj[tab][taskIdStr] = { ...tabCatalog[taskIdStr], ...patch };
          localStorage.setItem('ff_tasks_catalog_v1', JSON.stringify(catalogObj));
          // Update window cache if exists
          if (window.ff_tasks_catalog_v1) {
            window.ff_tasks_catalog_v1[tab] = catalogObj[tab];
          }
          return true;
        }
        
        // Search by value id/taskId
        for (const key in tabCatalog) {
          const item = tabCatalog[key];
          if (item && typeof item === 'object') {
            const itemId = String(item.taskId || item.id || '').trim();
            if (itemId === taskIdStr) {
              catalogObj[tab][key] = { ...item, ...patch };
              localStorage.setItem('ff_tasks_catalog_v1', JSON.stringify(catalogObj));
              // Update window cache if exists
              if (window.ff_tasks_catalog_v1) {
                window.ff_tasks_catalog_v1[tab] = catalogObj[tab];
              }
              return true;
            }
          }
        }
      }
    }
    
    return false; // Not found
  } catch (e) {
    console.error('[Catalog] Error updating catalog item:', e);
    return false;
  }
};

// Helper function to load weekly catalog and build a map by taskId
function ffGetWeeklyCatalogMap() {
  const catalogMap = new Map();
  try {
    const weeklyCatalog = getCatalogArray('weekly');
    
    weeklyCatalog.forEach(catalogTask => {
      if (catalogTask && typeof catalogTask === 'object') {
        const catalogId = catalogTask.taskId || catalogTask.id;
        if (catalogId) {
          catalogMap.set(String(catalogId).trim(), catalogTask);
        }
      }
    });
  } catch (e) {
    console.warn('[Weekly Schedule] Error loading catalog:', e);
  }
  return catalogMap;
}

// Helper function to check if a weekly task is due or overdue (scheduled for today or past)
function ffIsWeeklyTaskScheduledToday(taskId, nowDate) {
  if (!taskId) return true; // Fail-open: if no taskId, show it
  
  const now = nowDate || new Date();
  const todayWeekday = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  
  // Load catalog map
  const catalogMap = ffGetWeeklyCatalogMap();
  const catalogTask = catalogMap.get(String(taskId).trim());
  
  // If missing catalog entry, treat as "any" (show every day)
  if (!catalogTask) {
    return true;
  }
  
  const scheduleWeekdays = catalogTask.scheduleWeekdays;
  
  // If "any" or undefined, show every day
  if (scheduleWeekdays === 'any' || scheduleWeekdays === undefined) {
    return true;
  }
  
  // If array, check if today's weekday is included (due today) or any past weekday is included (overdue)
  if (Array.isArray(scheduleWeekdays)) {
    // If empty array, treat as "any" (fail-open)
    if (scheduleWeekdays.length === 0) {
      return true;
    }
    // Due today if today's weekday is in the list
    if (scheduleWeekdays.includes(todayWeekday)) {
      return true;
    }
    // Overdue if any weekday in the list is before today (in the current week cycle)
    // For simplicity, if task has scheduled weekdays and today is not one of them,
    // we consider it due if it was scheduled earlier in the week
    // This is a simplified check - in practice, weekly tasks are typically due on their scheduled day
    return false;
  }
  
  // Fallback: fail-open (show task)
  return true;
}

// Helper function to load monthly catalog and build a map by taskId
function ffGetMonthlyCatalogMap() {
  const catalogMap = new Map();
  try {
    const monthlyCatalog = getCatalogArray('monthly');
    
    monthlyCatalog.forEach(catalogTask => {
      if (catalogTask && typeof catalogTask === 'object') {
        const catalogId = catalogTask.taskId || catalogTask.id;
        if (catalogId) {
          catalogMap.set(String(catalogId).trim(), catalogTask);
        }
      }
    });
  } catch (e) {
    console.warn('[Monthly Schedule] Error loading catalog:', e);
  }
  return catalogMap;
}

// Helper function to check if a monthly task is scheduled for today
function ffIsMonthlyTaskScheduledToday(taskId, nowDate) {
  if (!taskId) return true; // Fail-open: if no taskId, show it
  
  const now = nowDate || new Date();
  const todayDayOfMonth = now.getDate(); // 1..31
  
  // Load catalog map
  const catalogMap = ffGetMonthlyCatalogMap();
  const catalogTask = catalogMap.get(String(taskId).trim());
  
  // If missing catalog entry, treat as "any" (show every day)
  if (!catalogTask) {
    return true;
  }
  
  const scheduleDayOfMonth = catalogTask.scheduleDayOfMonth;
  
  // If "any" or undefined, show every day
  if (scheduleDayOfMonth === 'any' || scheduleDayOfMonth === undefined) {
    return true;
  }
  
  // If number, check if due or overdue: scheduleDayOfMonth <= todayDayOfMonth
  if (typeof scheduleDayOfMonth === 'number' && scheduleDayOfMonth >= 1 && scheduleDayOfMonth <= 31) {
    return scheduleDayOfMonth <= todayDayOfMonth;
  }
  
  // If string that represents a number, parse and compare
  if (typeof scheduleDayOfMonth === 'string') {
    const n = Number(scheduleDayOfMonth);
    if (n >= 1 && n <= 31 && !isNaN(n)) {
      return n === todayDayOfMonth;
    }
  }
  
  // Fallback: fail-open (show task)
  return true;
}

function ffGetTaskIdSetFromStorage(key) {
  const idSet = new Set();
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return idSet;
    
    const parsed = ffSafeParseJSON(stored, null);
    if (parsed === null) return idSet;
    
    // Handle array storage
    if (Array.isArray(parsed)) {
      parsed.forEach(task => {
        if (!task || typeof task !== 'object') return;
        
        // Skip completed tasks
        if (ffIsTaskCompleted(task)) return;
        
        // Identifier priority: taskId || id || keyId || _id, fallback to title
        const identifier = task.taskId || task.id || task.keyId || task._id;
        if (identifier) {
          idSet.add(String(identifier).trim());
        } else if (task.title && String(task.title).trim()) {
          // Fallback to title only if non-empty
          idSet.add(String(task.title).trim());
        }
      });
    }
    // Handle object storage
    else if (typeof parsed === 'object') {
      Object.values(parsed).forEach(task => {
        if (!task || typeof task !== 'object') return;
        
        // Skip completed tasks
        if (ffIsTaskCompleted(task)) return;
        
        const identifier = task.taskId || task.id || task.keyId || task._id;
        if (identifier) {
          idSet.add(String(identifier).trim());
        } else if (task.title && String(task.title).trim()) {
          idSet.add(String(task.title).trim());
        }
      });
    }
  } catch (e) {
    console.error(`[Badge] Error extracting IDs from storage key ${key}:`, e);
  }
  return idSet;
}

// Helper: Get filtered MY LIST tasks for a tab (replicates renderTasksList filtering logic)
// Returns the same filtered list that MY LIST rendering uses, so badge count matches exactly
function getFilteredMyListTasksForTab(tab) {
  try {
    // Use getTabTasks if available (from index.html), otherwise read directly
    let activeTasks = [];
    if (typeof getTabTasks === 'function') {
      activeTasks = getTabTasks(tab, 'active');
    } else {
      // Fallback: read directly from localStorage
      const activeKey = typeof getTabStorageKey === 'function' 
        ? getTabStorageKey(tab, 'active')
        : `ff_tasks_${tab}_active_v1`;
      try {
        const stored = localStorage.getItem(activeKey);
        if (stored) {
          activeTasks = JSON.parse(stored) || [];
        }
      } catch (e) {
        console.warn('[Badge] Error reading active tasks:', e);
        return [];
      }
    }
    
    const now = new Date();
    
    // Filter tasks using the EXACT same logic as renderTasksList (lines 8819-8852 in index.html)
    const filteredTasks = activeTasks.filter(task => {
      if (!task || typeof task !== 'object') return false;
      const keyId = task.taskId || task.id;
      if (!keyId) return false;
      
      // Only consider tasks that are marked active (default true)
      const isActiveFlag = task.active == null ? true : !!task.active;
      if (!isActiveFlag) return false;
      
      // Hide tasks that are pending (status='pending' or assignedTo exists)
      if (task.status === 'pending' || !!task.assignedTo) return false;
      
      // For weekly tab, filter by scheduleWeekdays (only show tasks scheduled for today)
      if (tab === 'weekly' && typeof window.ffIsWeeklyTaskScheduledToday === 'function') {
        if (!window.ffIsWeeklyTaskScheduledToday(keyId, now)) {
          return false; // Skip this task - not scheduled for today
        }
      }
      
      // For monthly tab, filter by scheduleDayOfMonth (only show tasks scheduled for today)
      if (tab === 'monthly' && typeof window.ffIsMonthlyTaskScheduledToday === 'function') {
        if (!window.ffIsMonthlyTaskScheduledToday(keyId, now)) {
          return false; // Skip this task - not scheduled for today
        }
      }
      
      // For yearly tab, filter by active status (appears if today >= scheduled date AND not completed)
      if (tab === 'yearly' && typeof window.ffIsYearlyTaskActive === 'function') {
        if (!window.ffIsYearlyTaskActive(task, now)) {
          return false; // Skip this task - not active
        }
      }
      
      return true;
    });
    
    // Return only incomplete tasks (same as MY LIST rendering splits into incomplete/completed)
    return filteredTasks.filter(task => {
      const isCompleted = task.status === 'done' || !!task.completedAt;
      return !isCompleted;
    });
  } catch (e) {
    console.error(`[Badge] Error getting filtered MY LIST tasks for tab ${tab}:`, e);
    return [];
  }
}

function ffGetUncompletedCountForTab(tab) {
  try {
    // Use the same filtered list that MY LIST rendering uses
    // This ensures badge count matches exactly what's displayed in MY LIST
    const filteredIncompleteTasks = getFilteredMyListTasksForTab(tab);
    return filteredIncompleteTasks.length;
  } catch (e) {
    console.error(`[Badge] Error counting uncompleted for tab ${tab}:`, e);
    return 0;
  }
}

function ffIsAlertsActiveForTab(tab, nowDate) {
  try {
    const now = nowDate || new Date();
    
    // Load alert window settings
    const alertWindows = JSON.parse(localStorage.getItem('ff_tasks_alert_windows_v1') || '{}');
    const tabConfig = alertWindows[tab];
    
    // Handle opening/closing (time-based)
    if (tab === 'opening' || tab === 'closing') {
      if (!tabConfig || !tabConfig.startTime) {
        // No config found, use defaults
        const defaultTime = tab === 'opening' ? '09:00' : '18:00';
        const [defaultHour, defaultMinute] = defaultTime.split(':').map(Number);
        const nowHour = now.getHours();
        const nowMinute = now.getMinutes();
        const nowTotalMinutes = nowHour * 60 + nowMinute;
        const defaultTotalMinutes = defaultHour * 60 + defaultMinute;
        return nowTotalMinutes >= defaultTotalMinutes;
      }
      
      // Parse startTime (format: "HH:MM")
      const [startHour, startMinute] = tabConfig.startTime.split(':').map(Number);
      if (isNaN(startHour) || isNaN(startMinute)) {
        return true; // Invalid time, show badge
      }
      
      const nowHour = now.getHours();
      const nowMinute = now.getMinutes();
      const nowTotalMinutes = nowHour * 60 + nowMinute;
      const startTotalMinutes = startHour * 60 + startMinute;
      
      // Return true if current time >= start time
      return nowTotalMinutes >= startTotalMinutes;
    }
    
    // Handle weekly (time-based)
    if (tab === 'weekly') {
      if (!tabConfig || !tabConfig.startTime) {
        // No config found, use default
        const defaultTime = '09:00';
        const [defaultHour, defaultMinute] = defaultTime.split(':').map(Number);
        const nowHour = now.getHours();
        const nowMinute = now.getMinutes();
        const nowTotalMinutes = nowHour * 60 + nowMinute;
        const defaultTotalMinutes = defaultHour * 60 + defaultMinute;
        return nowTotalMinutes >= defaultTotalMinutes;
      }
      
      // Parse startTime (format: "HH:MM")
      const [startHour, startMinute] = tabConfig.startTime.split(':').map(Number);
      if (isNaN(startHour) || isNaN(startMinute)) {
        return true; // Invalid time, show badge
      }
      
      const nowHour = now.getHours();
      const nowMinute = now.getMinutes();
      const nowTotalMinutes = nowHour * 60 + nowMinute;
      const startTotalMinutes = startHour * 60 + startMinute;
      
      // Return true if current time >= start time
      return nowTotalMinutes >= startTotalMinutes;
    }
    
    // Handle monthly (time-based)
    if (tab === 'monthly') {
      if (!tabConfig || !tabConfig.startTime) {
        // No config found, use default
        const defaultTime = '09:00';
        const [defaultHour, defaultMinute] = defaultTime.split(':').map(Number);
        const nowHour = now.getHours();
        const nowMinute = now.getMinutes();
        const nowTotalMinutes = nowHour * 60 + nowMinute;
        const defaultTotalMinutes = defaultHour * 60 + defaultMinute;
        return nowTotalMinutes >= defaultTotalMinutes;
      }
      
      // Parse startTime (format: "HH:MM")
      const [startHour, startMinute] = tabConfig.startTime.split(':').map(Number);
      if (isNaN(startHour) || isNaN(startMinute)) {
        return true; // Invalid time, show badge
      }
      
      const nowHour = now.getHours();
      const nowMinute = now.getMinutes();
      const nowTotalMinutes = nowHour * 60 + nowMinute;
      const startTotalMinutes = startHour * 60 + startMinute;
      return nowTotalMinutes >= startTotalMinutes;
    }
    
    // Handle yearly (month+day-based) - check if any yearly task is scheduled for today AND alert time has passed
    if (tab === 'yearly') {
      // First check if any yearly task is scheduled for today (using the function)
      if (typeof window.ffIsYearlyTasksScheduledToday === 'function') {
        const hasTaskScheduledToday = window.ffIsYearlyTasksScheduledToday(now);
        if (!hasTaskScheduledToday) {
          return false; // No task scheduled for today, don't show alert
        }
      } else {
        // Function not available, check console for debugging
        console.warn('[Yearly Alert] ffIsYearlyTasksScheduledToday function not available');
        return false; // Fail-closed: function missing, don't show alert
      }
      
      // If there's a task scheduled for today, check if alert start time has passed
      if (!tabConfig || !tabConfig.startTime) {
        // No config found, use default - if task is scheduled, show alert immediately
        return true;
      }
      
      // Parse startTime (format: "HH:MM")
      const [startHour, startMinute] = tabConfig.startTime.split(':').map(Number);
      if (isNaN(startHour) || isNaN(startMinute)) {
        return true; // Invalid time, show badge (task is scheduled for today)
      }
      
      const nowHour = now.getHours();
      const nowMinute = now.getMinutes();
      const nowTotalMinutes = nowHour * 60 + nowMinute;
      const startTotalMinutes = startHour * 60 + startMinute;
      
      // Return true if current time >= start time (task is already scheduled for today)
      return nowTotalMinutes >= startTotalMinutes;
    }
    
    // Unknown tab type, show badge
    return true;
  } catch (e) {
    console.error(`[Badge] Error checking alerts active for tab ${tab}:`, e);
    return true; // On error, show badge
  }
}

function ffUpdateTasksTabBadges() {
  try {
    const tabs = ['opening', 'closing', 'weekly', 'monthly', 'yearly'];
    const now = new Date();
    
    tabs.forEach(tab => {
      const badge = document.querySelector(`.ff-tab-badge[data-ff-badge="${tab}"]`);
      if (!badge) return;
      
      const count = ffGetUncompletedCountForTab(tab);
      const alertsActive = ffIsAlertsActiveForTab(tab, now);
      
      // Show badge only if count > 0 AND alerts are active
      if (count > 0 && alertsActive) {
        badge.textContent = String(count);
        badge.style.display = 'inline-block';
      } else {
        badge.textContent = '';
        badge.style.display = 'none';
      }
    });
    
    // Also update home badge after tab badges
    if (typeof window.ffUpdateHomeTasksBadge === 'function') {
      window.ffUpdateHomeTasksBadge();
    }
  } catch (e) {
    console.error('[Badge] Error updating tab badges:', e);
  }
}

function ffUpdateHomeTasksBadge() {
  try {
    // Target TASKS nav badge specifically — NOT #ticketsNavBadge (first in DOM)
    const badge = document.querySelector('#tasksBtn .ff-home-tasks-badge');
    if (!badge) return;
    
    // Load alert window settings
    const alertWindows = JSON.parse(localStorage.getItem('ff_tasks_alert_windows_v1') || '{}');
    const tabs = ['opening', 'closing', 'weekly', 'monthly', 'yearly'];
    const now = new Date();
    
    let total = 0;
    
    tabs.forEach(tab => {
      const tabConfig = alertWindows[tab];
      
      // Only count if showOnHome is true AND alerts are active
      if (tabConfig && tabConfig.showOnHome === true) {
        const alertsActive = ffIsAlertsActiveForTab(tab, now);
        if (alertsActive) {
          const count = ffGetUncompletedCountForTab(tab);
          total += count;
        }
      }
    });
    
    // Update badge
    if (total > 0) {
      badge.textContent = String(total);
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = '';
      badge.style.display = 'none';
    }
  } catch (e) {
    console.error('[Badge] Error updating home tasks badge:', e);
  }
}

// Expose badge update functions
window.ffUpdateTasksTabBadges = ffUpdateTasksTabBadges;
window.ffUpdateHomeTasksBadge = ffUpdateHomeTasksBadge;

// Expose weekly schedule helper function
window.ffIsWeeklyTaskScheduledToday = ffIsWeeklyTaskScheduledToday;

// Expose monthly schedule helper function
window.ffIsMonthlyTaskScheduledToday = ffIsMonthlyTaskScheduledToday;

// ============================================
// Yearly Schedule Helper Functions
// ============================================

// Get yearly catalog map (taskId -> catalogTask)
// Helper to normalize month index (handles both 0-based and 1-based)
function normalizeMonthIndex(monthValue) {
  const rawMonth = Number(monthValue);
  if (!Number.isFinite(rawMonth)) return null;
  
  if (rawMonth >= 1 && rawMonth <= 12) {
    return rawMonth - 1;  // 1-based (Jan=1) -> 0-based (Jan=0)
  } else if (rawMonth >= 0 && rawMonth <= 11) {
    return rawMonth; // 0-based (Jan=0) -> already 0-based
  }
  return null; // Invalid
}

// Helper to get yearly task due date as Date object
function ffGetYearlyDueDate(task, nowDate) {
  if (!task || typeof task !== 'object') return null;
  
  const now = nowDate || new Date();
  const currentYear = now.getFullYear();
  
  // Get schedule from task (prefer task fields, fallback to catalog lookup)
  let scheduleMonth = task.scheduleMonth;
  let scheduleDay = task.scheduleDay;
  let scheduleYear = task.scheduleYear; // May be undefined for legacy tasks
  
  // If not in task, try catalog lookup
  if ((scheduleMonth === undefined || scheduleMonth === null) || 
      (scheduleDay === undefined || scheduleDay === null) ||
      (scheduleYear === undefined)) {
    const taskId = task.taskId || task.id;
    if (taskId) {
      const catalogMap = ffGetYearlyCatalogMap();
      const catalogTask = catalogMap.get(String(taskId).trim());
      if (catalogTask) {
        if (scheduleMonth === undefined || scheduleMonth === null) {
          scheduleMonth = catalogTask.scheduleMonth;
        }
        if (scheduleDay === undefined || scheduleDay === null) {
          scheduleDay = catalogTask.scheduleDay;
        }
        if (scheduleYear === undefined) {
          scheduleYear = catalogTask.scheduleYear;
        }
      }
    }
  }
  
  // FAIL-CLOSED: Missing or invalid date
  if (scheduleMonth === undefined || scheduleMonth === null || 
      scheduleDay === undefined || scheduleDay === null) {
    return null;
  }
  
  // Normalize month index
  const monthIndex = normalizeMonthIndex(scheduleMonth);
  if (monthIndex === null) return null;
  
  // Validate day
  const dayNum = Number(scheduleDay);
  if (!Number.isFinite(dayNum) || dayNum < 1 || dayNum > 31) {
    return null;
  }
  
  // Use scheduleYear if present, else default to currentYear (for legacy tasks)
  const yearToUse = scheduleYear !== undefined ? scheduleYear : currentYear;
  
  // Build taskDue date: Date(yearToUse, monthIndex, dayNum) at 00:00 local
  return new Date(yearToUse, monthIndex, dayNum, 0, 0, 0, 0);
}

function ffGetYearlyCatalogMap() {
  const catalogMap = new Map();
  try {
    const yearlyCatalog = getCatalogArray('yearly');
    
    yearlyCatalog.forEach(catalogTask => {
      if (catalogTask && typeof catalogTask === 'object') {
        const catalogId = catalogTask.taskId || catalogTask.id;
        if (catalogId) {
          catalogMap.set(String(catalogId).trim(), catalogTask);
        }
      }
    });
  } catch (e) {
    console.warn('[Yearly Schedule] Error loading catalog:', e);
  }
  return catalogMap;
}

// Helper: Read Yearly tasks from the correct source
// Primary: ff_tasks_yearly_active_v1, fallback to ff_tasks_yearly_pending_v1 for backward compatibility
function readYearlySource() {
  try {
    // Try primary source first
    const activeKey = 'ff_tasks_yearly_active_v1';
    const activeRaw = localStorage.getItem(activeKey);
    if (activeRaw) {
      const activeList = JSON.parse(activeRaw);
      if (Array.isArray(activeList) && activeList.length > 0) {
        return activeList;
      }
    }
    
    // Fallback to pending for backward compatibility
    const pendingKey = 'ff_tasks_yearly_pending_v1';
    const pendingRaw = localStorage.getItem(pendingKey);
    if (pendingRaw) {
      const pendingList = JSON.parse(pendingRaw);
      if (Array.isArray(pendingList)) {
        return pendingList;
      }
    }
    
    return [];
  } catch (e) {
    console.warn('[Yearly Source] Error reading yearly source:', e);
    return [];
  }
}

// Helper: Read Yearly done list
function readYearlyDone() {
  try {
    const doneKey = 'ff_tasks_yearly_done_v1';
    const doneRaw = localStorage.getItem(doneKey);
    if (!doneRaw) {
      return [];
    }
    
    const doneList = JSON.parse(doneRaw);
    if (Array.isArray(doneList)) {
      return doneList;
    }
    
    return [];
  } catch (e) {
    console.warn('[Yearly Done] Error reading yearly done list:', e);
    return [];
  }
}

// Helper: Extract (month, day) from a task or catalog item
// Returns { month: 1-12, day: 1-31 } or null if cannot parse
// Checks task object first (preferred), then catalog item (fallback)
function extractYearlyMonthDay(task, catalogItem) {
  if (!task && !catalogItem) return null;
  
  // Month name map (for parsing strings like "Dec 31")
  const monthMap = {
    'jan': 1, 'january': 1,
    'feb': 2, 'february': 2,
    'mar': 3, 'march': 3,
    'apr': 4, 'april': 4,
    'may': 5,
    'jun': 6, 'june': 6,
    'jul': 7, 'july': 7,
    'aug': 8, 'august': 8,
    'sep': 9, 'sept': 9, 'september': 9,
    'oct': 10, 'october': 10,
    'nov': 11, 'november': 11,
    'dec': 12, 'december': 12
  };
  
  // Helper to parse month/day from a source object
  function tryExtractFrom(obj) {
    if (!obj || typeof obj !== 'object') return null;
    
    // First, try numeric fields (check in order of preference)
    let month = obj.scheduleMonth !== undefined ? obj.scheduleMonth : 
                (obj.month !== undefined ? obj.month : 
                 (obj.m !== undefined ? obj.m : null));
    let day = obj.scheduleDay !== undefined ? obj.scheduleDay : 
              (obj.day !== undefined ? obj.day : 
               (obj.d !== undefined ? obj.d : null));
    
    // If we have both numeric fields, validate and return
    if (month !== undefined && month !== null && day !== undefined && day !== null) {
      const monthNum = typeof month === 'number' ? month : 
                       (typeof month === 'string' && /^\d+$/.test(month)) ? parseInt(month, 10) : null;
      const dayNum = typeof day === 'number' ? day : 
                     (typeof day === 'string' && /^\d+$/.test(day)) ? parseInt(day, 10) : null;
      
      if (monthNum !== null && monthNum >= 1 && monthNum <= 12 && 
          dayNum !== null && dayNum >= 1 && dayNum <= 31) {
        return { month: monthNum, day: dayNum };
      }
    }
    
    // Try string date fields (check multiple possible field names)
    const dateFields = ['date', 'dateLabel', 'scheduleDate', 'scheduleLabel', 'yearlyDate', 'dateText'];
    for (let i = 0; i < dateFields.length; i++) {
      const dateValue = obj[dateFields[i]];
      if (dateValue === undefined || dateValue === null) continue;
      
      const dateStr = String(dateValue).trim();
      if (!dateStr) continue;
      
      // Try format: "Dec 31" or "December 31" (month name + day)
      const monthNameMatch = dateStr.match(/^([a-z]+)\s+(\d+)$/i);
      if (monthNameMatch) {
        const monthName = monthNameMatch[1].toLowerCase();
        const dayNum = parseInt(monthNameMatch[2], 10);
        const monthNum = monthMap[monthName];
        
        if (monthNum && dayNum >= 1 && dayNum <= 31) {
          return { month: monthNum, day: dayNum };
        }
      }
      
      // Try format: "12/31" or "12-31" (numeric month/day)
      const numericMatch = dateStr.match(/^(\d+)[\s\/\-]+(\d+)$/);
      if (numericMatch) {
        const monthNum = parseInt(numericMatch[1], 10);
        const dayNum = parseInt(numericMatch[2], 10);
        
        if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
          return { month: monthNum, day: dayNum };
        }
      }
    }
    
    return null;
  }
  
  // Try task object first (preferred)
  const taskResult = tryExtractFrom(task);
  if (taskResult) return taskResult;
  
  // Try catalog item as fallback
  const catalogResult = tryExtractFrom(catalogItem);
  if (catalogResult) return catalogResult;
  
  return null;
}

// Check if a yearly task is active (appears in MY LIST/PENDING)
// Logic: appears if has valid date AND today >= scheduled date AND not completed in current year
// If not completed, continues to appear every day after until completed
function ffIsYearlyTaskActive(task, nowDate) {
  if (!task || typeof task !== 'object') return false;
  
  const now = nowDate || new Date();
  const currentYear = now.getFullYear();
  
  // Check if completed in scheduleYear (use scheduleYear from task, or default to currentYear for legacy)
  const taskId = task.taskId || task.id;
  const scheduleYear = task.scheduleYear; // May be undefined for legacy tasks
  const checkYear = scheduleYear !== undefined ? scheduleYear : currentYear; // Use scheduleYear if present
  
  if (taskId) {
    try {
      // Use getTabStorageKey for standard storage key
      const doneKey = (typeof getTabStorageKey === 'function')
        ? getTabStorageKey('yearly', 'done')
        : 'ff_tasks_yearly_done_v1';
      const doneList = JSON.parse(localStorage.getItem(doneKey) || '[]');
      const completedForYear = doneList.some(doneTask => {
        const doneTaskId = doneTask.taskId || doneTask.id;
        if (String(doneTaskId).trim() !== String(taskId).trim()) return false;
        // Check if completed for the scheduleYear
        const completedYear = doneTask.completedYear;
        if (completedYear === checkYear) return true;
        // Fallback: check completedAt timestamp if completedYear is missing
        if (doneTask.completedAt) {
          const completedDate = new Date(doneTask.completedAt);
          return completedDate.getFullYear() === checkYear;
        }
        return false;
      });
      if (completedForYear) {
        return false; // Completed for this scheduleYear, don't show
      }
    } catch (e) {
      console.warn('[Yearly Active Check] Error checking done list:', e);
    }
  }
  
  // Check if task is completed (local status check)
  const isCompleted = task.status === 'done' || !!task.completedAt || 
                      task.completed === true || task.isCompleted === true ||
                      task.done === true || task.isDone === true;
  
  if (isCompleted) {
    return false; // Completed tasks don't appear
  }
  
  // Get due date
  const taskDue = ffGetYearlyDueDate(task, now);
  if (!taskDue) return false; // Invalid date
  
  // Build todayStart: today at 00:00 (local)
  const todayStart = new Date(currentYear, now.getMonth(), now.getDate(), 0, 0, 0, 0);
  
  // Show task in MY LIST ONLY if taskDue <= todayStart
  return taskDue.getTime() <= todayStart.getTime();
}

// Legacy function for backward compatibility (used by auto-reset)
// Check if a yearly task is scheduled for today (month+day) - FAIL-CLOSED
function ffIsYearlyTaskScheduledToday(taskId, nowDate) {
  if (!taskId) return false; // Fail-closed: if no taskId, don't show it
  
  const now = nowDate || new Date();
  const todayMonth = now.getMonth() + 1; // 1..12 (JS getMonth() returns 0..11)
  const todayDay = now.getDate(); // 1..31
  
  // Load catalog map
  const catalogMap = ffGetYearlyCatalogMap();
  const catalogTask = catalogMap.get(String(taskId).trim());
  
  // If missing catalog entry, fail-closed (don't show)
  if (!catalogTask) {
    return false;
  }
  
  const scheduleMonth = catalogTask.scheduleMonth;
  const scheduleDay = catalogTask.scheduleDay;
  
  // If either is missing/invalid, fail-closed (date is required)
  if (scheduleMonth === undefined || scheduleMonth === null || 
      scheduleDay === undefined || scheduleDay === null) {
    return false;
  }
  
  // Parse and validate
  const monthNum = typeof scheduleMonth === 'number' ? scheduleMonth : 
                   (typeof scheduleMonth === 'string' && /^\d+$/.test(scheduleMonth)) ? parseInt(scheduleMonth, 10) : null;
  const dayNum = typeof scheduleDay === 'number' ? scheduleDay : 
                 (typeof scheduleDay === 'string' && /^\d+$/.test(scheduleDay)) ? parseInt(scheduleDay, 10) : null;
  
  // If invalid values, fail-closed
  if (monthNum === null || monthNum < 1 || monthNum > 12 || 
      dayNum === null || dayNum < 1 || dayNum > 31) {
    return false;
  }
  
  // Both valid - compare with today
  return monthNum === todayMonth && dayNum === todayDay;
}

// Check if ANY Yearly task is scheduled for today AND not completed
// Returns true if there is at least one Yearly task matching today's month/day
window.ffIsYearlyTasksScheduledToday = function(date = new Date()) {
  try {
    const now = date instanceof Date ? date : new Date(date);
    const todayMonth = now.getMonth() + 1; // 1..12 (JS getMonth() returns 0..11)
    const todayDay = now.getDate(); // 1..31
    
    // Debug logging (behind existing debug flag if available)
    const debugMode = window.__ffDebugYearlyAlerts || false;
    if (debugMode) {
      console.log('[Yearly Alert] Evaluating yearly tasks for', todayMonth + '/' + todayDay);
    }
    
    // Read yearly source (primary: active, fallback: pending)
    const yearlyList = readYearlySource();
    if (debugMode) {
      console.log('[Yearly Alert] Read', yearlyList.length, 'tasks from source');
    }
    
    // Read done list to exclude completed items - build Set of completed IDs
    const doneList = readYearlyDone();
    const doneTaskIds = new Set();
    doneList.forEach(doneTask => {
      if (doneTask && typeof doneTask === 'object') {
        const taskId = doneTask.taskId || doneTask.id;
        if (taskId) {
          doneTaskIds.add(String(taskId).trim());
        }
      }
    });
    
    // Load catalog map to get schedule info (for fallback lookup)
    const catalogMap = ffGetYearlyCatalogMap();
    
    // Check each task to see if it matches today's month/day
    for (let i = 0; i < yearlyList.length; i++) {
      const task = yearlyList[i];
      if (!task || typeof task !== 'object') continue;
      
      // Skip if already completed
      const taskId = task.taskId || task.id;
      if (taskId && doneTaskIds.has(String(taskId).trim())) {
        if (debugMode) {
          console.log('[Yearly Alert] Task', taskId, 'is already done, skipping');
        }
        continue;
      }
      
      // Get catalog item for this task (for fallback lookup)
      const catalogTask = taskId ? catalogMap.get(String(taskId).trim()) : null;
      
      // Extract month/day using the robust helper (checks task first, then catalog)
      const monthDay = extractYearlyMonthDay(task, catalogTask);
      
      if (!monthDay) {
        if (debugMode) {
          // Log raw date fields found for first few tasks
          if (i < 3) {
            const rawFields = {};
            ['date', 'dateLabel', 'scheduleDate', 'scheduleLabel', 'yearlyDate', 'dateText', 
             'scheduleMonth', 'scheduleDay', 'month', 'day', 'm', 'd'].forEach(field => {
              if (task[field] !== undefined) rawFields[field] = task[field];
            });
            if (catalogTask) {
              ['date', 'dateLabel', 'scheduleDate', 'scheduleLabel', 'yearlyDate', 'dateText', 
               'scheduleMonth', 'scheduleDay', 'month', 'day', 'm', 'd'].forEach(field => {
                if (catalogTask[field] !== undefined && !rawFields[field]) {
                  rawFields['catalog.' + field] = catalogTask[field];
                }
              });
            }
            console.log('[Yearly Alert] Task', taskId, 'could not parse date from fields:', rawFields);
          }
          console.log('[Yearly Alert] Task', taskId, 'missing/invalid date, skipping');
        }
        continue;
      }
      
      // Log parsed result for first few tasks (debug mode)
      if (debugMode && i < 3) {
        console.log('[Yearly Alert] Task', taskId, 'parsed date:', monthDay.month + '/' + monthDay.day);
      }
      
      // Check if due TODAY: exact match (month == todayMonth AND day == todayDay)
      // Yearly tasks are "once per year" - if date already passed, it's scheduled for next year
      const isDueToday = (monthDay.month === todayMonth && monthDay.day === todayDay);
      
      if (isDueToday) {
        if (debugMode) {
          console.log('[Yearly Alert] Found task due today:', taskId, 'scheduled for', monthDay.month + '/' + monthDay.day, '(today:', todayMonth + '/' + todayDay + ')');
          console.log('[Yearly Alert] Returning true');
        }
        return true;
      }
    }
    
    if (debugMode) {
      console.log('[Yearly Alert] No yearly tasks scheduled for today, returning false');
    }
    return false;
  } catch (e) {
    console.error('[Yearly Alert] Error in ffIsYearlyTasksScheduledToday:', e);
    return false; // Fail-closed: on error, don't show alert
  }
};

// Expose yearly helper functions
window.ffIsYearlyTaskActive = ffIsYearlyTaskActive;
window.ffIsYearlyTaskScheduledToday = ffIsYearlyTaskScheduledToday;

// ============================================
// Auto-Reset Helper Functions (Opening tab only)
// ============================================

// Get today's date as "YYYY-MM-DD" in local timezone
function ffGetTodayLocalISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse "HH:MM" time string to minutes since midnight
function ffParseHHMMToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const parts = timeStr.split(':');
  if (parts.length !== 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parseInt(parts[1], 10);
  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return hour * 60 + minute;
}

// Get auto-reset config for a tab (with defaults)
function ffGetAutoResetConfig(tab) {
  if (tab !== 'opening' && tab !== 'closing' && tab !== 'weekly' && tab !== 'monthly' && tab !== 'yearly') return null;
  
  try {
    const alertWindows = JSON.parse(localStorage.getItem('ff_tasks_alert_windows_v1') || '{}');
    const tabConfig = alertWindows[tab] || {};
    
    return {
      autoResetEnabled: tabConfig.autoResetEnabled === true,
      autoResetTime: tabConfig.autoResetTime || '21:00'
    };
  } catch (e) {
    console.warn('[Auto-Reset] Error loading config:', e);
    return {
      autoResetEnabled: false,
      autoResetTime: '21:00'
    };
  }
}

// Get auto-reset state (last run date)
function ffGetAutoResetState(tab) {
  if (tab !== 'opening' && tab !== 'closing' && tab !== 'weekly' && tab !== 'monthly' && tab !== 'yearly') return null;
  
  try {
    const state = JSON.parse(localStorage.getItem('ff_tasks_auto_reset_state_v1') || '{}');
    return state[tab] || {};
  } catch (e) {
    console.warn('[Auto-Reset] Error loading state:', e);
    return {};
  }
}

// Set auto-reset last run date
function ffSetAutoResetLastRun(tab, todayISO) {
  if (tab !== 'opening' && tab !== 'closing' && tab !== 'weekly' && tab !== 'monthly' && tab !== 'yearly') return;
  
  try {
    const state = JSON.parse(localStorage.getItem('ff_tasks_auto_reset_state_v1') || '{}');
    if (!state[tab]) {
      state[tab] = {};
    }
    state[tab].lastRunDate = todayISO;
    localStorage.setItem('ff_tasks_auto_reset_state_v1', JSON.stringify(state));
  } catch (e) {
    console.error('[Auto-Reset] Error saving state:', e);
  }
}

// Main auto-reset function for Opening tab
window.ffMaybeAutoResetOpening = function(nowDate) {
  try {
    const tab = 'opening';
    const now = nowDate || new Date();
    
    // Get config
    const config = ffGetAutoResetConfig(tab);
    if (!config || !config.autoResetEnabled) {
      return; // Auto-reset not enabled
    }
    
    // Check if current time >= reset time
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const resetMinutes = ffParseHHMMToMinutes(config.autoResetTime);
    if (resetMinutes === null) {
      console.warn('[Auto-Reset] Invalid reset time:', config.autoResetTime);
      return;
    }
    
    if (nowMinutes < resetMinutes) {
      return; // Not yet time for reset
    }
    
    // Check if already run today
    const todayISO = ffGetTodayLocalISO();
    const state = ffGetAutoResetState(tab);
    if (state.lastRunDate === todayISO) {
      return; // Already run today
    }
    
    // Check if all Opening tasks are completed
    if (typeof ffGetUncompletedCountForTab !== 'function') {
      console.warn('[Auto-Reset] ffGetUncompletedCountForTab not available');
      return;
    }
    
    const uncompleted = ffGetUncompletedCountForTab(tab);
    if (uncompleted !== 0) {
      return; // Not all tasks completed
    }
    
    // All conditions met - perform reset
    console.log('[Auto-Reset] All Opening tasks completed, performing auto-reset at', config.autoResetTime);
    
    // Call reset function for opening tab (uses existing reset logic via getTabStorageKey)
    if (typeof window.resetTasksForTab === 'function') {
      window.resetTasksForTab('opening');
      
      // Mark as run today
      ffSetAutoResetLastRun(tab, todayISO);
      
      console.log('[Auto-Reset] Auto-reset completed for Opening tab');
    } else {
      console.error('[Auto-Reset] resetTasksForTab function not found');
    }
    
  } catch (e) {
    console.error('[Auto-Reset] Error in ffMaybeAutoResetOpening:', e);
  }
};

// Main auto-reset function for Closing tab
window.ffMaybeAutoResetClosing = function(nowDate) {
  try {
    const tab = 'closing';
    const now = nowDate || new Date();
    
    // Get config
    const config = ffGetAutoResetConfig(tab);
    if (!config || !config.autoResetEnabled) {
      return; // Auto-reset not enabled
    }
    
    // Check if current time >= reset time
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const resetMinutes = ffParseHHMMToMinutes(config.autoResetTime);
    if (resetMinutes === null) {
      console.warn('[Auto-Reset] Invalid reset time:', config.autoResetTime);
      return;
    }
    
    if (nowMinutes < resetMinutes) {
      return; // Not yet time for reset
    }
    
    // Check if already run today
    const todayISO = ffGetTodayLocalISO();
    const state = ffGetAutoResetState(tab);
    if (state.lastRunDate === todayISO) {
      return; // Already run today
    }
    
    // Check if all Closing tasks are completed
    if (typeof ffGetUncompletedCountForTab !== 'function') {
      console.warn('[Auto-Reset] ffGetUncompletedCountForTab not available');
      return;
    }
    
    const uncompleted = ffGetUncompletedCountForTab(tab);
    if (uncompleted !== 0) {
      return; // Not all tasks completed
    }
    
    // All conditions met - perform reset
    console.log('[Auto-Reset] All Closing tasks completed, performing auto-reset at', config.autoResetTime);
    
    // Call reset function for closing tab (uses existing reset logic via getTabStorageKey)
    if (typeof window.resetTasksForTab === 'function') {
      window.resetTasksForTab('closing');
      
      // Mark as run today
      ffSetAutoResetLastRun(tab, todayISO);
      
      console.log('[Auto-Reset] Auto-reset completed for Closing tab');
    } else {
      console.error('[Auto-Reset] resetTasksForTab function not found');
    }
    
  } catch (e) {
    console.error('[Auto-Reset] Error in ffMaybeAutoResetClosing:', e);
  }
};

// Helper function to check if ANY weekly task is scheduled for today
function ffHasWeeklyTasksScheduledToday(nowDate) {
  try {
    const now = nowDate || new Date();
    const catalogRaw = localStorage.getItem('ff_tasks_catalog_v1');
    if (!catalogRaw) return false;
    
    const catalogObj = JSON.parse(catalogRaw);
    const weeklyCatalog = catalogObj.weekly || [];
    
    // Check if at least one task is scheduled for today
    for (let i = 0; i < weeklyCatalog.length; i++) {
      const catalogTask = weeklyCatalog[i];
      if (!catalogTask || typeof catalogTask !== 'object') continue;
      
      const taskId = catalogTask.taskId || catalogTask.id;
      if (!taskId) continue;
      
      // Use existing helper to check if this task is scheduled today
      if (typeof window.ffIsWeeklyTaskScheduledToday === 'function') {
        if (window.ffIsWeeklyTaskScheduledToday(taskId, now)) {
          return true; // Found at least one task scheduled for today
        }
      } else {
        // Fallback: if helper not available, treat missing scheduleWeekdays as 'any' (scheduled)
        const scheduleWeekdays = catalogTask.scheduleWeekdays;
        if (scheduleWeekdays === 'any' || scheduleWeekdays === undefined) {
          return true;
        }
      }
    }
    
    return false; // No tasks scheduled for today
  } catch (e) {
    console.warn('[Auto-Reset] Error checking weekly tasks scheduled today:', e);
    return false; // Fail-closed: don't reset if we can't determine
  }
}

// Main auto-reset function for Weekly tab (today-only reset)
window.ffMaybeAutoResetWeekly = function(nowDate) {
  try {
    const tab = 'weekly';
    const now = nowDate || new Date();
    
    // Get config
    const config = ffGetAutoResetConfig(tab);
    if (!config || !config.autoResetEnabled) {
      return; // Auto-reset not enabled
    }
    
    // Check if current time >= reset time
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const resetMinutes = ffParseHHMMToMinutes(config.autoResetTime);
    if (resetMinutes === null) {
      console.warn('[Auto-Reset] Invalid reset time:', config.autoResetTime);
      return;
    }
    
    if (nowMinutes < resetMinutes) {
      return; // Not yet time for reset
    }
    
    // Check if already run today
    const todayISO = ffGetTodayLocalISO();
    const state = ffGetAutoResetState(tab);
    if (state.lastRunDate === todayISO) {
      return; // Already run today
    }
    
    // Check if ANY weekly task is scheduled for today (prevent useless resets)
    if (!ffHasWeeklyTasksScheduledToday(now)) {
      return; // No tasks scheduled for today, skip reset
    }
    
    console.log('[AUTO_RESET][WEEKLY] running', now);
    
    // Perform rollover for unfinished tasks (regardless of completion status)
    // This advances unfinished tasks scheduled for today to tomorrow
    if (typeof window.resetWeeklyForToday === 'function') {
      window.resetWeeklyForToday(now);
    } else {
      console.warn('[AUTO_RESET][WEEKLY] resetWeeklyForToday not exposed');
      return;
    }
    
    // Check if all Weekly tasks scheduled for TODAY are completed
    if (typeof ffGetUncompletedCountForTab !== 'function') {
      console.warn('[Auto-Reset] ffGetUncompletedCountForTab not available');
      // Mark as run today even if we can't check completion (rollover happened)
      ffSetAutoResetLastRun(tab, todayISO);
      return;
    }
    
    const uncompleted = ffGetUncompletedCountForTab(tab);
    if (uncompleted !== 0) {
      // Not all tasks completed - rollover already happened above
      // Mark as run today to prevent multiple rollovers
      ffSetAutoResetLastRun(tab, todayISO);
      console.log('[Auto-Reset] Weekly rollover completed (some tasks still unfinished)');
      return;
    }
    
    // All conditions met - rollover already done above
    console.log('[Auto-Reset] All Weekly tasks for today completed, rollover completed at', config.autoResetTime);
    
    // Mark as run today
    ffSetAutoResetLastRun(tab, todayISO);
    
    console.log('[Auto-Reset] Today-only reset completed for Weekly tab');
    
  } catch (e) {
    console.error('[Auto-Reset] Error in ffMaybeAutoResetWeekly:', e);
  }
};

// Helper function to check if ANY monthly task is scheduled for today
function ffHasMonthlyTasksScheduledToday(nowDate) {
  try {
    const now = nowDate || new Date();
    const catalogRaw = localStorage.getItem('ff_tasks_catalog_v1');
    if (!catalogRaw) return false;
    
    const catalogObj = JSON.parse(catalogRaw);
    const monthlyCatalog = catalogObj.monthly || [];
    
    // Check if at least one task is scheduled for today
    for (let i = 0; i < monthlyCatalog.length; i++) {
      const catalogTask = monthlyCatalog[i];
      if (!catalogTask || typeof catalogTask !== 'object') continue;
      
      const taskId = catalogTask.taskId || catalogTask.id;
      if (!taskId) continue;
      
      // Use existing helper to check if this task is scheduled today
      if (typeof window.ffIsMonthlyTaskScheduledToday === 'function') {
        if (window.ffIsMonthlyTaskScheduledToday(taskId, now)) {
          return true; // Found at least one task scheduled for today
        }
      } else {
        // Fallback: if helper not available, treat missing scheduleDayOfMonth as 'any' (scheduled)
        const scheduleDayOfMonth = catalogTask.scheduleDayOfMonth;
        if (scheduleDayOfMonth === 'any' || scheduleDayOfMonth === undefined) {
          return true;
        }
      }
    }
    
    return false; // No tasks scheduled for today
  } catch (e) {
    console.warn('[Auto-Reset] Error checking monthly tasks scheduled today:', e);
    return false; // Fail-closed: don't reset if we can't determine
  }
}

// Main auto-reset function for Monthly tab (today-only reset)
window.ffMaybeAutoResetMonthly = function(nowDate) {
  try {
    console.log('[AUTO_RESET][MONTHLY] running', new Date().toISOString());
    const tab = 'monthly';
    const now = nowDate || new Date();
    
    // Get config
    const config = ffGetAutoResetConfig(tab);
    if (!config || !config.autoResetEnabled) {
      return; // Auto-reset not enabled
    }
    
    // Check if current time >= reset time
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const resetMinutes = ffParseHHMMToMinutes(config.autoResetTime);
    if (resetMinutes === null) {
      console.warn('[Auto-Reset] Invalid reset time:', config.autoResetTime);
      return;
    }
    
    if (nowMinutes < resetMinutes) {
      return; // Not yet time for reset
    }
    
    // Check if already run today
    const todayISO = ffGetTodayLocalISO();
    const state = ffGetAutoResetState(tab);
    if (state.lastRunDate === todayISO) {
      return; // Already run today
    }
    
    // Check if ANY monthly task is scheduled for today (prevent useless resets)
    if (!ffHasMonthlyTasksScheduledToday(now)) {
      return; // No tasks scheduled for today, skip reset
    }
    
    // Perform rollover for unfinished tasks (regardless of completion status)
    // This advances unfinished tasks scheduled for today to tomorrow
    if (typeof window.resetMonthlyForToday === 'function') {
      window.resetMonthlyForToday(now);
    } else {
      console.warn('[AUTO_RESET][MONTHLY] resetMonthlyForToday not exposed');
      return;
    }
    
    // Check if all Monthly tasks scheduled for TODAY are completed
    if (typeof ffGetUncompletedCountForTab !== 'function') {
      console.warn('[Auto-Reset] ffGetUncompletedCountForTab not available');
      // Mark as run today even if we can't check completion (rollover happened)
      ffSetAutoResetLastRun(tab, todayISO);
      return;
    }
    
    const uncompleted = ffGetUncompletedCountForTab(tab);
    if (uncompleted !== 0) {
      // Not all tasks completed - rollover already happened above
      // Mark as run today to prevent multiple rollovers
      ffSetAutoResetLastRun(tab, todayISO);
      console.log('[Auto-Reset] Monthly rollover completed (some tasks still unfinished)');
      return;
    }
    
    // All conditions met - rollover already done above
    console.log('[Auto-Reset] All Monthly tasks for today completed, rollover completed at', config.autoResetTime);
    
    // Mark as run today
    ffSetAutoResetLastRun(tab, todayISO);
    
    console.log('[Auto-Reset] Today-only reset completed for Monthly tab');
    
  } catch (e) {
    console.error('[Auto-Reset] Error in ffMaybeAutoResetMonthly:', e);
  }
};