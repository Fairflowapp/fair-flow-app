// V1 Foundation: Fair Flow Console section navigation and scoped Firestore integrations.
// Billing Overrides use the existing callable so accountStatus/Billing Guard recompute stays in sync.
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-functions.js";
import {
  collection,
  doc,
  getFirestore,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

(function initFairFlowConsoleFoundation() {
  const shell = document.querySelector("[data-fair-flow-console-shell]");
  if (!shell) return;

  const navItems = Array.from(shell.querySelectorAll("[data-platform-section-target]"));
  const sections = Array.from(shell.querySelectorAll("[data-platform-section]"));
  const pageTitle = shell.querySelector("[data-platform-page-title]");
  const pageSubtitle = shell.querySelector("[data-platform-page-subtitle]");
  const sidebarToggle = shell.querySelector("[data-platform-sidebar-toggle]");
  const mobileToggle = shell.querySelector("[data-platform-mobile-toggle]");
  const mobileLabel = shell.querySelector("[data-platform-mobile-label]");
  const customersTableBody = shell.querySelector("[data-customers-table-body]");
  const customersStatus = shell.querySelector("[data-customers-readonly-status]");
  const customerFilterButtons = Array.from(shell.querySelectorAll("[data-customers-filter]"));
  const authStatus = shell.querySelector("[data-console-auth-status]");
  const customerBack = shell.querySelector("[data-customer-360-back]");
  const supportSalonSelect = shell.querySelector("[data-support-salon-select]");
  const supportStatus = shell.querySelector("[data-support-readonly-status]");
  const supportConversationsBody = shell.querySelector("[data-support-conversations-body]");
  const billingOverrideForm = shell.querySelector("[data-billing-override-form]");
  const topbarActions = shell.querySelector(".ff-platform-topbar__actions");
  const consoleAuthScreen = document.querySelector("[data-console-auth-screen]");
  const consoleAuthCopy = document.querySelector("[data-console-auth-copy]");
  const consoleAuthLoader = document.querySelector("[data-console-auth-loader]");
  const consoleLoginForm = document.querySelector("[data-console-login-form]");
  const consoleGoogleLogin = document.querySelector("[data-console-google-login]");
  const consoleAuthReset = document.querySelector("[data-console-auth-reset]");
  const consoleLoginMessage = document.querySelector("[data-console-login-message]");
  const consoleAdminForm = shell.querySelector("[data-console-admin-form]");
  const consoleAdminsBody = shell.querySelector("[data-console-admins-body]");
  const consoleAdminMessage = shell.querySelector("[data-console-admin-message]");
  const consoleTeamStatus = shell.querySelector("[data-console-team-status]");
  let previousSectionId = "customers";
  let consoleDb = null;
  let consoleAuth = null;
  let consoleFunctions = null;
  let activeCustomer360SalonId = "";
  let authReady = false;
  let currentAuthUser = null;
  let currentConsoleAdmin = null;
  let customerRowsCache = [];
  let allCustomerRowsCache = [];
  // CONSOLE FILTERING V2: filter by salon.consoleStatus field only. No heuristics. No dedupe.
  // Allowed modes: "all" | "live" | "test" | "archived". Default: "live".
  let customersFilterMode = "live";
  const CONSOLE_STATUS_VALUES = new Set(["live", "test", "archived"]);
  const CUSTOMERS_QUERY_LIMIT = 200;
  const CONSOLE_SESSION_TIMEOUT_MS = 10000;
  const ROLE_DEFAULT_PERMISSIONS = {
    owner: {
      customers: true, customer360: true, support: true, billing: true, taxMonitoring: true,
      platformHealth: true, team: true, alerts: true, settings: true, admins: true,
      manageAdmins: true, manageRoles: true,
    },
    admin: {
      customers: true, customer360: true, support: true, billing: true, taxMonitoring: true,
      platformHealth: true, team: true, alerts: true, settings: true, admins: false,
      manageAdmins: false, manageRoles: false,
    },
    support: {
      customers: true, customer360: true, support: true, billing: false, taxMonitoring: false,
      platformHealth: true, team: false, alerts: true, settings: false, admins: false,
      manageAdmins: false, manageRoles: false,
    },
    billing: {
      customers: true, customer360: true, support: false, billing: true, taxMonitoring: true,
      platformHealth: false, team: false, alerts: true, settings: false, admins: false,
      manageAdmins: false, manageRoles: false,
    },
    readonly: {
      customers: true, customer360: true, support: true, billing: true, taxMonitoring: true,
      platformHealth: true, team: true, alerts: true, settings: false, admins: false,
      manageAdmins: false, manageRoles: false,
    },
  };
  const SECTION_PERMISSIONS = {
    dashboard: "customers",
    customers: "customers",
    "customer-360": "customer360",
    support: "support",
    billing: "billing",
    "tax-monitoring": "taxMonitoring",
    "platform-health": "platformHealth",
    "fair-flow-team": "team",
    alerts: "alerts",
    settings: "admins",
  };

  // READ ONLY V1: Same project config used by the main app, initialized independently for this isolated console page.
  const firebaseConfig = {
    apiKey: "AIzaSyCoj6A2Eoa0uDrelIJxycZCL6cTw570FCI",
    authDomain: "fairflowapp-db841.firebaseapp.com",
    projectId: "fairflowapp-db841",
    storageBucket: "fairflowapp-db841.firebasestorage.app",
    messagingSenderId: "823186963319",
    appId: "1:823186963319:web:2bc2d386311b2898643f72",
    measurementId: "G-S7T9WN343B",
  };

  const sectionMeta = {
    dashboard: {
      title: "Dashboard",
      subtitle: "Company-wide operations overview for the internal SaaS console.",
    },
    customers: {
      title: "Customers",
      subtitle: "Customer accounts, plan posture, billing status, and health placeholders.",
    },
    "customer-360": {
      title: "Customer 360",
      subtitle: "Single-business view with account, usage, staff, billing, health, and support placeholders.",
    },
    support: {
      title: "Support",
      subtitle: "CRM-style support workspace placeholder for customer conversations.",
    },
    billing: {
      title: "Billing",
      subtitle: "Subscription, payment, grace-period, and discount placeholders.",
    },
    "tax-monitoring": {
      title: "Tax Monitoring",
      subtitle: "State-level revenue, threshold, and alert placeholders.",
    },
    "platform-health": {
      title: "Platform Health",
      subtitle: "Service status indicators for future internal monitoring.",
    },
    "fair-flow-team": {
      title: "Fair Flow Team",
      subtitle: "Internal team operations workspace placeholders.",
    },
    alerts: {
      title: "Alerts",
      subtitle: "Platform alert and incident placeholders.",
    },
    settings: {
      title: "Settings",
      subtitle: "Internal console configuration placeholders.",
    },
  };

  function formatTitle(sectionId) {
    if (sectionMeta[sectionId]) return sectionMeta[sectionId].title;
    return sectionId
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function activateSection(sectionId) {
    if (currentConsoleAdmin && !canAccessSection(sectionId)) {
      sectionId = "customers";
    }
    navItems.forEach((item) => {
      item.classList.toggle("is-active", item.dataset.platformSectionTarget === sectionId);
    });

    sections.forEach((section) => {
      section.classList.toggle("is-active", section.id === sectionId);
    });

    if (pageTitle) {
      pageTitle.textContent = formatTitle(sectionId);
    }

    if (pageSubtitle && sectionMeta[sectionId]) {
      pageSubtitle.textContent = sectionMeta[sectionId].subtitle;
    }

    if (mobileLabel) {
      mobileLabel.textContent = formatTitle(sectionId);
    }

    shell.classList.remove("is-mobile-nav-open");
    if (mobileToggle) {
      mobileToggle.setAttribute("aria-expanded", "false");
    }
  }

  function getInitials(name) {
    return String(name || "Customer")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "CU";
  }

  function setText(selector, value) {
    shell.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  }

  function setHealthBadge(label = "Not enough data", state = "") {
    shell.querySelectorAll("[data-customer-360-health]").forEach((badge) => {
      badge.textContent = `Health: ${label}`;
      badge.classList.remove("healthy", "warning", "error");
      if (state) badge.classList.add(state);
    });
    shell.querySelectorAll("[data-customer-360-health-detail]").forEach((badge) => {
      badge.textContent = label;
      badge.classList.remove("healthy", "warning", "error");
      if (state) badge.classList.add(state);
    });
  }

  function setBadgeState(selector, label, state = "") {
    shell.querySelectorAll(selector).forEach((badge) => {
      badge.textContent = label;
      badge.classList.remove("healthy", "warning", "error");
      if (state) badge.classList.add(state);
    });
  }

  function resetCustomerIntelligence() {
    setText("[data-customer-360-intelligence-summary]", "Loading live customer signals...");
    setBadgeState("[data-customer-360-intelligence-status]", "Loading");
    setText("[data-customer-360-intelligence-health]", "Not available");
    setText("[data-customer-360-intelligence-adoption]", "Not available");
    setText("[data-customer-360-intelligence-activity]", "Not available");
    setText("[data-customer-360-intelligence-requests]", "Not available");
    setText("[data-customer-360-intelligence-staff]", "Not available");
    setText("[data-customer-360-intelligence-notes]", "Read-only signals only");
  }

  function displayValue(value, fallback = "Not available") {
    if (value === null || value === undefined) return fallback;
    const text = String(value).trim();
    return text || fallback;
  }

  function displayDate(value) {
    try {
      if (!value) return "Not available";
      const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
      if (Number.isNaN(date.getTime())) return "Not available";
      return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (_) {
      return "Not available";
    }
  }

  function timestampToDate(value) {
    try {
      if (!value) return null;
      const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch (_) {
      return null;
    }
  }

  function readByteSize(source) {
    const raw = pickFirst(source, ["sizeBytes", "fileSizeBytes", "bytes", "size", "fileSize"], "");
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "Not available";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function pickFirst(source, keys, fallback = "") {
    for (const key of keys) {
      const value = source && source[key];
      if (value !== null && value !== undefined && String(value).trim() !== "") return value;
    }
    return fallback;
  }

  // CONSOLE FILTERING V2: read-only classification by salon.consoleStatus field.
  // No heuristics. No name detection. No dedupe. No inference from billing/activity/staff/locations.
  function readConsoleStatus(salon) {
    const raw = salon?.consoleStatus;
    if (raw === null || raw === undefined) return null;
    const normalized = String(raw).trim().toLowerCase();
    if (!normalized) return null;
    return CONSOLE_STATUS_VALUES.has(normalized) ? normalized : null;
  }

  function consoleStatusLabel(consoleStatus) {
    if (consoleStatus === "live") return "Live";
    if (consoleStatus === "test") return "Test";
    if (consoleStatus === "archived") return "Archived";
    return "Unclassified";
  }

  function consoleStatusBadgeClass(consoleStatus) {
    if (consoleStatus === "live") return "healthy";
    if (consoleStatus === "test") return "warning";
    if (consoleStatus === "archived") return "error";
    return "";
  }

  function getConsoleApp() {
    return getApps().length ? getApp() : initializeApp(firebaseConfig);
  }

  function getConsoleDb() {
    if (!consoleDb) {
      consoleDb = getFirestore(getConsoleApp());
    }
    return consoleDb;
  }

  function getConsoleFunctions() {
    if (!consoleFunctions) {
      consoleFunctions = getFunctions(getConsoleApp(), "us-central1");
    }
    return consoleFunctions;
  }

  function hasConsolePermission(permission) {
    if (!currentConsoleAdmin || currentConsoleAdmin.active !== true) return false;
    if (currentConsoleAdmin.role === "owner") return true;
    return currentConsoleAdmin.permissions && currentConsoleAdmin.permissions[permission] === true;
  }

  function canAccessSection(sectionId) {
    const permission = SECTION_PERMISSIONS[sectionId];
    return !permission || hasConsolePermission(permission);
  }

  function applyConsolePermissionGuards() {
    navItems.forEach((item) => {
      const sectionId = item.dataset.platformSectionTarget;
      const allowed = canAccessSection(sectionId);
      item.hidden = !allowed;
      item.disabled = !allowed;
    });
    if (!canAccessSection("settings") && consoleAdminForm) {
      consoleAdminForm.hidden = true;
    } else if (consoleAdminForm) {
      consoleAdminForm.hidden = false;
    }
  }

  function setAuthStatus(message, state = "checking") {
    if (!authStatus) return;
    authStatus.textContent = message;
    authStatus.dataset.authState = state;
  }

  function setReadOnlyBlocked(message) {
    if (customersStatus) customersStatus.textContent = message;
    if (customersTableBody) {
      customersTableBody.innerHTML = `<tr><td colspan="8">${escapeHtml(message)}</td></tr>`;
    }
    allCustomerRowsCache = [];
    customerRowsCache = [];
    updateCustomerFilterButtons();
    renderSupportCustomerOptions(customerRowsCache);
    renderSupportUnavailable(message);
  }

  function clearOperationalData(message) {
    setReadOnlyBlocked(message);
    if (consoleAdminsBody) {
      consoleAdminsBody.innerHTML = `<tr><td colspan="7">${escapeHtml(message)}</td></tr>`;
    }
    if (consoleTeamStatus) consoleTeamStatus.textContent = message;
  }

  function applyRoleDefaults(role) {
    if (!consoleAdminForm) return;
    const defaults = ROLE_DEFAULT_PERMISSIONS[role] || ROLE_DEFAULT_PERMISSIONS.readonly;
    Object.entries(defaults).forEach(([key, value]) => {
      const input = consoleAdminForm.querySelector(`[name="perm_${key}"]`);
      if (input) input.checked = value === true;
    });
  }

  function readPermissionForm(formData) {
    return Object.keys(ROLE_DEFAULT_PERMISSIONS.owner).reduce((acc, key) => {
      acc[key] = formData.get(`perm_${key}`) === "on";
      return acc;
    }, {});
  }

  function formatAdminDate(value) {
    return displayDate(value);
  }

  function renderConsoleAdmins(admins = []) {
    if (!consoleAdminsBody) return;
    if (!admins.length) {
      consoleAdminsBody.innerHTML = `<tr><td colspan="7">No console admins found.</td></tr>`;
      return;
    }
    const currentUid = currentAuthUser?.uid || "";
    consoleAdminsBody.innerHTML = admins.map((adminRow) => {
      const statusClass = adminRow.active ? "healthy" : "error";
      const statusLabel = adminRow.active ? "Active" : "Inactive";
      const isSelfOwner = adminRow.uid === currentUid && adminRow.role === "owner";
      const permissionsJson = escapeHtml(JSON.stringify(adminRow.permissions || {}));
      return `
        <tr data-console-admin-row data-admin-uid="${escapeHtml(adminRow.uid)}" data-admin-email="${escapeHtml(adminRow.email)}" data-admin-name="${escapeHtml(adminRow.name)}" data-admin-role="${escapeHtml(adminRow.role)}" data-admin-permissions="${permissionsJson}">
          <td>${escapeHtml(displayValue(adminRow.name, "Not available"))}</td>
          <td>${escapeHtml(displayValue(adminRow.email, "Not available"))}</td>
          <td><span class="ff-platform-badge">${escapeHtml(adminRow.role)}</span></td>
          <td><span class="ff-platform-badge ${statusClass}">${statusLabel}</span></td>
          <td>${escapeHtml(formatAdminDate(adminRow.createdAt))}</td>
          <td>${escapeHtml(formatAdminDate(adminRow.lastLoginAt))}</td>
          <td>
            <div class="ff-platform-admin-actions">
              <button type="button" data-console-admin-edit>Edit permissions</button>
              <button type="button" data-console-admin-active="${adminRow.active ? "false" : "true"}" ${isSelfOwner ? "disabled" : ""}>${adminRow.active ? "Deactivate" : "Reactivate"}</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function loadConsoleAdmins() {
    if (!hasConsolePermission("admins")) {
      if (consoleTeamStatus) consoleTeamStatus.textContent = "Owner only";
      if (consoleAdminsBody) consoleAdminsBody.innerHTML = `<tr><td colspan="7">Owner role required.</td></tr>`;
      return;
    }
    try {
      if (consoleTeamStatus) consoleTeamStatus.textContent = "Loading console admins...";
      const snap = await getDocs(collection(getConsoleDb(), "platformAdmins"));
      const admins = snap.docs.map((adminDoc) => ({
        uid: adminDoc.id,
        ...(adminDoc.data() || {}),
      })).sort((a, b) => String(a.email || "").localeCompare(String(b.email || "")));
      renderConsoleAdmins(admins);
      if (consoleTeamStatus) consoleTeamStatus.textContent = "Console admins loaded";
    } catch (error) {
      console.warn("[Fair Flow Console] platform admins load failed", error);
      if (consoleTeamStatus) consoleTeamStatus.textContent = `Could not load admins (${error?.code || "unknown"})`;
      if (consoleAdminsBody) consoleAdminsBody.innerHTML = `<tr><td colspan="7">Could not load admins.</td></tr>`;
    }
  }

  function setConsoleAuthView(state, message = "") {
    document.body.classList.remove(
      "ff-console-auth-loading",
      "ff-console-auth-login",
      "ff-console-auth-denied",
      "ff-console-auth-disabled",
      "ff-console-authorized",
    );
    document.body.classList.add(`ff-console-auth-${state}`);
    if (state === "authorized") {
      document.body.classList.add("ff-console-authorized");
    }
    if (consoleAuthScreen) consoleAuthScreen.hidden = state === "authorized";
    if (consoleLoginForm) consoleLoginForm.hidden = state !== "login";
    if (consoleAuthLoader) consoleAuthLoader.hidden = state !== "loading";
    if (consoleAuthReset) consoleAuthReset.hidden = state !== "denied" && state !== "disabled";
    if (consoleAuthCopy) {
      const copy = {
        loading: "Checking secure session...",
        login: "Sign in with your internal Fair Flow admin account.",
        denied: "Access denied. This account is not registered as a console admin.",
        disabled: "Access disabled. This console admin account is inactive.",
        authorized: "",
      };
      consoleAuthCopy.textContent = message || copy[state] || "";
    }
    if (consoleLoginMessage && message) consoleLoginMessage.textContent = message;
  }

  function logConsoleAuthStep(step, details = {}) {
    console.log(`[Fair Flow Console] ${step}`, details);
  }

  async function signInConsoleWithEmail(event) {
    event.preventDefault();
    const email = String(new FormData(consoleLoginForm).get("email") || "").trim();
    const password = String(new FormData(consoleLoginForm).get("password") || "");
    if (!email || !password || !consoleAuth) return;
    if (consoleLoginMessage) consoleLoginMessage.textContent = "Signing in...";
    try {
      await signInWithEmailAndPassword(consoleAuth, email, password);
      setConsoleAuthView("loading", "Checking console permissions...");
    } catch (error) {
      console.warn("[Fair Flow Console] email sign-in failed", error);
      setConsoleAuthView("login", `Sign in failed: ${error?.message || error?.code || "unknown"}`);
    }
  }

  async function signInConsoleWithGoogle() {
    if (!consoleAuth) return;
    if (consoleLoginMessage) consoleLoginMessage.textContent = "Opening Google sign in...";
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(consoleAuth, provider);
      setConsoleAuthView("loading", "Checking console permissions...");
    } catch (error) {
      console.warn("[Fair Flow Console] Google sign-in failed", error);
      setConsoleAuthView("login", `Google sign in failed: ${error?.message || error?.code || "unknown"}`);
    }
  }

  function withTimeout(promise, timeoutMs, label) {
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
      }, timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timeoutId) window.clearTimeout(timeoutId);
    });
  }

  function ensureConsoleSignOutButton() {
    if (!topbarActions || topbarActions.querySelector("[data-console-sign-out]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ff-platform-sign-out";
    button.dataset.consoleSignOut = "true";
    button.textContent = "Sign out";
    button.addEventListener("click", async () => {
      if (!consoleAuth) return;
      try {
        await signOut(consoleAuth);
      } catch (error) {
        console.warn("[Fair Flow Console] sign out failed", error);
      }
    });
    topbarActions.appendChild(button);
  }

  function canRunReadOnlyReads() {
    return authReady && !!currentAuthUser;
  }

  async function safeSubcollectionCount(db, salonId, subcollectionName) {
    // READ ONLY V1: Count by reading subcollection docs only. No writes or mutations.
    try {
      const snap = await getDocs(collection(db, "salons", salonId, subcollectionName));
      return String(snap.size);
    } catch (_) {
      return "Not available";
    }
  }

  // READ ONLY V1: Owner profile resolution.
  // Always prefer users/{ownerUid} when ownerUid is known (returns displayName / name / email / phone).
  // Falls back to salon document fields. Never returns a raw UID as a display name.
  async function readOwnerProfile(db, salon, debugContext = null) {
    const debugOn = !!debugContext?.customer360;
    const salonIdForLog = debugContext?.salonId || salon?.id || null;

    const rawOwnerUid = salon?.ownerUid;
    const rawOwnerId = salon?.ownerId;
    const ownerUid = displayValue(rawOwnerUid || rawOwnerId || "", "");
    const salonOwnerName = String(pickFirst(salon, ["ownerName", "owner", "createdByName", "contactName"], "") || "").trim();
    const salonOwnerEmail = String(pickFirst(salon, ["ownerEmail", "email", "contactEmail"], "") || "").trim();
    const salonOwnerPhone = String(pickFirst(salon, ["ownerPhone", "phone", "contactPhone"], "") || "").trim();

    if (debugOn) {
      try {
        const salonKeys = salon && typeof salon === "object" ? Object.keys(salon) : [];
        console.groupCollapsed(`[Fair Flow Console][Owner Debug] readOwnerProfile start - salonId=${salonIdForLog || "?"}`);
        console.log("[Fair Flow Console][Owner Debug] inputs", {
          salonId: salonIdForLog,
          salonName: salon?.name || null,
          salonOwnerUidField: rawOwnerUid ?? null,
          salonOwnerIdField: rawOwnerId ?? null,
          resolvedOwnerUid: ownerUid || null,
          salonKeys,
          salonOwnerNameDirect: salonOwnerName || null,
          salonOwnerEmailDirect: salonOwnerEmail || null,
          salonOwnerPhoneDirect: salonOwnerPhone || null,
        });
      } catch (_) {}
    }

    let userName = "";
    let userEmail = "";
    let userPhone = "";
    let userLookupAttempted = false;
    let userLookupExists = false;
    let userKeys = [];
    let userRawValues = null;

    if (ownerUid) {
      userLookupAttempted = true;
      try {
        if (debugOn) {
          console.log("[Fair Flow Console][Owner Debug] Loading owner user", {
            path: `users/${ownerUid}`,
            salonId: salonIdForLog,
            ownerUid,
          });
        }
        const userSnap = await getDoc(doc(db, "users", ownerUid));
        userLookupExists = userSnap.exists();
        if (userLookupExists) {
          const user = userSnap.data() || {};
          userKeys = Object.keys(user);
          userRawValues = {
            displayName: user?.displayName ?? null,
            name: user?.name ?? null,
            email: user?.email ?? null,
            phone: user?.phone ?? null,
            phoneNumber: user?.phoneNumber ?? null,
            contactPhone: user?.contactPhone ?? null,
          };
          userName = String(pickFirst(user, ["displayName", "name"], "") || "").trim();
          userEmail = String(pickFirst(user, ["email"], "") || "").trim();
          userPhone = String(pickFirst(user, ["phone", "phoneNumber", "contactPhone"], "") || "").trim();
        }
        if (debugOn) {
          console.log("[Fair Flow Console][Owner Debug] users doc read result", {
            path: `users/${ownerUid}`,
            salonId: salonIdForLog,
            ownerUid,
            exists: userLookupExists,
            userKeys,
            userRawValues,
            userExtracted: {
              userName: userName || null,
              userEmail: userEmail || null,
              userPhone: userPhone || null,
            },
          });
        }
      } catch (error) {
        if (debugOn) {
          console.error("[Fair Flow Console][Owner Debug] Failed users doc read", {
            path: `users/${ownerUid}`,
            salonId: salonIdForLog,
            ownerUid,
            errorCode: error?.code || null,
            errorMessage: error?.message || String(error),
            error,
          });
        }
      }
    } else if (debugOn) {
      console.warn("[Fair Flow Console][Owner Debug] No ownerUid on salon document - skipping users lookup", {
        salonId: salonIdForLog,
        salonOwnerUidField: rawOwnerUid ?? null,
        salonOwnerIdField: rawOwnerId ?? null,
      });
    }

    // Display name: prefer real name from users doc, then salon, then email; never the raw UID.
    const nameForDisplay = userName || salonOwnerName || userEmail || salonOwnerEmail || "";
    const emailForDisplay = userEmail || salonOwnerEmail || "";
    const phoneForDisplay = userPhone || salonOwnerPhone || "";

    const result = {
      name: nameForDisplay || "Not available",
      email: emailForDisplay || "Not available",
      phone: phoneForDisplay || "Not available",
      ownerUid: ownerUid || "",
      source: userLookupExists
        ? "users doc"
        : (userLookupAttempted ? "salon doc (users lookup missing or blocked)" : "salon doc"),
    };

    if (debugOn) {
      console.log("[Fair Flow Console][Owner Debug] decided owner profile", {
        salonId: salonIdForLog,
        ownerUid: result.ownerUid || null,
        source: result.source,
        decided: {
          name: result.name,
          email: result.email,
          phone: result.phone,
        },
        fromUsersDoc: {
          name: userName || null,
          email: userEmail || null,
          phone: userPhone || null,
        },
        fromSalonDoc: {
          name: salonOwnerName || null,
          email: salonOwnerEmail || null,
          phone: salonOwnerPhone || null,
        },
        userLookupAttempted,
        userLookupExists,
      });
      try { console.groupEnd(); } catch (_) {}
    }

    return result;
  }

  function mapSalonToCustomerRow(salon, ownerProfile, locationsCount, staffCount) {
    const businessName = displayValue(salon?.name, "Missing salon name");
    const consoleStatus = readConsoleStatus(salon);
    const plan = displayValue(pickFirst(salon, ["plan", "planName", "subscriptionPlan"], "Not available"));
    const billing = displayValue(pickFirst(salon, ["billingStatus", "accountStatus", "status", "subscriptionStatus"], "Not available"));
    // Last Activity must come from an actual activity signal. Do not fall back to createdAt.
    const lastActivity = displayDate(pickFirst(salon, ["lastActivityAt", "lastActiveAt"], null));
    return {
      id: salon.id,
      businessName,
      owner: ownerProfile.name,
      ownerEmail: ownerProfile.email,
      ownerUid: displayValue(salon.ownerUid || salon.ownerId || "", ""),
      locationsCount,
      staffCount,
      plan,
      billing,
      consoleStatus,
      health: "Placeholder",
      lastActivity,
    };
  }

  function logReadOnlyDebug(label, payload) {
    try {
      console.groupCollapsed(`[Fair Flow Console][READ ONLY V1] ${label}`);
      console.log(payload);
      if (Array.isArray(payload?.table)) console.table(payload.table);
      console.groupEnd();
    } catch (_) {}
  }

  async function readCustomer360Path(label, details, reader, successMeta = () => ({})) {
    console.log(`[Fair Flow Console] Loading ${label}`, details);
    try {
      const result = await reader();
      console.log(`[Fair Flow Console] Success ${label}`, {
        ...details,
        ...successMeta(result),
      });
      return result;
    } catch (error) {
      console.error(`[Fair Flow Console] Failed ${label}`, {
        ...details,
        errorCode: error?.code || null,
        errorMessage: error?.message || String(error),
        error,
      });
      throw error;
    }
  }

  function getVisibleCustomerRows() {
    if (customersFilterMode === "all") return allCustomerRowsCache.slice();
    return allCustomerRowsCache.filter((row) => row.consoleStatus === customersFilterMode);
  }

  function updateCustomerFilterButtons() {
    customerFilterButtons.forEach((button) => {
      const isActive = button.dataset.customersFilter === customersFilterMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function customersSummaryText() {
    const total = allCustomerRowsCache.length;
    const counts = allCustomerRowsCache.reduce((acc, row) => {
      const key = row.consoleStatus || "unclassified";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    if (customersFilterMode === "live") return `Showing ${counts.live || 0} live customers`;
    if (customersFilterMode === "test") return `Showing ${counts.test || 0} test customers`;
    if (customersFilterMode === "archived") return `Showing ${counts.archived || 0} archived customers`;
    return `Showing ${total} total customers`;
  }

  function updateCustomersSummary() {
    if (!customersStatus) return;
    customersStatus.textContent = customersSummaryText();
  }

  function logConsoleStatusBreakdown() {
    const counts = allCustomerRowsCache.reduce((acc, row) => {
      const key = row.consoleStatus || "unclassified";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    logReadOnlyDebug("Customers consoleStatus breakdown", {
      total: allCustomerRowsCache.length,
      counts,
      table: allCustomerRowsCache.map((row) => ({
        salonId: row.id,
        name: row.businessName,
        consoleStatus: row.consoleStatus || "unclassified",
      })),
    });
  }

  function renderCustomerRows(rows) {
    if (rows) {
      allCustomerRowsCache = Array.isArray(rows) ? rows.slice() : [];
      logConsoleStatusBreakdown();
    }
    const visibleRows = getVisibleCustomerRows();
    customerRowsCache = visibleRows.slice();
    renderSupportCustomerOptions(customerRowsCache);
    updateCustomerFilterButtons();
    updateCustomersSummary();
    if (!customersTableBody) return;
    if (!visibleRows.length) {
      const noun = customersFilterMode === "all" ? "customers" : `${customersFilterMode} customers`;
      customersTableBody.innerHTML = `
        <tr>
          <td colspan="8"><strong>No ${escapeHtml(noun)} found</strong><small>Switch filter to view other customers.</small></td>
        </tr>
      `;
      return;
    }

    customersTableBody.innerHTML = visibleRows.map((row) => {
      const statusLabel = consoleStatusLabel(row.consoleStatus);
      const statusClass = consoleStatusBadgeClass(row.consoleStatus);
      return `
      <tr class="ff-platform-customer-row" tabindex="0" data-customer-360-open data-customer-id="${escapeHtml(row.id)}" data-customer-name="${escapeHtml(row.businessName)}" data-customer-owner="${escapeHtml(row.owner)}" data-customer-email="${escapeHtml(row.ownerEmail)}" data-customer-plan="${escapeHtml(row.plan)}" data-customer-health="${escapeHtml(row.health)}" data-customer-billing="${escapeHtml(row.billing)}" data-customer-locations-count="${escapeHtml(row.locationsCount)}" data-customer-staff-count="${escapeHtml(row.staffCount)}" data-customer-last-activity="${escapeHtml(row.lastActivity)}">
        <td><strong>${escapeHtml(row.businessName)}</strong><small>Firestore salon: ${escapeHtml(row.id)} - consoleStatus: ${escapeHtml(statusLabel)}</small></td>
        <td>${escapeHtml(row.owner)}</td>
        <td>${escapeHtml(row.locationsCount)}</td>
        <td>${escapeHtml(row.staffCount)}</td>
        <td><span class="ff-platform-badge">${escapeHtml(row.plan)}</span></td>
        <td><span class="ff-platform-badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
        <td><span class="ff-platform-health">${escapeHtml(row.health)}</span></td>
        <td>${escapeHtml(row.lastActivity)}</td>
      </tr>
      `;
    }).join("");
  }

  function renderSupportCustomerOptions(rows) {
    if (!supportSalonSelect) return;
    if (!rows.length) {
      supportSalonSelect.innerHTML = `<option value="">No customers loaded</option>`;
      return;
    }
    supportSalonSelect.innerHTML = [
      `<option value="">Select a customer</option>`,
      ...rows.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.businessName)} (${escapeHtml(row.id)})</option>`),
    ].join("");
  }

  async function loadFirestoreCustomersReadOnly() {
    console.log("[Fair Flow Console] loadFirestoreCustomersReadOnly invoked", {
      authReady,
      hasUser: !!currentAuthUser,
      uid: currentAuthUser?.uid || null,
      email: currentAuthUser?.email || null,
    });
    if (!customersTableBody) return;
    if (!canRunReadOnlyReads()) {
      setReadOnlyBlocked("Please log in to Fair Flow first, then reopen Fair Flow Console.");
      return;
    }
    try {
      if (customersStatus) {
        customersStatus.textContent = "READ ONLY V1: Loading customers from Firestore collection salons...";
      }
      const db = getConsoleDb();
      console.log("[Fair Flow Console] Customers query start", {
        path: "salons",
        limit: CUSTOMERS_QUERY_LIMIT,
        currentUid: currentAuthUser?.uid || null,
        currentEmail: currentAuthUser?.email || null,
      });
      const baseQuery = query(collection(db, "salons"), limit(CUSTOMERS_QUERY_LIMIT));
      const statusQueries = Array.from(CONSOLE_STATUS_VALUES).map((status) => (
        query(collection(db, "salons"), where("consoleStatus", "==", status), limit(CUSTOMERS_QUERY_LIMIT))
      ));
      const salonsSnaps = await Promise.all([
        getDocs(baseQuery),
        ...statusQueries.map((statusQuery) => getDocs(statusQuery)),
      ]);
      const salonsById = new Map();
      salonsSnaps.forEach((snap) => {
        snap.docs.forEach((salonDoc) => salonsById.set(salonDoc.id, salonDoc));
      });
      const salonDocs = Array.from(salonsById.values());
      console.log("[Fair Flow Console] Customers query success count", {
        count: salonDocs.length,
        queryCount: salonsSnaps.length,
        currentUid: currentAuthUser?.uid || null,
        currentEmail: currentAuthUser?.email || null,
      });
      const rows = await Promise.all(salonDocs.map(async (salonDoc) => {
        const salon = { id: salonDoc.id, ...(salonDoc.data() || {}) };
        const [ownerProfile, locationsCount, staffCount] = await Promise.all([
          readOwnerProfile(db, salon),
          safeSubcollectionCount(db, salonDoc.id, "locations"),
          safeSubcollectionCount(db, salonDoc.id, "staff"),
        ]);
        return mapSalonToCustomerRow(salon, ownerProfile, locationsCount, staffCount);
      }));
      logReadOnlyDebug("Customers loaded from Firestore", {
        path: "salons",
        count: rows.length,
        table: rows.map((row) => ({
          salonId: row.id,
          businessName: row.businessName,
          owner: row.owner,
          ownerLoaded: row.owner !== "Not available",
          locationsCount: row.locationsCount,
          staffCount: row.staffCount,
          plan: row.plan,
          billing: row.billing,
          lastActivity: row.lastActivity,
        })),
      });
      renderCustomerRows(rows);
    } catch (error) {
      console.error("[Fair Flow Console] Customers query failed", {
        path: "salons",
        errorCode: error?.code || null,
        errorMessage: error?.message || String(error),
        currentUid: currentAuthUser?.uid || null,
        currentEmail: currentAuthUser?.email || null,
        error,
      });
      console.warn("[Fair Flow Console] READ ONLY V1 customers load failed", error);
      if (customersStatus) {
        customersStatus.textContent = `READ ONLY V1: Could not load Firestore customers (${error?.code || "unknown"}). Showing placeholder rows.`;
      }
    }
  }

  function countStaffRows(staffRows) {
    const total = staffRows.length;
    const archived = staffRows.filter((staff) => (
      staff?.isArchived === true ||
      staff?.archived === true ||
      String(staff?.status || "").toLowerCase() === "archived"
    )).length;
    const pending = staffRows.filter((staff) => {
      const status = String(staff?.status || staff?.inviteStatus || "").toLowerCase();
      return status === "pending" || status === "invited" || status === "invite_pending";
    }).length;
    const active = staffRows.filter((staff) => {
      const status = String(staff?.status || "").toLowerCase();
      const isArchived = staff?.isArchived === true || staff?.archived === true || status === "archived";
      const isPending = status === "pending" || status === "invited" || status === "invite_pending";
      return !isArchived && !isPending && staff?.isActive !== false;
    }).length;
    return { total, active, archived, pending };
  }

  function latestStaffLastActiveAt(staffRows) {
    const dates = staffRows
      .map((staff) => timestampToDate(staff?.lastActiveAt))
      .filter(Boolean);
    if (!dates.length) return null;
    return dates.sort((a, b) => b.getTime() - a.getTime())[0];
  }

  function daysSince(date) {
    if (!date) return null;
    const elapsedMs = Date.now() - date.getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
    return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
  }

  function countRequestsByStatus(requests) {
    return requests.reduce((acc, request) => {
      const status = String(request?.status || "").toLowerCase();
      if (status === "open") acc.open += 1;
      if (status === "pending") acc.pending += 1;
      if (status === "needs_info") acc.needsInfo += 1;
      if (status === "approved" || status === "done") acc.approvedDone += 1;
      if (status === "denied") acc.denied += 1;
      return acc;
    }, { open: 0, pending: 0, needsInfo: 0, approvedDone: 0, denied: 0 });
  }

  function computeCustomerHealthV1({ billing, lastActivityDate, inboxSummary }) {
    const billingStatus = String(billing || "").trim().toLowerCase().replace(/[_\s-]+/g, "_");
    const billingRiskStatuses = new Set(["failed", "past_due", "cancelled", "canceled", "suspended", "deleted"]);
    const billingHealthyStatuses = new Set(["active", "trial", "trialing", "current"]);
    const activityAgeDays = daysSince(lastActivityDate);
    const inboxAvailable = inboxSummary?.available === true;
    const counts = inboxSummary?.counts || { open: 0, pending: 0, needsInfo: 0 };
    const openWorkCount = Number(counts.open || 0) + Number(counts.pending || 0) + Number(counts.needsInfo || 0);

    if (billingRiskStatuses.has(billingStatus)) {
      return { label: "At Risk", state: "error", reason: "billing risk" };
    }
    if (activityAgeDays !== null && activityAgeDays > 60) {
      return { label: "At Risk", state: "error", reason: "no recent activity for 60+ days" };
    }
    if (openWorkCount >= 10) {
      return { label: "At Risk", state: "error", reason: "high open request volume" };
    }
    if (activityAgeDays !== null && activityAgeDays > 30) {
      return { label: "Needs Review", state: "warning", reason: "no recent activity for 30+ days" };
    }
    if (inboxAvailable && openWorkCount > 0) {
      return { label: "Needs Review", state: "warning", reason: "open inbox requests" };
    }
    if (billingHealthyStatuses.has(billingStatus) && activityAgeDays !== null && inboxAvailable && openWorkCount === 0) {
      return { label: "Healthy", state: "healthy", reason: "active billing, recent activity, no open requests" };
    }
    return { label: "Not enough data", state: "", reason: "missing live health signals" };
  }

  function applyCustomerIntelligence({ health, lastActivity, lastActivityDate, inboxSummary, usageSummary, dataUsageSummary, staffCounts }) {
    const moduleRows = Object.values(usageSummary?.modules || {});
    const usedModuleCount = moduleRows.filter((module) => module?.count > 0).length +
      (dataUsageSummary?.media?.used ? 1 : 0) +
      (inboxSummary?.total > 0 ? 1 : 0);
    const totalModuleCount = USAGE_MODULE_KEYS.length;
    const counts = inboxSummary?.counts || {};
    const openWorkCount = Number(counts.open || 0) + Number(counts.pending || 0) + Number(counts.needsInfo || 0);
    const activityAgeDays = daysSince(lastActivityDate);
    const availableSignals = [
      health?.label && health.label !== "Not enough data",
      lastActivityDate,
      inboxSummary?.available === true,
      moduleRows.some((module) => module?.available === true),
      dataUsageSummary?.available === true,
      staffCounts?.total > 0,
    ].filter(Boolean).length;
    const healthState = health?.state || "";
    const statusState = healthState === "error" ? "error" : healthState === "warning" ? "warning" : availableSignals ? "healthy" : "";
    const statusLabel = availableSignals ? "Connected" : "Limited";
    const activityText = lastActivityDate
      ? `${lastActivity}${activityAgeDays !== null ? ` (${activityAgeDays} days ago)` : ""}`
      : "Not available";
    const requestText = inboxSummary?.available
      ? `${openWorkCount} open / ${inboxSummary.total || 0} total`
      : "Not available";
    const staffText = staffCounts
      ? `${staffCounts.active} active / ${staffCounts.total} total`
      : "Not available";
    const summaryParts = [];

    if (health?.label) summaryParts.push(`Health: ${health.label}`);
    if (usedModuleCount > 0) summaryParts.push(`${usedModuleCount}/${totalModuleCount} modules active`);
    if (openWorkCount > 0) summaryParts.push(`${openWorkCount} open requests`);
    if (!summaryParts.length) summaryParts.push("Live signals are limited for this customer");

    setText("[data-customer-360-intelligence-summary]", summaryParts.join(" · "));
    setBadgeState("[data-customer-360-intelligence-status]", statusLabel, statusState);
    setText("[data-customer-360-intelligence-health]", health?.reason ? `${health.label} - ${health.reason}` : displayValue(health?.label));
    setText("[data-customer-360-intelligence-adoption]", `${usedModuleCount}/${totalModuleCount} modules show data`);
    setText("[data-customer-360-intelligence-activity]", activityText);
    setText("[data-customer-360-intelligence-requests]", requestText);
    setText("[data-customer-360-intelligence-staff]", staffText);
    setText("[data-customer-360-intelligence-notes]", "Based on read-only Firestore signals loaded for this customer.");
  }

  function renderLocations(locations) {
    const body = shell.querySelector("[data-customer-360-locations-body]");
    if (!body) return;
    if (!locations.length) {
      body.innerHTML = `<tr><td colspan="3">Not available</td></tr>`;
      return;
    }
    body.innerHTML = locations.map((location) => {
      const name = displayValue(pickFirst(location, ["name", "locationName", "displayName"], location.id));
      const staffCount = displayValue(pickFirst(location, ["staffCount", "activeStaffCount"], "Not available"));
      const isActive = location?.isActive !== false && String(location?.status || "active").toLowerCase() !== "inactive";
      const statusLabel = displayValue(pickFirst(location, ["status"], isActive ? "Active" : "Inactive"));
      const statusClass = isActive ? "healthy" : "";
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(staffCount)}</td>
          <td><span class="ff-platform-badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
        </tr>
      `;
    }).join("");
  }

  // READ ONLY V1: Usage Overview module status helpers.
  // Each module defaults to "Not connected" until a real data source is wired in.
  // Media flips to "Used" only when Data Usage finds totalFiles > 0 (Firestore-backed signal).
  const USAGE_MODULE_KEYS = [
    "queue",
    "tasks",
    "inbox",
    "tickets",
    "chat",
    "media",
    "inventory",
    "training",
    "schedule",
    "timeclock",
    "points",
  ];

  function resetUsageOverviewModules() {
    USAGE_MODULE_KEYS.forEach((key) => {
      const statusSelector = `[data-customer-360-module-${key}-status]`;
      const detailSelector = `[data-customer-360-module-${key}-detail]`;
      shell.querySelectorAll(statusSelector).forEach((node) => {
        node.textContent = "Not connected";
        node.classList.remove("healthy", "warning", "error");
      });
      shell.querySelectorAll(detailSelector).forEach((node) => {
        node.textContent = "Last Activity: Not available";
      });
    });
  }

  function updateUsageModuleStatus(key, label, detail = "Last Activity: Not available", state = "") {
    const statusSelector = `[data-customer-360-module-${key}-status]`;
    const detailSelector = `[data-customer-360-module-${key}-detail]`;
    shell.querySelectorAll(statusSelector).forEach((node) => {
      node.textContent = label;
      node.classList.remove("healthy", "warning", "error");
      if (state) node.classList.add(state);
    });
    shell.querySelectorAll(detailSelector).forEach((node) => {
      node.textContent = detail;
    });
  }

  function moduleActivityDate(source) {
    if (!source || typeof source !== "object") return null;
    const timestamp = pickFirst(source, [
      "lastActivityAt",
      "lastActiveAt",
      "lastSeenAt",
      "lastHeartbeatAt",
      "updatedAt",
      "createdAt",
      "lastMessageAt",
      "publishedAt",
      "lastBroadcastAt",
      "clockOutAt",
      "clockInAt",
      "seenAt",
      "pingAt",
      "uploadedAt",
      "completedAt",
      "doneAt",
      "closedAt",
      "resolvedAt",
      "voidedAt",
      "eventAt",
      "awardedAt",
    ], null);
    const timestampDate = timestampToDate(timestamp);
    if (timestampDate) return timestampDate;
    const ms = Number(pickFirst(source, ["lastActivityMs", "lastHeartbeatMs", "updatedAtMs", "lastMessageAtMs"], ""));
    return Number.isFinite(ms) && ms > 0 ? new Date(ms) : null;
  }

  function latestModuleActivityDate(rows) {
    const dates = rows
      .map(moduleActivityDate)
      .filter(Boolean);
    if (!dates.length) return null;
    return dates.sort((a, b) => b.getTime() - a.getTime())[0];
  }

  function moduleDetail(rowCount, latestDate) {
    const activity = latestDate ? displayDate(latestDate) : "Not available";
    return `${rowCount} docs / Last Activity: ${activity}`;
  }

  async function readModuleDocs(label, moduleQuery, maxDocs = 50) {
    try {
      const snap = await getDocs(moduleQuery);
      return {
        available: true,
        label,
        rows: snap.docs.map((itemDoc) => ({ id: itemDoc.id, ...(itemDoc.data() || {}) })),
        limited: snap.size >= maxDocs,
      };
    } catch (error) {
      console.warn(`[Fair Flow Console] READ ONLY V1 ${label} module load failed`, error);
      return {
        available: false,
        label,
        rows: [],
        errorCode: error?.code || "unknown",
      };
    }
  }

  function applyModuleRowsToUsageOverview(key, result, usedLabel = "Used") {
    if (!result.available) {
      updateUsageModuleStatus(key, "Not available", `Read failed: ${result.errorCode || "unknown"}`, "warning");
      return;
    }
    const latestDate = latestModuleActivityDate(result.rows);
    const label = result.rows.length ? usedLabel : "No data";
    updateUsageModuleStatus(
      key,
      label,
      moduleDetail(result.rows.length, latestDate),
      result.rows.length ? "healthy" : "",
    );
  }

  function updateInboxModuleStatus(requests, errorCode = "") {
    if (errorCode) {
      updateUsageModuleStatus("inbox", "Not available", `Read failed: ${errorCode}`, "warning");
      return;
    }
    const counts = countRequestsByStatus(requests);
    const openWorkCount = Number(counts.open || 0) + Number(counts.pending || 0) + Number(counts.needsInfo || 0);
    const latestDate = latestModuleActivityDate(requests);
    const detailParts = [`${requests.length} requests`];
    if (openWorkCount > 0) detailParts.push(`${openWorkCount} open`);
    detailParts.push(`Last Activity: ${latestDate ? displayDate(latestDate) : "Not available"}`);
    updateUsageModuleStatus(
      "inbox",
      requests.length ? "Used" : "No data",
      detailParts.join(" / "),
      requests.length ? "healthy" : "",
    );
  }

  function summarizeModuleResult(result, rowsOverride = null) {
    const rows = rowsOverride || result.rows || [];
    return {
      available: result.available === true,
      count: rows.length,
      latestDate: latestModuleActivityDate(rows),
      errorCode: result.errorCode || null,
    };
  }

  async function loadUsageOverviewModulesReadOnly(salonId) {
    // READ ONLY V1: bounded module checks only. No writes and no module actions.
    const db = getConsoleDb();
    const [
      queueResult,
      tasksResult,
      inventoryItemsResult,
      inventoryCategoriesResult,
      trainingItemsResult,
      trainingProgressResult,
      scheduleResult,
      timeClockResult,
      ticketsResult,
      ticketSummariesResult,
      chatResult,
      pointsResult,
    ] = await Promise.all([
      readModuleDocs("Queue", query(collection(db, "salons", salonId, "queueState"), limit(50))),
      readModuleDocs("Tasks", query(collection(db, "salons", salonId, "tasksState"), limit(50))),
      readModuleDocs("Inventory items", query(collection(db, "salons", salonId, "inventoryItems"), limit(50))),
      readModuleDocs("Inventory categories", query(collection(db, "salons", salonId, "inventoryCategories"), limit(50))),
      readModuleDocs("Training items", query(collection(db, "trainingItems"), where("salonId", "==", salonId), limit(50))),
      readModuleDocs("Training progress", query(collection(db, "trainingProgress"), where("salonId", "==", salonId), limit(50))),
      readModuleDocs("Schedule", query(collection(db, "salons", salonId, "schedulePublish"), limit(50))),
      readModuleDocs("Time Clock", query(collection(db, "salons", salonId, "timeEntries"), limit(50))),
      readModuleDocs("Tickets", query(collection(db, "salons", salonId, "tickets"), limit(50))),
      readModuleDocs("Ticket summaries", query(collection(db, "salons", salonId, "ticketSummaries"), limit(50))),
      readModuleDocs("Chat", query(collection(db, "salons", salonId, "conversations"), limit(50))),
      readModuleDocs("Fair Flow Points", query(collection(db, "accounts", salonId, "pointsEvents"), limit(50))),
    ]);

    applyModuleRowsToUsageOverview("queue", queueResult);
    applyModuleRowsToUsageOverview("tasks", tasksResult);

    const inventoryRows = [
      ...inventoryItemsResult.rows,
      ...inventoryCategoriesResult.rows,
    ];
    applyModuleRowsToUsageOverview("inventory", {
      available: inventoryItemsResult.available || inventoryCategoriesResult.available,
      rows: inventoryRows,
      errorCode: inventoryItemsResult.errorCode || inventoryCategoriesResult.errorCode,
    });

    const trainingRows = [
      ...trainingItemsResult.rows,
      ...trainingProgressResult.rows,
    ];
    applyModuleRowsToUsageOverview("training", {
      available: trainingItemsResult.available || trainingProgressResult.available,
      rows: trainingRows,
      errorCode: trainingItemsResult.errorCode || trainingProgressResult.errorCode,
    });

    applyModuleRowsToUsageOverview("schedule", scheduleResult);
    applyModuleRowsToUsageOverview("timeclock", timeClockResult);

    const ticketRows = [
      ...ticketsResult.rows,
      ...ticketSummariesResult.rows,
    ];
    applyModuleRowsToUsageOverview("tickets", {
      available: ticketsResult.available || ticketSummariesResult.available,
      rows: ticketRows,
      errorCode: ticketsResult.errorCode || ticketSummariesResult.errorCode,
    });
    applyModuleRowsToUsageOverview("chat", chatResult, "Used");
    applyModuleRowsToUsageOverview("points", pointsResult, "Used");

    logReadOnlyDebug("Usage Overview modules loaded", {
      salonId,
      queue: { available: queueResult.available, count: queueResult.rows.length, errorCode: queueResult.errorCode || null },
      tasks: { available: tasksResult.available, count: tasksResult.rows.length, errorCode: tasksResult.errorCode || null },
      inventory: {
        itemsAvailable: inventoryItemsResult.available,
        categoriesAvailable: inventoryCategoriesResult.available,
        count: inventoryRows.length,
        errorCode: inventoryItemsResult.errorCode || inventoryCategoriesResult.errorCode || null,
      },
      training: {
        itemsAvailable: trainingItemsResult.available,
        progressAvailable: trainingProgressResult.available,
        count: trainingRows.length,
        errorCode: trainingItemsResult.errorCode || trainingProgressResult.errorCode || null,
      },
      schedule: { available: scheduleResult.available, count: scheduleResult.rows.length, errorCode: scheduleResult.errorCode || null },
      timeClock: { available: timeClockResult.available, count: timeClockResult.rows.length, errorCode: timeClockResult.errorCode || null },
      tickets: {
        activeAvailable: ticketsResult.available,
        summariesAvailable: ticketSummariesResult.available,
        count: ticketRows.length,
        errorCode: ticketsResult.errorCode || ticketSummariesResult.errorCode || null,
      },
      chat: { available: chatResult.available, count: chatResult.rows.length, errorCode: chatResult.errorCode || null },
      points: { available: pointsResult.available, count: pointsResult.rows.length, errorCode: pointsResult.errorCode || null },
    });
    return {
      modules: {
        queue: summarizeModuleResult(queueResult),
        tasks: summarizeModuleResult(tasksResult),
        inventory: summarizeModuleResult({
          available: inventoryItemsResult.available || inventoryCategoriesResult.available,
          errorCode: inventoryItemsResult.errorCode || inventoryCategoriesResult.errorCode,
        }, inventoryRows),
        training: summarizeModuleResult({
          available: trainingItemsResult.available || trainingProgressResult.available,
          errorCode: trainingItemsResult.errorCode || trainingProgressResult.errorCode,
        }, trainingRows),
        schedule: summarizeModuleResult(scheduleResult),
        timeclock: summarizeModuleResult(timeClockResult),
        tickets: summarizeModuleResult({
          available: ticketsResult.available || ticketSummariesResult.available,
          errorCode: ticketsResult.errorCode || ticketSummariesResult.errorCode,
        }, ticketRows),
        chat: summarizeModuleResult(chatResult),
        points: summarizeModuleResult(pointsResult),
      },
    };
  }

  function updateMediaModuleStatus(totalFiles, monthlyUploads, hasAnySize, mediaBytes) {
    const statusNodes = shell.querySelectorAll("[data-customer-360-module-media-status]");
    const detailNodes = shell.querySelectorAll("[data-customer-360-module-media-detail]");
    const numericTotal = Number(totalFiles);
    const used = Number.isFinite(numericTotal) && numericTotal > 0;
    statusNodes.forEach((node) => {
      node.textContent = used ? "Used" : "No data";
      node.classList.remove("healthy", "warning", "error");
      if (used) node.classList.add("healthy");
    });
    detailNodes.forEach((node) => {
      if (!used) {
        node.textContent = "0 files / Last Activity: Not available";
        return;
      }
      const monthly = Number(monthlyUploads);
      const parts = [`${numericTotal} files`];
      if (Number.isFinite(monthly) && monthly > 0) parts.push(`${monthly} this month`);
      if (hasAnySize && Number.isFinite(mediaBytes) && mediaBytes > 0) parts.push(formatBytes(mediaBytes));
      node.textContent = parts.join(" / ");
    });
  }

  function renderDataUsageLoading() {
    setText("[data-customer-360-usage-status-line]", "READ ONLY V1: Loading usage metadata...");
    setText("[data-customer-360-data-usage-summary]", "Loading media usage from read-only Firestore...");
    setText("[data-customer-360-storage-used]", "Loading...");
    setText("[data-customer-360-media-storage]", "Loading...");
    setText("[data-customer-360-training-storage]", "Not connected");
    setText("[data-customer-360-total-files]", "Loading...");
    setText("[data-customer-360-monthly-uploads]", "Loading...");
    setText("[data-customer-360-plan-limit]", "Loading...");
    const status = shell.querySelector("[data-customer-360-usage-status]");
    if (status) status.innerHTML = `<span class="ff-platform-badge">Loading</span>`;
  }

  function renderDataUsageUnavailable(message = "READ ONLY V1: Usage metadata not available.") {
    setText("[data-customer-360-usage-status-line]", message);
    setText("[data-customer-360-data-usage-summary]", "Usage metadata could not be loaded.");
    setText("[data-customer-360-storage-used]", "Not available");
    setText("[data-customer-360-media-storage]", "Not available");
    setText("[data-customer-360-training-storage]", "Not connected");
    setText("[data-customer-360-total-files]", "Not available");
    setText("[data-customer-360-monthly-uploads]", "Not available");
    setText("[data-customer-360-plan-limit]", "Not available");
    const status = shell.querySelector("[data-customer-360-usage-status]");
    if (status) status.innerHTML = `<span class="ff-platform-badge">Not available</span>`;
  }

  function overrideTypeLabel(type) {
    const labels = {
      free_time: "Free time",
      trial_extension: "Trial extension",
      discount_percent: "Discount percent",
      discount_amount: "Discount amount",
      grace_period: "Grace period",
      billing_review: "Billing review note",
    };
    return labels[type] || displayValue(type, "Internal override");
  }

  function overrideSummary(override) {
    if (!override || override.enabled !== true) return "No active override";
    const parts = [displayValue(override.planName, "Billing override")];
    if (override.monthlyPrice !== undefined && override.monthlyPrice !== null) {
      const monthlyPrice = Number(override.monthlyPrice || 0);
      if (monthlyPrice > 0) parts.push(`$${monthlyPrice.toFixed(2)} / month`);
    }
    const endsAt = displayDate(override.endsAt);
    if (endsAt !== "Not available") parts.push(`until ${endsAt}`);
    return parts.join(" · ");
  }

  function parseDateInputToEndOfDayMs(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    const date = new Date(`${text}T23:59:59`);
    return Number.isNaN(date.getTime()) ? null : date.getTime();
  }

  function parseCurrencyLike(value) {
    const cleaned = String(value || "").replace(/[^0-9.]/g, "");
    const amount = Number(cleaned);
    return Number.isFinite(amount) ? amount : 0;
  }

  function buildOverridePlanName(type, value) {
    const label = overrideTypeLabel(type);
    const cleanValue = String(value || "").trim();
    return cleanValue ? `${label} - ${cleanValue}` : label;
  }

  function monthlyPriceForOverride(type, value) {
    if (type === "discount_amount") return 0;
    return 0;
  }

  function resetBillingOverrideUi() {
    setText("[data-customer-360-discounts]", "Loading...");
    setText("[data-customer-360-billing-override-status]", "Internal only");
    setBadgeState("[data-billing-override-save-status]", "Internal only");
    setText("[data-billing-override-current]", "Loading...");
    setText("[data-billing-override-current-reason]", "--");
    setText("[data-billing-override-current-note]", "--");
    setText("[data-billing-override-current-updated-by]", "--");
    setText("[data-billing-override-current-updated-at]", "--");
  }

  function applyBillingOverrideToUi(override) {
    const summary = overrideSummary(override);
    const hasOverride = summary !== "No active override";
    setText("[data-customer-360-discounts]", summary);
    setText("[data-billing-override-current]", summary);
    setText("[data-billing-override-current-reason]", displayValue(override?.reason, "--"));
    setText("[data-billing-override-current-note]", displayValue(override?.notes || override?.note, "--"));
    setText("[data-billing-override-current-updated-by]", displayValue(override?.updatedByEmail || override?.updatedBy || override?.updatedByUid, "--"));
    setText("[data-billing-override-current-updated-at]", displayDate(override?.updatedAt));
    setText(
      "[data-customer-360-billing-override-status]",
      hasOverride ? (override?.stripeApplied ? "Stripe override active" : "Override active") : "No override",
    );
    setBadgeState(
      "[data-billing-override-save-status]",
      hasOverride ? (override?.stripeApplied ? "Stripe active" : "Override active") : "Internal only",
      hasOverride ? "warning" : "",
    );
  }

  function renderBillingOverrideUnavailable(message = "Could not load billing override.") {
    setText("[data-customer-360-discounts]", "Not available");
    setText("[data-billing-override-current]", message);
    setText("[data-billing-override-current-reason]", "--");
    setText("[data-billing-override-current-note]", "--");
    setText("[data-billing-override-current-updated-by]", "--");
    setText("[data-billing-override-current-updated-at]", "--");
    setText("[data-customer-360-billing-override-status]", "Not available");
    setBadgeState("[data-billing-override-save-status]", "Not available", "warning");
  }

  async function loadBillingOverrideReadOnly(salonId) {
    if (!salonId) {
      applyBillingOverrideToUi(null);
      return null;
    }
    try {
      const db = getConsoleDb();
      const snap = await getDoc(doc(db, "salons", salonId, "billing", "override"));
      const override = snap.exists() ? (snap.data() || {}) : null;
      applyBillingOverrideToUi(override);
      return override;
    } catch (error) {
      console.warn("[Fair Flow Console] Billing override load failed", error);
      renderBillingOverrideUnavailable(`Could not load override (${error?.code || "unknown"}).`);
      return null;
    }
  }

  async function saveBillingOverride(event) {
    event.preventDefault();
    if (!billingOverrideForm) return;
    if (!activeCustomer360SalonId) {
      setBadgeState("[data-billing-override-save-status]", "Missing customer", "warning");
      return;
    }
    if (!canRunReadOnlyReads()) {
      setBadgeState("[data-billing-override-save-status]", "Login required", "warning");
      return;
    }

    const formData = new FormData(billingOverrideForm);
    const type = String(formData.get("type") || "free_time").trim();
    const value = String(formData.get("value") || "").trim();
    const reason = String(formData.get("reason") || "internal").trim().toLowerCase();
    const endsAtMs = parseDateInputToEndOfDayMs(formData.get("endsAt"));
    const applyToStripe = formData.get("applyToStripe") === "on";
    const stripeSupportedTypes = new Set(["free_time", "trial_extension", "discount_percent", "discount_amount"]);
    if (!reason) {
      setBadgeState("[data-billing-override-save-status]", "Reason required", "warning");
      return;
    }
    if (!endsAtMs) {
      setBadgeState("[data-billing-override-save-status]", "End date required", "warning");
      return;
    }
    if (endsAtMs <= Date.now()) {
      setBadgeState("[data-billing-override-save-status]", "End date must be future", "warning");
      return;
    }

    const submitButton = billingOverrideForm.querySelector("button[type='submit']");
    if (submitButton) submitButton.disabled = true;
    setBadgeState("[data-billing-override-save-status]", "Saving...");

    let internalOverrideSaved = false;
    try {
      const payload = {
        salonId: activeCustomer360SalonId,
        reason,
        planName: buildOverridePlanName(type, value),
        monthlyPrice: monthlyPriceForOverride(type, value),
        endsAt: endsAtMs,
        notes: String(formData.get("note") || "").trim(),
      };
      const setBillingOverride = httpsCallable(getConsoleFunctions(), "setBillingOverride");
      await setBillingOverride(payload);
      internalOverrideSaved = true;
      if (applyToStripe && stripeSupportedTypes.has(type)) {
        setBadgeState("[data-billing-override-save-status]", "Applying to Stripe...");
        const applyStripeBillingOverride = httpsCallable(getConsoleFunctions(), "applyStripeBillingOverride");
        await applyStripeBillingOverride({
          salonId: activeCustomer360SalonId,
          type,
          value,
          endsAt: endsAtMs,
          reason,
          notes: payload.notes,
        });
        setBadgeState("[data-billing-override-save-status]", "Saved + Stripe active", "healthy");
      } else if (applyToStripe) {
        setBadgeState("[data-billing-override-save-status]", "Saved internal; no Stripe charge change", "healthy");
      } else {
        setBadgeState("[data-billing-override-save-status]", "Saved + active", "healthy");
      }
      await loadBillingOverrideReadOnly(activeCustomer360SalonId);
    } catch (error) {
      console.warn("[Fair Flow Console] Billing override save failed", error);
      const message = error?.message || error?.code || error?.details?.message || "unknown";
      if (internalOverrideSaved) {
        setBadgeState("[data-billing-override-save-status]", `Internal saved; Stripe failed: ${message}`, "error");
        await loadBillingOverrideReadOnly(activeCustomer360SalonId);
      } else {
        setBadgeState("[data-billing-override-save-status]", `Save failed: ${message}`, "error");
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function loadDataUsageReadOnly(salonId, salon) {
    // READ ONLY V1: bounded Firestore reads only. No Storage metadata calls and no writes.
    renderDataUsageLoading();
    try {
      const mediaWorkLimit = 50;
      const mediaItemsPerWorkLimit = 25;
      const worksSnap = await getDocs(query(collection(consoleDb, "salons", salonId, "contentWorks"), limit(mediaWorkLimit)));
      let totalFiles = 0;
      let monthlyUploads = 0;
      let mediaBytes = 0;
      let hasAnySize = false;
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      await Promise.all(worksSnap.docs.map(async (workDoc) => {
        try {
          const itemsSnap = await getDocs(query(collection(consoleDb, "salons", salonId, "contentWorks", workDoc.id, "mediaItems"), limit(mediaItemsPerWorkLimit)));
          itemsSnap.docs.forEach((itemDoc) => {
            const item = itemDoc.data() || {};
            totalFiles += 1;
            const itemBytes = readByteSize(item);
            if (itemBytes > 0) {
              mediaBytes += itemBytes;
              hasAnySize = true;
            }
            const createdAt = timestampToDate(pickFirst(item, ["createdAt", "uploadedAt"], null));
            if (createdAt && createdAt >= monthStart) monthlyUploads += 1;
          });
        } catch (_) {
          // Keep usage read bounded and fail-soft per work.
        }
      }));

      const planLimit = displayValue(pickFirst(salon, ["storageLimit", "storageLimitGb", "planStorageLimit", "usageLimitGb"], ""), "No data");
      const storageValue = hasAnySize ? formatBytes(mediaBytes) : (totalFiles ? "Size not tracked" : "No data");
      setText("[data-customer-360-storage-used]", storageValue);
      setText("[data-customer-360-media-storage]", storageValue);
      setText("[data-customer-360-training-storage]", "Not connected");
      setText("[data-customer-360-total-files]", String(totalFiles));
      setText("[data-customer-360-monthly-uploads]", String(monthlyUploads));
      setText("[data-customer-360-plan-limit]", planLimit);
      updateMediaModuleStatus(totalFiles, monthlyUploads, hasAnySize, mediaBytes);
      const status = shell.querySelector("[data-customer-360-usage-status]");
      if (status) status.innerHTML = totalFiles
        ? `<span class="ff-platform-badge healthy">Used</span>`
        : `<span class="ff-platform-badge">No data</span>`;
      const limited = worksSnap.size >= mediaWorkLimit ? ` Limited scan: first ${mediaWorkLimit} works, ${mediaItemsPerWorkLimit} media items each.` : "";
      setText("[data-customer-360-usage-status-line]", `READ ONLY V1: Loaded media usage metadata.${limited}`);
      setText(
        "[data-customer-360-data-usage-summary]",
        totalFiles ? `${totalFiles} media files${monthlyUploads ? ` · ${monthlyUploads} this month` : ""}` : "No media files found.",
      );
      logReadOnlyDebug("Data Usage loaded", {
        salonId,
        paths: [
          `salons/${salonId}/contentWorks`,
          `salons/${salonId}/contentWorks/{workId}/mediaItems`,
        ],
        limits: {
          contentWorks: mediaWorkLimit,
          mediaItemsPerWork: mediaItemsPerWorkLimit,
        },
        totalFiles,
        monthlyUploads,
        sizeFieldsFound: hasAnySize,
        mediaBytes: hasAnySize ? mediaBytes : "Not available",
        mediaStorage: hasAnySize ? formatBytes(mediaBytes) : "Not available",
        trainingStorage: "Not available",
        currentPlanLimit: planLimit,
        limitation: "No Firebase Storage metadata calls in READ ONLY V1; size requires Firestore size fields on mediaItems.",
      });
      return {
        available: true,
        media: {
          used: totalFiles > 0,
          totalFiles,
          monthlyUploads,
          mediaBytes,
        },
      };
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 data usage load failed", error);
      renderDataUsageUnavailable(`READ ONLY V1: Could not load usage metadata (${error?.code || "unknown"}).`);
      updateMediaModuleStatus(0, 0, false, 0);
      return {
        available: false,
        media: { used: false, totalFiles: 0, monthlyUploads: 0, mediaBytes: 0 },
        errorCode: error?.code || "unknown",
      };
    }
  }

  function requestActivityMs(request) {
    const last = timestampToDate(request?.lastActivityAt);
    const created = timestampToDate(request?.createdAt);
    return (last || created || new Date(0)).getTime();
  }

  function renderRequestsUnavailable(message = "READ ONLY V1 - Inbox / Requests: Not available.", errorCode = "unknown") {
    setText("[data-customer-360-requests-status]", message);
    setText("[data-customer-360-requests-open]", "--");
    setText("[data-customer-360-requests-pending]", "--");
    setText("[data-customer-360-requests-needs-info]", "--");
    setText("[data-customer-360-requests-approved]", "--");
    setText("[data-customer-360-requests-denied]", "--");
    updateInboxModuleStatus([], errorCode);
    const body = shell.querySelector("[data-customer-360-requests-body]");
    if (body) body.innerHTML = `<tr><td colspan="7">Not available</td></tr>`;
  }

  function renderRequestsLoading() {
    setText("[data-customer-360-requests-status]", "READ ONLY V1 - Inbox / Requests: Loading...");
    updateUsageModuleStatus("inbox", "Loading", "Loading internal requests...");
    const body = shell.querySelector("[data-customer-360-requests-body]");
    if (body) body.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;
  }

  function renderRequestsReadOnly(requests) {
    const counts = countRequestsByStatus(requests);

    setText("[data-customer-360-requests-open]", String(counts.open));
    setText("[data-customer-360-requests-pending]", String(counts.pending));
    setText("[data-customer-360-requests-needs-info]", String(counts.needsInfo));
    setText("[data-customer-360-requests-approved]", String(counts.approvedDone));
    setText("[data-customer-360-requests-denied]", String(counts.denied));
    updateInboxModuleStatus(requests);

    const body = shell.querySelector("[data-customer-360-requests-body]");
    if (!body) return;
    const latest = requests.slice().sort((a, b) => requestActivityMs(b) - requestActivityMs(a)).slice(0, 10);
    if (!latest.length) {
      body.innerHTML = `<tr><td colspan="7">No requests found</td></tr>`;
      return;
    }
    body.innerHTML = latest.map((request) => {
      const status = displayValue(request.status, "Not available");
      const statusLc = status.toLowerCase();
      const statusClass = statusLc === "denied" ? "error" : (statusLc === "pending" || statusLc === "needs_info" ? "warning" : "healthy");
      return `
        <tr>
          <td>${escapeHtml(displayValue(request.type, "Not available"))}</td>
          <td><span class="ff-platform-badge ${statusClass}">${escapeHtml(status)}</span></td>
          <td>${escapeHtml(displayValue(request.priority, "Not available"))}</td>
          <td>${escapeHtml(displayValue(request.createdByName || request.createdByStaffId || request.createdByUid, "Not available"))}</td>
          <td>${escapeHtml(displayValue(request.forStaffName || request.assignedTo || request.forStaffId || request.forUid, "Not available"))}</td>
          <td>${escapeHtml(displayDate(request.lastActivityAt || request.createdAt))}</td>
          <td>${escapeHtml(displayDate(request.createdAt))}</td>
        </tr>
      `;
    }).join("");
  }

  async function loadInboxRequestsReadOnly(salonId) {
    // READ ONLY V1 - Inbox / Requests: bounded getDocs only. No approve/deny/notes/status updates.
    renderRequestsLoading();
    try {
      const requestsLimit = 100;
      const snap = await getDocs(query(collection(consoleDb, "salons", salonId, "inboxItems"), limit(requestsLimit)));
      const requests = snap.docs.map((requestDoc) => ({ id: requestDoc.id, ...(requestDoc.data() || {}) }));
      renderRequestsReadOnly(requests);
      const suffix = snap.size >= requestsLimit ? ` Limited to first ${requestsLimit} docs.` : "";
      setText("[data-customer-360-requests-status]", `READ ONLY V1 - Inbox / Requests: Loaded ${requests.length} requests.${suffix}`);
      const counts = countRequestsByStatus(requests);
      logReadOnlyDebug("Inbox / Requests loaded", {
        salonId,
        path: `salons/${salonId}/inboxItems`,
        limit: requestsLimit,
        totalFound: requests.length,
        counts,
        latest5: requests
          .slice()
          .sort((a, b) => requestActivityMs(b) - requestActivityMs(a))
          .slice(0, 5)
          .map((request) => ({
            id: request.id,
            type: displayValue(request.type, "Not available"),
            status: displayValue(request.status, "Not available"),
            priority: displayValue(request.priority, "Not available"),
            createdBy: displayValue(request.createdByName || request.createdByStaffId || request.createdByUid, "Not available"),
            assignedTo: displayValue(request.forStaffName || request.assignedTo || request.forStaffId || request.forUid, "Not available"),
            lastActivity: displayDate(request.lastActivityAt || request.createdAt),
            createdAt: displayDate(request.createdAt),
          })),
      });
      return { available: true, counts, total: requests.length };
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 inbox requests load failed", error);
      renderRequestsUnavailable(
        `READ ONLY V1 - Inbox / Requests: Could not load (${error?.code || "unknown"}).`,
        error?.code || "unknown",
      );
      return { available: false, counts: null, total: null, errorCode: error?.code || "unknown" };
    }
  }

  function conversationActivityMs(conversation) {
    return Number(conversation?.lastMessageAtMs) ||
      Number(conversation?.updatedAtMs) ||
      (timestampToDate(conversation?.lastMessageAt)?.getTime() || 0) ||
      (timestampToDate(conversation?.updatedAt)?.getTime() || 0) ||
      (timestampToDate(conversation?.createdAt)?.getTime() || 0);
  }

  function unreadSummary(unreadFor) {
    if (!unreadFor || typeof unreadFor !== "object") return "None";
    const entries = Object.entries(unreadFor)
      .filter(([, value]) => Number(value) > 0)
      .map(([uid, value]) => `${uid}: ${value}`);
    return entries.length ? entries.join(", ") : "None";
  }

  function renderSupportUnavailable(message = "READ ONLY V1: Not available.") {
    if (supportStatus) supportStatus.textContent = message;
    setText("[data-support-total-conversations]", "--");
    setText("[data-support-unread-conversations]", "--");
    setText("[data-support-last-activity]", "--");
    if (supportConversationsBody) {
      supportConversationsBody.innerHTML = `<tr><td colspan="7">Not available</td></tr>`;
    }
  }

  function renderSupportLoading() {
    if (supportStatus) supportStatus.textContent = "READ ONLY V1: Loading conversations...";
    setText("[data-support-total-conversations]", "...");
    setText("[data-support-unread-conversations]", "...");
    setText("[data-support-last-activity]", "...");
    if (supportConversationsBody) {
      supportConversationsBody.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;
    }
  }

  function renderSupportConversations(salonId, conversations) {
    const sorted = conversations.slice().sort((a, b) => conversationActivityMs(b) - conversationActivityMs(a));
    const unreadCount = conversations.filter((conversation) => {
      const unreadFor = conversation?.unreadFor || {};
      return unreadFor && typeof unreadFor === "object" && Object.values(unreadFor).some((value) => Number(value) > 0);
    }).length;
    const lastActivity = sorted.length ? displayDate(sorted[0].lastMessageAt || sorted[0].updatedAt || sorted[0].createdAt) : "Not available";

    setText("[data-support-total-conversations]", String(conversations.length));
    setText("[data-support-unread-conversations]", String(unreadCount));
    setText("[data-support-last-activity]", lastActivity);
    if (supportStatus) supportStatus.textContent = `READ ONLY V1: Loaded ${conversations.length} conversations from salons/${salonId}/conversations.`;

    if (!supportConversationsBody) return;
    const latest = sorted.slice(0, 10);
    if (!latest.length) {
      supportConversationsBody.innerHTML = `<tr><td colspan="7">No conversations found</td></tr>`;
      return;
    }
    supportConversationsBody.innerHTML = latest.map((conversation) => `
      <tr>
        <td>${escapeHtml(displayValue(conversation.lastSenderName, "Not available"))}</td>
        <td>${escapeHtml(displayValue(conversation.lastSenderRole, "Not available"))}</td>
        <td>${escapeHtml(displayValue(conversation.lastMessage || conversation.lastTitle, "Not available"))}</td>
        <td>${escapeHtml(displayDate(conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt))}</td>
        <td>${escapeHtml(Array.isArray(conversation.participants) ? String(conversation.participants.length) : "Not available")}</td>
        <td>${escapeHtml(unreadSummary(conversation.unreadFor))}</td>
        <td>${escapeHtml(displayValue(conversation.locationId, "Not available"))}</td>
      </tr>
    `).join("");
  }

  async function loadSupportConversationsReadOnly(salonId) {
    // READ ONLY V1: Support conversations summary. No messages subcollection reads and no writes.
    if (!canRunReadOnlyReads()) {
      renderSupportUnavailable("Please log in to Fair Flow first, then reopen Fair Flow Console.");
      return;
    }
    if (!salonId) {
      renderSupportUnavailable("READ ONLY V1: Select a customer.");
      return;
    }
    renderSupportLoading();
    try {
      const db = getConsoleDb();
      const conversationsLimit = 100;
      const snap = await getDocs(query(collection(db, "salons", salonId, "conversations"), limit(conversationsLimit)));
      const conversations = snap.docs.map((conversationDoc) => ({ id: conversationDoc.id, ...(conversationDoc.data() || {}) }));
      renderSupportConversations(salonId, conversations);
      logReadOnlyDebug("Support conversations loaded", {
        salonId,
        path: `salons/${salonId}/conversations`,
        limit: conversationsLimit,
        totalFound: conversations.length,
        latest5: conversations
          .slice()
          .sort((a, b) => conversationActivityMs(b) - conversationActivityMs(a))
          .slice(0, 5)
          .map((conversation) => ({
            id: conversation.id,
            lastSenderName: displayValue(conversation.lastSenderName, "Not available"),
            lastSenderRole: displayValue(conversation.lastSenderRole, "Not available"),
            lastMessage: displayValue(conversation.lastMessage || conversation.lastTitle, "Not available"),
            lastActivity: displayDate(conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt),
            participantsCount: Array.isArray(conversation.participants) ? conversation.participants.length : "Not available",
            unreadFor: unreadSummary(conversation.unreadFor),
            locationId: displayValue(conversation.locationId, "Not available"),
          })),
      });
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 support conversations load failed", error);
      renderSupportUnavailable(`READ ONLY V1: Could not load conversations (${error?.code || "unknown"}).`);
    }
  }

  function setCustomer360Loading(row) {
    const name = row.dataset.customerName || "Customer";
    setText("[data-customer-360-status]", "READ ONLY V1: Loading customer...");
    setText("[data-customer-360-name]", name);
    setText("[data-customer-360-name-copy]", name);
    setText("[data-customer-360-owner]", displayValue(row.dataset.customerOwner, "Not available"));
    setText("[data-customer-360-email]", displayValue(row.dataset.customerEmail, "Not available"));
    setText("[data-customer-360-phone]", "Not available");
    resetUsageOverviewModules();
    resetCustomerIntelligence();
    resetBillingOverrideUi();
    setText("[data-customer-360-locations-count]", displayValue(row.dataset.customerLocationsCount, "Not available"));
    setText("[data-customer-360-staff-count]", displayValue(row.dataset.customerStaffCount, "Not available"));
    setText("[data-customer-360-plan]", displayValue(row.dataset.customerPlan, "Not available"));
    setText("[data-customer-360-plan-copy]", displayValue(row.dataset.customerPlan, "Not available"));
    setText("[data-customer-360-plan-billing]", displayValue(row.dataset.customerPlan, "Not available"));
    setText("[data-customer-360-billing]", displayValue(row.dataset.customerBilling, "Not available"));
    setText("[data-customer-360-payment]", displayValue(row.dataset.customerBilling, "Not available"));
    setText("[data-customer-360-staff-summary-line]", "Loading staff signals...");
    setBadgeState("[data-customer-360-staff-status]", "Loading");
    setText("[data-customer-360-created-at]", "Loading...");
    setText("[data-customer-360-last-activity]", displayValue(row.dataset.customerLastActivity, "Not available"));
    setText("[data-customer-360-initials]", getInitials(name));
    renderDataUsageLoading();
    renderRequestsLoading();
  }

  async function loadCustomer360ReadOnly(salonId, row) {
    // READ ONLY V1: Customer 360 detail load uses getDoc/getDocs only.
    activeCustomer360SalonId = salonId || "";
    setCustomer360Loading(row);
    if (!canRunReadOnlyReads()) {
      setText("[data-customer-360-status]", "Please log in to Fair Flow first, then reopen Fair Flow Console.");
      setText("[data-customer-360-intelligence-summary]", "Login is required to load customer intelligence.");
      setBadgeState("[data-customer-360-intelligence-status]", "Not available", "warning");
      setText("[data-customer-360-staff-summary-line]", "Login is required to load staff signals.");
      setBadgeState("[data-customer-360-staff-status]", "Not available", "warning");
      renderLocations([]);
      renderDataUsageUnavailable();
      renderRequestsUnavailable();
      return;
    }
    if (!salonId) {
      setText("[data-customer-360-status]", "READ ONLY V1: Missing salonId for this row.");
      setText("[data-customer-360-intelligence-summary]", "Missing salon id.");
      setBadgeState("[data-customer-360-intelligence-status]", "Not available", "warning");
      setText("[data-customer-360-staff-summary-line]", "Missing salon id.");
      setBadgeState("[data-customer-360-staff-status]", "Not available", "warning");
      return;
    }
    try {
      const db = getConsoleDb();

      const [salonResult, locationsResult, staffResult] = await Promise.allSettled([
        readCustomer360Path(
          "salon doc",
          { path: `salons/${salonId}`, salonId, ownerUid: null },
          () => getDoc(doc(db, "salons", salonId)),
          (snap) => ({ exists: snap.exists() }),
        ),
        readCustomer360Path(
          "locations",
          { path: `salons/${salonId}/locations`, salonId, ownerUid: null },
          () => getDocs(collection(db, "salons", salonId, "locations")),
          (snap) => ({ count: snap.size }),
        ),
        readCustomer360Path(
          "staff",
          { path: `salons/${salonId}/staff`, salonId, ownerUid: null },
          () => getDocs(collection(db, "salons", salonId, "staff")),
          (snap) => ({ count: snap.size }),
        ),
      ]);

      const failedRead = [salonResult, locationsResult, staffResult].find((result) => result.status === "rejected");
      if (failedRead) throw failedRead.reason;

      const salonSnap = salonResult.value;
      const locationsSnap = locationsResult.value;
      const staffSnap = staffResult.value;
      const salon = salonSnap.exists() ? { id: salonId, ...(salonSnap.data() || {}) } : { id: salonId };
      const ownerProfile = await readOwnerProfile(db, salon, { customer360: true, salonId });
      const locations = locationsSnap.docs.map((locationDoc) => ({ id: locationDoc.id, ...(locationDoc.data() || {}) }));
      const staffRows = staffSnap.docs.map((staffDoc) => ({ id: staffDoc.id, ...(staffDoc.data() || {}) }));
      const staffCounts = countStaffRows(staffRows);
      const businessName = displayValue(pickFirst(salon, ["name", "businessName", "salonName", "displayName"], salonId));
      const plan = displayValue(pickFirst(salon, ["plan", "planName", "subscriptionPlan"], "Not available"));
      const billing = displayValue(pickFirst(salon, ["billingStatus", "accountStatus", "status", "subscriptionStatus"], "Not available"));
      const createdAt = displayDate(pickFirst(salon, ["createdAt"], null));
      // Last Activity must come from an actual activity signal. Customer Since already shows createdAt.
      const lastActivityDate = timestampToDate(pickFirst(salon, ["lastActivityAt", "lastActiveAt"], null)) ||
        latestStaffLastActiveAt(staffRows);
      const lastActivity = displayDate(
        lastActivityDate,
      );
      const gracePeriod = displayDate(pickFirst(salon, ["gracePeriodEndsAt"], null));
      const ownerName = displayValue(ownerProfile.name, "Not available");
      const ownerEmail = displayValue(ownerProfile.email, "Not available");
      const ownerPhone = displayValue(ownerProfile.phone, "Not available");

      setText("[data-customer-360-status]", `READ ONLY V1: Loaded salon ${salonId}.`);
      setText("[data-customer-360-name]", businessName);
      setText("[data-customer-360-name-copy]", businessName);
      setText("[data-customer-360-owner]", ownerName);
      setText("[data-customer-360-email]", ownerEmail);
      setText("[data-customer-360-phone]", ownerPhone);
      console.log("[Fair Flow Console] Owner profile applied to UI", {
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone,
      });
      setText("[data-customer-360-locations-count]", String(locations.length));
      setText("[data-customer-360-staff-count]", String(staffRows.length));
      setText("[data-customer-360-plan]", plan);
      setText("[data-customer-360-plan-copy]", plan);
      setText("[data-customer-360-plan-billing]", plan);
      setText("[data-customer-360-billing]", billing);
      setText("[data-customer-360-payment]", billing);
      setText("[data-customer-360-created-at]", createdAt);
      setText("[data-customer-360-last-activity]", lastActivity);
      setText("[data-customer-360-grace-period]", gracePeriod);
      setText("[data-customer-360-total-staff]", String(staffCounts.total));
      setText("[data-customer-360-active-staff]", String(staffCounts.active));
      setText("[data-customer-360-archived-staff]", String(staffCounts.archived));
      setText("[data-customer-360-pending-invites]", String(staffCounts.pending));
      setText(
        "[data-customer-360-staff-summary-line]",
        `${staffCounts.total} total · ${staffCounts.active} active · ${staffCounts.pending} pending invites`,
      );
      setBadgeState(
        "[data-customer-360-staff-status]",
        staffCounts.total ? "Loaded" : "No data",
        staffCounts.active ? "healthy" : "",
      );
      setText("[data-customer-360-initials]", getInitials(businessName));
      renderLocations(locations);
      logReadOnlyDebug("Customer 360 loaded", {
        salonId,
        paths: [
          `salons/${salonId}`,
          `salons/${salonId}/locations`,
          `salons/${salonId}/staff`,
        ],
        loaded: {
          businessName,
          ownerName,
          ownerEmail,
          locationsCount: locations.length,
          staffCount: staffRows.length,
          plan,
          billingStatus: billing,
          createdAt,
          lastActivity,
          gracePeriod,
        },
        notAvailable: Object.entries({
          ownerName,
          ownerEmail,
          plan,
          billingStatus: billing,
          createdAt,
          lastActivity,
          gracePeriod,
        }).filter(([, value]) => value === "Not available").map(([key]) => key),
        locations: locations.map((location) => ({
          id: location.id,
          name: displayValue(pickFirst(location, ["name", "locationName", "displayName"], location.id)),
          status: displayValue(pickFirst(location, ["status"], location?.isActive !== false ? "Active" : "Inactive")),
        })),
        staffSummary: staffCounts,
      });
      const [dataUsageSummary, inboxSummary, usageSummary] = await Promise.all([
        loadDataUsageReadOnly(salonId, salon),
        loadInboxRequestsReadOnly(salonId),
        loadUsageOverviewModulesReadOnly(salonId),
        loadBillingOverrideReadOnly(salonId),
      ]);
      const health = computeCustomerHealthV1({ billing, lastActivityDate, inboxSummary });
      setHealthBadge(health.label, health.state);
      applyCustomerIntelligence({
        health,
        lastActivity,
        lastActivityDate,
        inboxSummary,
        usageSummary,
        dataUsageSummary,
        staffCounts,
      });
      console.log("[Fair Flow Console] Customer Health V1 applied", {
        salonId,
        label: health.label,
        reason: health.reason,
        billing,
        lastActivity,
        inboxSummary,
      });
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 customer detail load failed", error);
      setText("[data-customer-360-status]", `READ ONLY V1: Could not load details (${error?.code || "unknown"}).`);
      setText("[data-customer-360-intelligence-summary]", `Could not load customer intelligence (${error?.code || "unknown"}).`);
      setBadgeState("[data-customer-360-intelligence-status]", "Not available", "warning");
      setText("[data-customer-360-staff-summary-line]", `Could not load staff signals (${error?.code || "unknown"}).`);
      setBadgeState("[data-customer-360-staff-status]", "Not available", "warning");
      renderLocations([]);
      renderDataUsageUnavailable();
      renderRequestsUnavailable();
    }
  }

  function openCustomer360(row) {
    previousSectionId = "customers";
    const data = row.dataset;
    const name = data.customerName || "Customer";
    const owner = data.customerOwner || "--";
    const plan = data.customerPlan || "--";
    const billing = data.customerBilling || "--";

    setText("[data-customer-360-name]", name);
    setText("[data-customer-360-name-copy]", name);
    setText("[data-customer-360-owner]", owner);
    setText("[data-customer-360-plan]", plan);
    setText("[data-customer-360-plan-copy]", plan);
    setText("[data-customer-360-plan-billing]", plan);
    setText("[data-customer-360-billing]", billing);
    setText("[data-customer-360-payment]", billing);
    setText("[data-customer-360-initials]", getInitials(name));
    setHealthBadge();
    activateSection("customer-360");
    loadCustomer360ReadOnly(data.customerId || "", row);
  }

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      activateSection(item.dataset.platformSectionTarget);
    });
  });

  if (customersTableBody) {
    customersTableBody.addEventListener("click", (event) => {
      const row = event.target.closest("[data-customer-360-open]");
      if (row) openCustomer360(row);
    });
    customersTableBody.addEventListener("keydown", (event) => {
      const row = event.target.closest("[data-customer-360-open]");
      if (row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openCustomer360(row);
      }
    });
  }

  customerFilterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const requested = String(button.dataset.customersFilter || "").trim().toLowerCase();
      const nextMode = (requested === "all" || CONSOLE_STATUS_VALUES.has(requested)) ? requested : "live";
      if (customersFilterMode === nextMode) return;
      customersFilterMode = nextMode;
      renderCustomerRows();
    });
  });

  if (customerBack) {
    customerBack.addEventListener("click", () => {
      activateSection(previousSectionId);
    });
  }

  if (sidebarToggle) {
    sidebarToggle.addEventListener("click", () => {
      const isCollapsed = shell.classList.toggle("is-sidebar-collapsed");
      sidebarToggle.setAttribute("aria-pressed", String(isCollapsed));
      sidebarToggle.setAttribute("aria-label", isCollapsed ? "Expand sidebar" : "Collapse sidebar");
    });
  }

  if (mobileToggle) {
    mobileToggle.addEventListener("click", () => {
      const isOpen = shell.classList.toggle("is-mobile-nav-open");
      mobileToggle.setAttribute("aria-expanded", String(isOpen));
    });
  }

  if (supportSalonSelect) {
    supportSalonSelect.addEventListener("change", () => {
      loadSupportConversationsReadOnly(supportSalonSelect.value);
    });
  }

  if (billingOverrideForm) {
    billingOverrideForm.addEventListener("submit", saveBillingOverride);
  }

  if (consoleLoginForm) {
    consoleLoginForm.addEventListener("submit", signInConsoleWithEmail);
  }

  if (consoleGoogleLogin) {
    consoleGoogleLogin.addEventListener("click", signInConsoleWithGoogle);
  }

  if (consoleAuthReset) {
    consoleAuthReset.addEventListener("click", async () => {
      try {
        if (consoleAuth) await signOut(consoleAuth);
      } catch (_) {}
      setConsoleAuthView("login");
    });
  }

  if (consoleAdminForm) {
    const roleSelect = consoleAdminForm.querySelector("[data-console-admin-role]");
    if (roleSelect) {
      roleSelect.addEventListener("change", () => applyRoleDefaults(roleSelect.value));
      applyRoleDefaults(roleSelect.value || "admin");
    }
    consoleAdminForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!hasConsolePermission("admins")) return;
      const formData = new FormData(consoleAdminForm);
      const email = String(formData.get("email") || "").trim();
      const name = String(formData.get("name") || "").trim();
      const role = String(formData.get("role") || "readonly").trim();
      const permissions = readPermissionForm(formData);
      if (consoleAdminMessage) consoleAdminMessage.textContent = "Saving console admin...";
      try {
        const savePlatformAdmin = httpsCallable(getConsoleFunctions(), "savePlatformAdminV1");
        const { data } = await savePlatformAdmin({ email, name, role, active: true, permissions });
        consoleAdminForm.reset();
        applyRoleDefaults("admin");
        if (consoleAdminMessage) {
          consoleAdminMessage.textContent = data?.resetLink
            ? `Saved. New Auth user created. Password setup link: ${data.resetLink}`
            : "Saved.";
        }
        await loadConsoleAdmins();
      } catch (error) {
        console.warn("[Fair Flow Console] platform admin save failed", error);
        if (consoleAdminMessage) consoleAdminMessage.textContent = `Save failed: ${error?.message || error?.code || "unknown"}`;
      }
    });
  }

  if (consoleAdminsBody) {
    consoleAdminsBody.addEventListener("click", async (event) => {
      const activeButton = event.target.closest("[data-console-admin-active]");
      const editButton = event.target.closest("[data-console-admin-edit]");
      const row = event.target.closest("[data-console-admin-row]");
      if (!row || !hasConsolePermission("admins")) return;

      if (editButton && consoleAdminForm) {
        consoleAdminForm.elements.name.value = row.dataset.adminName || "";
        consoleAdminForm.elements.email.value = row.dataset.adminEmail || "";
        consoleAdminForm.elements.role.value = row.dataset.adminRole || "readonly";
        let permissions = {};
        try {
          permissions = JSON.parse(row.dataset.adminPermissions || "{}");
        } catch (_) {}
        Object.keys(ROLE_DEFAULT_PERMISSIONS.owner).forEach((key) => {
          const input = consoleAdminForm.querySelector(`[name="perm_${key}"]`);
          if (input) input.checked = permissions[key] === true;
        });
        if (consoleAdminMessage) consoleAdminMessage.textContent = "Editing selected admin. Save to apply changes.";
        return;
      }

      if (activeButton) {
        const uid = row.dataset.adminUid || "";
        const active = activeButton.dataset.consoleAdminActive === "true";
        try {
          activeButton.disabled = true;
          const setPlatformAdminActive = httpsCallable(getConsoleFunctions(), "setPlatformAdminActiveV1");
          await setPlatformAdminActive({ uid, active });
          await loadConsoleAdmins();
        } catch (error) {
          console.warn("[Fair Flow Console] platform admin active toggle failed", error);
          if (consoleAdminMessage) consoleAdminMessage.textContent = `Update failed: ${error?.message || error?.code || "unknown"}`;
          activeButton.disabled = false;
        }
      }
    });
  }

  function startAuthGate() {
    logConsoleAuthStep("AUTH START");
    setConsoleAuthView("loading");
    setAuthStatus("Checking Fair Flow session...", "checking");
    if (customersStatus) customersStatus.textContent = "Checking Fair Flow session...";
    if (customersTableBody) {
      customersTableBody.innerHTML = `<tr><td colspan="8">Checking Fair Flow session...</td></tr>`;
    }

    const app = getConsoleApp();
    consoleAuth = getAuth(app);
    setPersistence(consoleAuth, browserLocalPersistence).catch((error) => {
      console.warn("[Fair Flow Console] Auth persistence setup failed", error);
    });
    ensureConsoleSignOutButton();
    const authGateTimeout = window.setTimeout(() => {
      const stillLoading = document.body.classList.contains("ff-console-auth-loading");
      if (!stillLoading || currentConsoleAdmin) return;
      const message = "Console auth timed out after 10 seconds before a session response. Check Network for the platformAdmins Firestore request.";
      logConsoleAuthStep("AUTH TIMEOUT", { message });
      setConsoleAuthView("denied", message);
      setAuthStatus("Console auth timed out.", "signed-out");
      clearOperationalData(message);
    }, CONSOLE_SESSION_TIMEOUT_MS);
    onAuthStateChanged(consoleAuth, async (user) => {
      window.clearTimeout(authGateTimeout);
      authReady = true;
      currentAuthUser = user || null;
      currentConsoleAdmin = null;

      if (!user) {
        console.log("[Fair Flow Console] Auth signed out");
        setConsoleAuthView("login");
        setAuthStatus("Sign in with your internal Fair Flow admin account.", "signed-out");
        clearOperationalData("Sign in to the internal Fair Flow Console to load operational data.");
        return;
      }

      logConsoleAuthStep("AUTH USER UID", { uid: user.uid, email: user.email || "" });
      try {
        logConsoleAuthStep("CALLING getPlatformAdminSession", { source: "firestore:platformAdmins", uid: user.uid, email: user.email || "" });
        const adminSnap = await withTimeout(
          getDoc(doc(getConsoleDb(), "platformAdmins", user.uid)),
          CONSOLE_SESSION_TIMEOUT_MS,
          "Console permission check",
        );
        const data = {
          ok: adminSnap.exists(),
          admin: adminSnap.exists() ? { uid: adminSnap.id, ...(adminSnap.data() || {}) } : null,
        };
        logConsoleAuthStep("SESSION RESPONSE", {
          ok: data?.ok === true,
          uid: data?.admin?.uid || "",
          email: data?.admin?.email || "",
          role: data?.admin?.role || "",
          active: data?.admin?.active === true,
          primaryOwner: data?.admin?.primaryOwner === true,
        });
        if (data?.ok !== true) {
          throw new Error("Console permission check returned an invalid response.");
        }
        currentConsoleAdmin = data?.admin || null;
        if (!currentConsoleAdmin || currentConsoleAdmin.active !== true) {
          throw new Error("Console admin access denied.");
        }
        setConsoleAuthView("authorized");
        setAuthStatus(`Signed in as: ${currentConsoleAdmin.email || user.email || user.uid} (${currentConsoleAdmin.role})`, "signed-in");
        applyConsolePermissionGuards();
        console.log("[Fair Flow Console] Starting read-only Firestore loading");
        loadFirestoreCustomersReadOnly();
        loadConsoleAdmins();
      } catch (error) {
        console.warn("[Fair Flow Console] platform admin session denied", error);
        const code = String(error?.code || "");
        const message = String(error?.message || "");
        const disabled = code.includes("failed-precondition") || /disabled|inactive/i.test(message);
        const timedOut = /timed out/i.test(message);
        const displayMessage = timedOut
          ? `Console permission check timed out after ${Math.round(CONSOLE_SESSION_TIMEOUT_MS / 1000)} seconds. Check Network for the platformAdmins Firestore request.`
          : message || "Console admin access denied.";
        logConsoleAuthStep("SESSION ERROR", {
          code,
          message,
          displayMessage,
          stack: error?.stack || "",
        });
        setConsoleAuthView(disabled ? "disabled" : "denied", displayMessage);
        setAuthStatus(timedOut ? "Console permission check timed out." : "Console admin access denied.", "signed-out");
        clearOperationalData(disabled ? "Access disabled." : displayMessage);
      }
    });
  }

  startAuthGate();
})();
