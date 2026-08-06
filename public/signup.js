import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";

let auth = null;
let createSalonAccount = null;

const serviceOptions = [
  "Nail services",
  "Hair & styling",
  "Facials & skincare",
  "Massages",
  "Lashes & eyebrows",
  "Waxing & sugaring",
  "Barbering",
  "Makeup",
  "Med spa",
  "Other",
];

const teamSizeOptions = ["1", "2-5", "6-15", "16+"];
const solutionOptions = ["Pen & paper", "Spreadsheets", "Another software", "Just getting started"];
const referralOptions = ["Instagram", "Google", "A friend", "Other"];

const serviceIcons = {
  "Nail services": "sparkle",
  "Hair & styling": "scissors",
  "Facials & skincare": "leaf",
  "Massages": "hand",
  "Lashes & eyebrows": "eye",
  "Waxing & sugaring": "drop",
  "Barbering": "razor",
  "Makeup": "brush",
  "Med spa": "plus",
  "Other": "dots",
};

const state = {
  step: 0,
  services: [],
  teamSize: "",
  currentSolution: "",
  currentSolutionName: "",
  firstName: "",
  lastName: "",
  email: "",
  businessName: "",
  password: "",
  confirmPassword: "",
  referralSource: "",
  referralSubmitted: false,
  passwordVisible: false,
  submitting: false,
  authUserCreated: false,
  firebaseReady: false,
  unavailable: false,
};

const stepLabel = document.getElementById("stepLabel");
const stepTitle = document.getElementById("stepTitle");
const stepCopy = document.getElementById("stepCopy");
const stepBody = document.getElementById("stepBody");
const errorMessage = document.getElementById("errorMessage");
const backButton = document.getElementById("backButton");
const continueButton = document.getElementById("continueButton");
const wizard = document.getElementById("wizard");
const successScreen = document.getElementById("successScreen");
const progressFill = document.getElementById("progressFill");
const submitMicrocopy = document.getElementById("submitMicrocopy");
const referralCard = document.getElementById("referralCard");
const referralChips = document.getElementById("referralChips");
const skipReferralButton = document.getElementById("skipReferralButton");

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function clearError() {
  errorMessage.textContent = "";
}

function setError(message) {
  errorMessage.textContent = message || "";
}

function iconSvg(name) {
  const icons = {
    sparkle: '<path d="M12 3l1.8 5.1L19 10l-5.2 1.9L12 17l-1.8-5.1L5 10l5.2-1.9L12 3z"/><path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8L5 15z"/>',
    scissors: '<path d="M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M8 7l10 10"/><path d="M8 17L18 7"/>',
    leaf: '<path d="M20 4c-8 0-14 5-14 12 0 2 1 4 3 5 7 0 11-6 11-17z"/><path d="M6 20c2-5 6-9 12-12"/>',
    hand: '<path d="M7 12V7a1.5 1.5 0 0 1 3 0v5"/><path d="M10 12V5a1.5 1.5 0 0 1 3 0v7"/><path d="M13 12V7a1.5 1.5 0 0 1 3 0v7"/><path d="M16 14v-3a1.5 1.5 0 0 1 3 0v4c0 4-3 6-7 6h-1c-3 0-5-2-6-5l-1-3a1.4 1.4 0 0 1 2.6-1L8 15"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    drop: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
    razor: '<path d="M4 7h12l4 4-4 4H4z"/><path d="M8 7v8"/><path d="M12 7v8"/>',
    brush: '<path d="M15 3l6 6-9 9-6-6z"/><path d="M6 12l-2 7 7-2"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/><circle cx="12" cy="12" r="9"/>',
    dots: '<circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/>',
  };
  return `<svg class="option-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.dots}</svg>`;
}

function validFirebaseConfig(config) {
  return Boolean(
    config &&
    typeof config === "object" &&
    typeof config.apiKey === "string" &&
    config.apiKey.trim() &&
    typeof config.projectId === "string" &&
    config.projectId.trim() &&
    typeof config.appId === "string" &&
    config.appId.trim(),
  );
}

async function initFirebaseFromHosting() {
  try {
    const response = await fetch("/__/firebase/init.json", {
      cache: "no-store",
      credentials: "same-origin",
    });
    if (!response.ok) {
      throw new Error(`Firebase init config request failed: ${response.status}`);
    }
    const firebaseConfig = await response.json();
    if (!validFirebaseConfig(firebaseConfig)) {
      throw new Error("Firebase init config is missing required fields.");
    }
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    const functions = getFunctions(app, "us-central1");
    createSalonAccount = httpsCallable(functions, "createSalonAccount");
    state.firebaseReady = true;
    console.log("[signup] Firebase initialized from Hosting config", {
      projectId: firebaseConfig.projectId,
    });
    updateActions();
  } catch (error) {
    showUnavailable(error);
  }
}

function showUnavailable(error) {
  console.error("[signup] Firebase Hosting auto-init failed", error);
  state.unavailable = true;
  state.firebaseReady = false;
  state.submitting = false;
  stepLabel.textContent = "Unavailable";
  stepTitle.textContent = "Sign up is temporarily unavailable";
  stepCopy.textContent = "Please try again later.";
  stepBody.innerHTML = "";
  setError("Sign up is temporarily unavailable");
  backButton.style.visibility = "hidden";
  backButton.disabled = true;
  continueButton.disabled = true;
}

function setSubmitting(isSubmitting) {
  state.submitting = isSubmitting;
  backButton.disabled = isSubmitting;
  continueButton.disabled = isSubmitting || !isStepValid();
  continueButton.textContent = isSubmitting
    ? "Creating..."
    : (state.step === 4 && state.authUserCreated ? "Retry setup" : (state.step === 4 ? "Create your workspace" : "Continue"));
}

function isStepValid() {
  if (state.unavailable || !state.firebaseReady) return false;
  if (state.step === 0) return state.services.length > 0;
  if (state.step === 1) return teamSizeOptions.includes(state.teamSize);
  if (state.step === 2) return solutionOptions.includes(state.currentSolution);
  if (state.step === 3) return isEmail(state.email) && state.firstName.trim() && state.lastName.trim() && state.businessName.trim();
  if (state.step === 4) {
    return state.password.length >= 8 && state.password === state.confirmPassword;
  }
  return false;
}

function updateActions() {
  if (state.unavailable) {
    backButton.style.visibility = "hidden";
    backButton.disabled = true;
    continueButton.disabled = true;
    return;
  }
  backButton.style.visibility = state.step === 0 ? "hidden" : "visible";
  backButton.disabled = state.submitting;
  continueButton.disabled = state.submitting || !isStepValid();
  continueButton.textContent = state.step === 4
    ? (state.authUserCreated ? "Retry setup" : "Create your workspace")
    : "Continue";
  if (submitMicrocopy) {
    submitMicrocopy.classList.toggle("hidden", state.step !== 4);
  }
}

function optionButton(label, selected, multi, iconName = "") {
  const stateText = selected ? "true" : "false";
  return `
    <button
      class="option ${selected ? "selected" : ""}"
      type="button"
      data-option="${escapeHtml(label)}"
      aria-pressed="${stateText}"
    >
      ${iconName ? iconSvg(iconName) : ""}
      <span class="option-text">${escapeHtml(label)}</span>
      <span class="option-check" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4.5 10.5l3.2 3.2 7.8-8.4"></path>
        </svg>
      </span>
    </button>
  `;
}

function renderServices() {
  stepBody.innerHTML = `
    <div class="options two">
      ${serviceOptions.map((service) => optionButton(service, state.services.includes(service), true, serviceIcons[service])).join("")}
    </div>
  `;
  stepBody.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.getAttribute("data-option");
      if (state.services.includes(value)) {
        state.services = state.services.filter((service) => service !== value);
      } else {
        state.services = state.services.concat(value);
      }
      clearError();
      render();
    });
  });
}

function renderSolution() {
  stepBody.innerHTML = `
    <div class="options">
      ${solutionOptions.map((solution) => optionButton(solution, state.currentSolution === solution, false)).join("")}
    </div>
    <div class="form-grid ${state.currentSolution === "Another software" ? "" : "hidden"}">
      <label>Which one?
        <input id="currentSolutionName" autocomplete="off" value="${escapeHtml(state.currentSolutionName)}">
      </label>
    </div>
  `;
  stepBody.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentSolution = button.getAttribute("data-option");
      if (state.currentSolution !== "Another software") state.currentSolutionName = "";
      clearError();
      render();
    });
  });
  bindInput("currentSolutionName", "currentSolutionName");
}

function renderTeamSize() {
  stepBody.innerHTML = `
    <div class="options two">
      ${teamSizeOptions.map((size) => optionButton(size, state.teamSize === size, false)).join("")}
    </div>
  `;
  stepBody.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => {
      state.teamSize = button.getAttribute("data-option");
      clearError();
      render();
    });
  });
}

function bindInput(id, key) {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener("input", () => {
    state[key] = input.value;
    clearError();
    updateActions();
  });
}

function renderProfile() {
  stepBody.innerHTML = `
    <div class="form-grid combo">
      <label>First name
        <input id="firstName" autocomplete="given-name" value="${escapeHtml(state.firstName)}">
      </label>
      <label>Last name
        <input id="lastName" autocomplete="family-name" value="${escapeHtml(state.lastName)}">
      </label>
      <label class="full">Email
        <input id="email" type="email" autocomplete="email" value="${escapeHtml(state.email)}">
      </label>
      <label class="full">Business name
        <input id="businessName" autocomplete="organization" value="${escapeHtml(state.businessName)}">
      </label>
    </div>
  `;
  bindInput("firstName", "firstName");
  bindInput("lastName", "lastName");
  bindInput("email", "email");
  bindInput("businessName", "businessName");
}

function renderPassword() {
  const type = state.passwordVisible ? "text" : "password";
  stepBody.innerHTML = `
    <div class="form-grid">
      <label>Password
        <span class="password-row">
          <input id="password" type="${type}" autocomplete="new-password" value="${escapeHtml(state.password)}">
          <button class="toggle-password" type="button" id="togglePassword">${state.passwordVisible ? "Hide" : "Show"}</button>
        </span>
      </label>
      <label>Confirm password
        <input id="confirmPassword" type="${type}" autocomplete="new-password" value="${escapeHtml(state.confirmPassword)}">
      </label>
    </div>
  `;
  bindInput("password", "password");
  bindInput("confirmPassword", "confirmPassword");
  const toggle = document.getElementById("togglePassword");
  if (toggle) {
    toggle.addEventListener("click", () => {
      state.passwordVisible = !state.passwordVisible;
      render();
    });
  }
}

function render() {
  const steps = [
    {
      title: "Which services do you offer?",
      copy: "Tell us what your team does so Fair Flow can shape the right staff, schedule, and commission setup.",
      renderBody: renderServices,
    },
    {
      title: "How big is your team?",
      copy: "We'll set up your team workspace accordingly.",
      renderBody: renderTeamSize,
    },
    {
      title: "How do you manage your team today?",
      copy: "Fair Flow will help bring staff, schedules, tasks, and commissions into one calmer place.",
      renderBody: renderSolution,
    },
    {
      title: "Tell us about you and your salon",
      copy: "This creates your owner login and names your Fair Flow workspace.",
      renderBody: renderProfile,
    },
    {
      title: "Create your password",
      copy: "Use at least 8 characters. You'll use this to open your Fair Flow workspace.",
      renderBody: renderPassword,
    },
  ];

  const current = steps[state.step];
  stepLabel.textContent = `${state.step + 1}/5`;
  if (progressFill) progressFill.style.width = `${((state.step + 1) / steps.length) * 100}%`;
  stepTitle.textContent = current.title;
  stepCopy.textContent = current.copy;
  current.renderBody();
  updateActions();
}

function friendlyError(error) {
  const code = error && error.code ? String(error.code) : "";
  if (code.includes("email-already-in-use")) {
    return "An account already exists with this email. Try signing in from the app instead.";
  }
  if (code.includes("weak-password")) {
    return "Please choose a stronger password.";
  }
  if (code.includes("network-request-failed") || code.includes("unavailable")) {
    return "Network error. Check your connection and try again.";
  }
  if (code.includes("invalid-email")) {
    return "Please enter a valid email address.";
  }
  if (code.includes("invalid-argument")) {
    return error.message || "Please check your answers and try again.";
  }
  return "Something went wrong. Please try again.";
}

function callablePayload() {
  return {
    firstName: state.firstName.trim(),
    lastName: state.lastName.trim(),
    businessName: state.businessName.trim(),
    services: state.services.slice(),
    teamSize: state.teamSize,
    currentSolution: state.currentSolution,
    currentSolutionName: state.currentSolutionName.trim(),
    referralSource: state.referralSource,
  };
}

async function finishSignup() {
  clearError();
  if (!auth || !createSalonAccount || !state.firebaseReady) {
    showUnavailable(new Error("Firebase is not initialized."));
    return;
  }
  setSubmitting(true);

  try {
    let user = auth.currentUser;
    if (!state.authUserCreated) {
      const credential = await createUserWithEmailAndPassword(
        auth,
        state.email.trim().toLowerCase(),
        state.password,
      );
      user = credential.user;
      state.authUserCreated = true;
      sendEmailVerification(user).catch((error) => {
        console.warn("[signup] email verification failed", error?.code || error?.message);
      });
    }

    if (!user) {
      throw new Error("Missing signed-in user.");
    }

    await createSalonAccount(callablePayload());
    wizard.classList.add("hidden");
    successScreen.classList.remove("hidden");
    renderReferralQuestion();
  } catch (error) {
    console.error("[signup] failed", error);
    setError(friendlyError(error));
  } finally {
    setSubmitting(false);
  }
}

function hideReferralCard() {
  if (referralCard) referralCard.classList.add("hidden");
}

function renderReferralQuestion() {
  if (!referralCard || !referralChips || state.referralSubmitted) {
    hideReferralCard();
    return;
  }
  referralChips.innerHTML = referralOptions.map((source) => `
    <button class="chip ${state.referralSource === source ? "selected" : ""}" type="button" data-referral="${escapeHtml(source)}">
      ${escapeHtml(source)}
    </button>
  `).join("");
  referralChips.querySelectorAll("[data-referral]").forEach((button) => {
    button.addEventListener("click", async () => {
      state.referralSource = button.getAttribute("data-referral");
      state.referralSubmitted = true;
      hideReferralCard();
      try {
        if (createSalonAccount) await createSalonAccount(callablePayload());
      } catch (error) {
        console.warn("[signup] referral save failed", error?.code || error?.message);
      }
    });
  });
}

if (skipReferralButton) {
  skipReferralButton.addEventListener("click", () => {
    state.referralSubmitted = true;
    hideReferralCard();
  });
}

backButton.addEventListener("click", () => {
  if (state.submitting || state.step === 0) return;
  state.step -= 1;
  clearError();
  render();
});

continueButton.addEventListener("click", async () => {
  if (state.submitting || !isStepValid()) return;
  clearError();
  if (state.step < 4) {
    state.step += 1;
    render();
    return;
  }
  await finishSignup();
});

render();
initFirebaseFromHosting();
