console.log('[BUILD MARKER] app.js loaded', new Date().toISOString());

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
                const worker = (typeof getCurrentActorName === 'function' ? getCurrentActorName() : (window.__ff_actorName || window.currentUserName || null)) || '-';
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
                    const worker = (typeof getCurrentActorName === 'function' ? getCurrentActorName() : (window.__ff_actorName || window.currentUserName || null)) || '-';
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
    const completedTask = idx >= 0 ? activeTasks[idx] : (pendingTask || null);
    const taskTitle = completedTask?.title || pendingTask?.title || '';
    const worker = assignedEmployee || '-';
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
    const pinInput = document.getElementById("pinModalTaskInput");
    const pinError = document.getElementById("pinError");
    if (!pinInput) return;
    
    const enteredPin = pinInput.value.trim();
    
    if (!enteredPin || enteredPin === '') {
        if (pinError) {
            pinError.textContent = "Please enter PIN";
            pinError.style.display = "block";
        }
        return;
    }
    
    let matchedRole = null;
    let matchedName = null;
    
    // Check admin code first (no length restriction)
    if (typeof isAdminCode === 'function' && isAdminCode(enteredPin)) {
        matchedRole = 'Admin';
        matchedName = (typeof settings !== 'undefined' && settings) 
            ? (settings.ownerName || settings.adminName || 'Admin')
            : 'Admin';
        console.log('✅ TASK_TAKE_OK', { role: matchedRole, userName: matchedName, taskId: __pendingTaskId });
    }
    // Check manager code second (no length restriction)
    else if (typeof isManagerCode === 'function' && isManagerCode(enteredPin)) {
        matchedRole = 'Manager';
        const managers = (typeof settings !== 'undefined' && settings && settings.managers) ? settings.managers : [];
        const manager = managers.find(m => {
            if (!m.code) return false;
            return m.code.toString().trim() === enteredPin;
        });
        matchedName = manager ? (manager.name || 'Manager') : 'Manager';
        console.log('✅ TASK_TAKE_OK', { role: matchedRole, userName: matchedName, taskId: __pendingTaskId });
    }
    // Check technician (worker) PIN third (with length validation)
    else {
        // Validate PIN length for workers only (4-6 digits)
        if (enteredPin.length < 4 || enteredPin.length > 6) {
            if (pinError) {
                pinError.textContent = "PIN must be 4–6 digits";
                pinError.style.display = "block";
            }
            return;
        }
        
        const users = JSON.parse(localStorage.getItem("ff_users_v1") || "[]");
        const match = users.find(u => u.pin === enteredPin);
        
        if (match) {
            matchedRole = 'Tech';
            matchedName = match.displayName;
            console.log('✅ TASK_TAKE_OK', { role: matchedRole, userName: matchedName, taskId: __pendingTaskId });
        }
    }
    
    if (!matchedName) {
        // Determine current role for logging
        let currentRole = 'Tech';
        if (typeof getCurrentActorRole === 'function') {
            currentRole = getCurrentActorRole() || 'Tech';
        }
        console.log('❌ TASK_TAKE_BAD_PIN', { role: currentRole, taskId: __pendingTaskId });
        if (pinError) {
            pinError.textContent = "Incorrect PIN";
            pinError.style.display = "block";
        }
        return;
    }

    if (__pendingTaskId) {
        moveTaskToPending(__pendingTaskId, matchedName);
    }

    closePinModal();
}

function validatePinAndMarkDone() {
    const pinInput = document.getElementById("pinModalTaskInput");
    const pinError = document.getElementById("pinError");
    if (!pinInput) return;
    
    const enteredPin = pinInput.value.trim();
    
    if (!enteredPin || enteredPin === '') {
        if (pinError) {
            pinError.textContent = "Please enter PIN";
            pinError.style.display = "block";
        }
        return;
    }
    
    let matchedRole = null;
    let matchedName = null;
    
    // Check admin code first (no length restriction)
    if (typeof isAdminCode === 'function' && isAdminCode(enteredPin)) {
        matchedRole = 'Admin';
        matchedName = (typeof settings !== 'undefined' && settings) 
            ? (settings.ownerName || settings.adminName || 'Admin')
            : 'Admin';
        console.log('✅ TASK_MARK_DONE_OK', { role: matchedRole, userName: matchedName, taskId: pinModalDoneTaskId });
    }
    // Check manager code second (no length restriction)
    else if (typeof isManagerCode === 'function' && isManagerCode(enteredPin)) {
        matchedRole = 'Manager';
        const managers = (typeof settings !== 'undefined' && settings && settings.managers) ? settings.managers : [];
        const manager = managers.find(m => {
            if (!m.code) return false;
            return m.code.toString().trim() === enteredPin;
        });
        matchedName = manager ? (manager.name || 'Manager') : 'Manager';
        console.log('✅ TASK_MARK_DONE_OK', { role: matchedRole, userName: matchedName, taskId: pinModalDoneTaskId });
    }
    // Check technician (worker) PIN third (with length validation)
    else {
        // Validate PIN length for workers only (4-6 digits)
        if (enteredPin.length < 4 || enteredPin.length > 6) {
            if (pinError) {
                pinError.textContent = "PIN must be 4–6 digits";
                pinError.style.display = "block";
            }
            return;
        }
        
        const users = JSON.parse(localStorage.getItem("ff_users_v1") || "[]");
        const user = users.find(u => u.pin === enteredPin);
        
        if (user) {
            matchedRole = 'Tech';
            matchedName = user.displayName;
            console.log('✅ TASK_MARK_DONE_OK', { role: matchedRole, userName: matchedName, taskId: pinModalDoneTaskId });
        }
    }
    
    if (!matchedName) {
        // Determine current role for logging
        let currentRole = 'Tech';
        if (typeof getCurrentActorRole === 'function') {
            currentRole = getCurrentActorRole() || 'Tech';
        }
        console.log('❌ TASK_MARK_DONE_BAD_PIN', { role: currentRole, taskId: pinModalDoneTaskId });
        if (pinError) {
            pinError.textContent = "Incorrect PIN";
            pinError.style.display = "block";
        }
        return;
    }

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
    addTasksHistoryEntry({
        action: `Tasks Reset: ${currentTab || ''}`.trim(),
        taskId: null,
        taskTitle: null,
        worker: '-',
        role: '-',
        performedBy: '-',
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
window.resetTasksForCurrentTab = resetTasksForCurrentTab;
window.loadTasksForTab = loadTasksForTab;
window.validateResetPin = validateResetPin;
window.doResetCurrentTab = doResetCurrentTab;

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

// Helper function to load weekly catalog and build a map by taskId
function ffGetWeeklyCatalogMap() {
  const catalogMap = new Map();
  try {
    const catalogRaw = localStorage.getItem('ff_tasks_catalog_v1');
    if (!catalogRaw) return catalogMap;
    
    const catalogObj = JSON.parse(catalogRaw);
    const weeklyCatalog = catalogObj.weekly || [];
    
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

// Helper function to check if a weekly task is scheduled for today
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
  
  // If array, check if today's weekday is included
  if (Array.isArray(scheduleWeekdays)) {
    // If empty array, treat as "any" (fail-open)
    if (scheduleWeekdays.length === 0) {
      return true;
    }
    return scheduleWeekdays.includes(todayWeekday);
  }
  
  // Fallback: fail-open (show task)
  return true;
}

// Helper function to load monthly catalog and build a map by taskId
function ffGetMonthlyCatalogMap() {
  const catalogMap = new Map();
  try {
    const catalogRaw = localStorage.getItem('ff_tasks_catalog_v1');
    if (!catalogRaw) return catalogMap;
    
    const catalogObj = JSON.parse(catalogRaw);
    const monthlyCatalog = catalogObj.monthly || [];
    
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
  
  // If number, check if equals today's day-of-month
  if (typeof scheduleDayOfMonth === 'number' && scheduleDayOfMonth >= 1 && scheduleDayOfMonth <= 31) {
    return scheduleDayOfMonth === todayDayOfMonth;
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

function ffGetUncompletedCountForTab(tab) {
  try {
    // Use getTabStorageKey if it exists, otherwise fall back to literal keys
    let activeKey, pendingKey;
    if (typeof getTabStorageKey === 'function') {
      activeKey = getTabStorageKey(tab, 'active');
      pendingKey = getTabStorageKey(tab, 'pending');
    } else {
      activeKey = `ff_tasks_${tab}_active_v1`;
      pendingKey = `ff_tasks_${tab}_pending_v1`;
    }
    
    // If both keys resolve to the same string, treat as single source
    if (activeKey === pendingKey) {
      let idSet = ffGetTaskIdSetFromStorage(activeKey);
      
      // For weekly tab, filter by scheduleWeekdays (only count tasks scheduled for today)
      if (tab === 'weekly') {
        const now = new Date();
        idSet = new Set(Array.from(idSet).filter(taskId => {
          return ffIsWeeklyTaskScheduledToday(taskId, now);
        }));
      }
      
      // For monthly tab, filter by scheduleDayOfMonth (only count tasks scheduled for today)
      if (tab === 'monthly') {
        const now = new Date();
        idSet = new Set(Array.from(idSet).filter(taskId => {
          return ffIsMonthlyTaskScheduledToday(taskId, now);
        }));
      }
      
      return idSet.size;
    }
    
    // Get unique IDs from both lists
    const activeIds = ffGetTaskIdSetFromStorage(activeKey);
    const pendingIds = ffGetTaskIdSetFromStorage(pendingKey);
    
    // Union: combine both sets (Set automatically handles duplicates)
    let unionSet = new Set([...activeIds, ...pendingIds]);
    
    // For weekly tab, filter by scheduleWeekdays (only count tasks scheduled for today)
    if (tab === 'weekly') {
      const now = new Date();
      unionSet = new Set(Array.from(unionSet).filter(taskId => {
        return ffIsWeeklyTaskScheduledToday(taskId, now);
      }));
    }
    
    // For monthly tab, filter by scheduleDayOfMonth (only count tasks scheduled for today)
    if (tab === 'monthly') {
      const now = new Date();
      unionSet = new Set(Array.from(unionSet).filter(taskId => {
        return ffIsMonthlyTaskScheduledToday(taskId, now);
      }));
    }
    
    // For yearly tab, filter by active status (appears if today >= scheduled date AND not completed)
    if (tab === 'yearly') {
      const now = new Date();
      // Need to check actual task objects, not just IDs
      // Load active and pending lists to check task status
      try {
        const activeKey = `ff_tasks_${tab}_active_v1`;
        const pendingKey = `ff_tasks_${tab}_pending_v1`;
        const activeRaw = localStorage.getItem(activeKey);
        const pendingRaw = localStorage.getItem(pendingKey);
        const activeList = activeRaw ? JSON.parse(activeRaw) : [];
        const pendingList = pendingRaw ? JSON.parse(pendingRaw) : [];
        
        // Build map of taskId -> task for quick lookup
        const taskMap = new Map();
        [...activeList, ...pendingList].forEach(task => {
          if (!task || typeof task !== 'object') return;
          const taskId = task.taskId || task.id;
          if (taskId) {
            taskMap.set(String(taskId).trim(), task);
          }
        });
        
        // Filter unionSet to only include active tasks
        unionSet = new Set(Array.from(unionSet).filter(taskId => {
          const task = taskMap.get(String(taskId).trim());
          if (!task) return false;
          return ffIsYearlyTaskActive(task, now);
        }));
      } catch (e) {
        console.warn('[Badge] Error filtering yearly tasks:', e);
        unionSet = new Set(); // Fail-closed: if error, don't count any
      }
    }
    
    return unionSet.size;
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
    
    // Handle yearly (month/day-based)
    if (tab === 'yearly') {
      const startDayOfMonth = tabConfig && tabConfig.startDayOfMonth !== undefined
        ? tabConfig.startDayOfMonth
        : 20; // Default: day 20
      
      if (isNaN(startDayOfMonth) || startDayOfMonth < 1 || startDayOfMonth > 31) {
        return true; // Invalid day, show badge
      }
      
      const nowDayOfMonth = now.getDate(); // 1..31
      return nowDayOfMonth >= startDayOfMonth;
    }
    
    // Handle yearly (month+day-based)
    if (tab === 'yearly') {
      const startMonth = tabConfig && tabConfig.startMonth !== undefined
        ? tabConfig.startMonth
        : 11; // Default: November
      const startDay = tabConfig && tabConfig.startDay !== undefined
        ? tabConfig.startDay
        : 15; // Default: day 15
      
      if (isNaN(startMonth) || startMonth < 1 || startMonth > 12 ||
          isNaN(startDay) || startDay < 1 || startDay > 31) {
        return true; // Invalid month/day, show badge
      }
      
      const nowMonth = now.getMonth() + 1; // JS months are 0-11, convert to 1-12
      const nowDay = now.getDate();
      
      // Compare using numeric key: (month * 100 + day)
      const nowKey = nowMonth * 100 + nowDay;
      const startKey = startMonth * 100 + startDay;
      
      return nowKey >= startKey;
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
    const badge = document.querySelector('.ff-home-tasks-badge');
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
function ffGetYearlyCatalogMap() {
  const catalogMap = new Map();
  try {
    const catalogRaw = localStorage.getItem('ff_tasks_catalog_v1');
    if (!catalogRaw) return catalogMap;
    
    const catalogObj = JSON.parse(catalogRaw);
    const yearlyCatalog = catalogObj.yearly || [];
    
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

// Check if a yearly task is active (appears in MY LIST/PENDING)
// Logic: appears if has valid date AND today >= scheduled date AND not completed
// If not completed, continues to appear every day after until completed
function ffIsYearlyTaskActive(task, nowDate) {
  if (!task || typeof task !== 'object') return false;
  
  const now = nowDate || new Date();
  const todayMonth = now.getMonth() + 1; // 1..12 (JS getMonth() returns 0..11)
  const todayDay = now.getDate(); // 1..31
  const todayYear = now.getFullYear();
  
  // Get schedule from task (prefer task fields, fallback to catalog lookup)
  let scheduleMonth = task.scheduleMonth;
  let scheduleDay = task.scheduleDay;
  
  // If not in task, try catalog lookup
  if ((scheduleMonth === undefined || scheduleMonth === null) || 
      (scheduleDay === undefined || scheduleDay === null)) {
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
      }
    }
  }
  
  // FAIL-CLOSED: Missing or invalid date
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
  
  // Check if task is completed
  const isCompleted = task.status === 'done' || !!task.completedAt || 
                      task.completed === true || task.isCompleted === true ||
                      task.done === true || task.isDone === true;
  
  if (isCompleted) {
    return false; // Completed tasks don't appear
  }
  
  // Check if today >= scheduled date (year-agnostic comparison)
  // Compare month first, then day
  if (todayMonth > monthNum) {
    return true; // Past the scheduled month
  }
  if (todayMonth < monthNum) {
    return false; // Before the scheduled month
  }
  // Same month - compare day
  if (todayDay >= dayNum) {
    return true; // On or past the scheduled day
  }
  return false; // Before the scheduled day
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