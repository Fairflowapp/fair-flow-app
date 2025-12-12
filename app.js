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
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
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
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

console.log("[Init] Firebase initialized");

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
  if (loginSection) loginSection.style.display = "block";
  if (signupSection) signupSection.style.display = "none";
  if (resetSection) resetSection.style.display = "none";
  if (mainApp) mainApp.style.display = "none";
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
  if (!user) {
    console.log("[Auth] No user, showing login screen");
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
  } catch (e) {
    console.error("[UI] initLogout failed", e);
  }

  try {
    // By default show login section
    switchToLogin();
  } catch (e) {
    console.error("[UI] switchToLogin failed", e);
  }
});

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

// Expose functions to window for use in index.html
window.getAdminPinFromFirestore = getAdminPinFromFirestore;
// updateAdminPinInFirestore is NOT exposed - PIN can only be reset via email flow
window.isCurrentUserOwner = isCurrentUserOwner;
window.showLoginScreen = showLoginScreen;
window.generatePinResetLink = generatePinResetLink;
window.verifyPinResetToken = verifyPinResetToken;
window.confirmPinReset = confirmPinReset;

// Expose auth for owner check
window.auth = auth;