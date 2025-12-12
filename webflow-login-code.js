// ===================================================================
// Webflow Custom Code: Firebase Login Handler
// ===================================================================
// Instructions:
// 1. Copy this entire code block
// 2. Paste it into Webflow: Project Settings > Custom Code > Footer Code
// 3. Replace [YOUR_FIREBASE_HOSTING_URL] with your actual app URL (e.g., https://app.fairflowapp.com)
// 4. Ensure your Webflow form has these IDs:
//    - Form: id="wf-form-login"
//    - Email Input: id="email-login"
//    - Password Input: id="password-login"
// ===================================================================

// Load Firebase SDK (v9 compat mode for easier Webflow integration)
(function() {
  // Check if Firebase is already loaded
  if (typeof firebase === 'undefined') {
    // Load Firebase SDK from CDN
    const firebaseScript = document.createElement('script');
    firebaseScript.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js';
    firebaseScript.onload = function() {
      const authScript = document.createElement('script');
      authScript.src = 'https://www.gstatic.com/firebasejs/9.23.0/firebase-auth-compat.js';
      authScript.onload = initLoginHandler;
      document.head.appendChild(authScript);
    };
    document.head.appendChild(firebaseScript);
  } else {
    initLoginHandler();
  }
})();

function initLoginHandler() {
  // Firebase Configuration (from your Fair Flow app)
  const firebaseConfig = {
    apiKey: "AIzaSyCoj6A2Eoa0uDrelIJxycZCL6cTw570FCI",
    authDomain: "fairflowapp-db841.firebaseapp.com",
    projectId: "fairflowapp-db841",
    storageBucket: "fairflowapp-db841.firebasestorage.app",
    messagingSenderId: "823186963319",
    appId: "1:823186963319:web:2bc2d386311b2898643f72",
    measurementId: "G-S7T9WN343B"
  };

  // Initialize Firebase (if not already initialized)
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  // Wait for DOM to be ready
  document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('wf-form-login');
    const emailInput = document.getElementById('email-login');
    const passwordInput = document.getElementById('password-login');
    
    // Ensure the app links to the correct domain after login
    const successRedirectUrl = 'https://app.fairflowapp.com';

    if (!loginForm) {
      console.warn('[Webflow Login] Login form not found. Ensure form has id="wf-form-login"');
      return;
    }

    if (!emailInput || !passwordInput) {
      console.warn('[Webflow Login] Email or password input not found. Ensure inputs have id="email-login" and id="password-login"');
      return;
    }

    // Handle form submission
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation(); // Prevent Webflow's default form handling

      const email = emailInput.value.trim();
      const password = passwordInput.value;

      // Validation
      if (!email || !password) {
        alert('אנא הזן אימייל וסיסמה.');
        return;
      }

      // Get submit button to show loading state
      const submitButton = loginForm.querySelector('input[type="submit"], button[type="submit"]');
      const originalButtonText = submitButton ? submitButton.value || submitButton.textContent : '';
      
      // Optional: Disable submit button to prevent double clicks
      if (submitButton) {
        submitButton.disabled = true;
        if (submitButton.tagName === 'INPUT') {
          submitButton.value = 'מתחבר...';
        } else {
          submitButton.textContent = 'מתחבר...';
        }
      }

      try {
        // Perform Firebase Sign-In
        await firebase.auth().signInWithEmailAndPassword(email, password);
        
        // Success: Redirect to the main application on the new subdomain
        window.location.href = successRedirectUrl;

      } catch (error) {
        // Failure: Display error message
        console.error('[Webflow Login] Login Error:', error.code, error.message);

        // Re-enable the submit button
        if (submitButton) {
          submitButton.disabled = false;
          if (submitButton.tagName === 'INPUT') {
            submitButton.value = originalButtonText || 'התחברות';
          } else {
            submitButton.textContent = originalButtonText || 'התחברות';
          }
        }

        // Show user-friendly error message (Hebrew)
        let userFriendlyMessage = 'שגיאת התחברות. אנא בדוק את האימייל והסיסמה.';
        
        if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
          userFriendlyMessage = 'אימייל או סיסמה לא תקינים.';
        } else if (error.code === 'auth/invalid-email') {
          userFriendlyMessage = 'אנא הזן כתובת אימייל תקינה.';
        } else if (error.code === 'auth/user-disabled') {
          userFriendlyMessage = 'חשבון זה הושבת. אנא פנה לתמיכה.';
        } else if (error.code === 'auth/too-many-requests') {
          userFriendlyMessage = 'יותר מדי ניסיונות התחברות כושלים. אנא נסה שוב מאוחר יותר.';
        } else if (error.code === 'auth/network-request-failed') {
          userFriendlyMessage = 'שגיאת רשת. אנא בדוק את החיבור שלך ונסה שוב.';
        }

        alert(userFriendlyMessage);

        // Clear password field for security
        passwordInput.value = '';
        passwordInput.focus();
      }
    });
  });
}

