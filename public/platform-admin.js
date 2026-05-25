// V1 Foundation Only: static section navigation for the Fair Flow Console.
// READ ONLY V1: Firestore integration below uses getDoc/getDocs only. No writes, no Stripe, no app module imports.
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  collection,
  doc,
  getFirestore,
  getDoc,
  getDocs,
  limit,
  query,
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
  let previousSectionId = "customers";
  let consoleDb = null;
  let consoleAuth = null;
  let authReady = false;
  let currentAuthUser = null;
  let customerRowsCache = [];
  let allCustomerRowsCache = [];
  let customersFilterMode = "active";

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

  function setHealthBadge(value) {
    const badge = shell.querySelector("[data-customer-360-health]");
    if (!badge) return;
    badge.textContent = value;
    badge.classList.remove("healthy", "warning", "error");
    if (value === "High Risk") {
      badge.classList.add("error");
    } else if (value === "Medium Risk") {
      badge.classList.add("warning");
    } else {
      badge.classList.add("healthy");
    }
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

  function normalizeStatusToken(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[_\s-]+/g, "_");
  }

  function classifyCustomerStatus(salon) {
    const rawStatus = pickFirst(salon, ["status", "accountStatus", "billingStatus"], "");
    const normalized = normalizeStatusToken(rawStatus);
    const activeStatuses = new Set(["active", "trial", "trialing"]);
    const hiddenStatuses = new Set(["inactive", "archived", "cancelled", "canceled", "deleted", "test", "demo"]);

    if (activeStatuses.has(normalized)) {
      return {
        key: normalized,
        group: "active",
        label: normalized === "active" ? "Active" : "Trial",
        raw: displayValue(rawStatus, "active"),
      };
    }

    if (hiddenStatuses.has(normalized)) {
      return {
        key: normalized,
        group: "hidden",
        label: normalized === "canceled" ? "Cancelled" : displayValue(rawStatus, "Inactive"),
        raw: displayValue(rawStatus, "Inactive"),
      };
    }

    return {
      key: normalized || "unknown",
      group: "unknown",
      label: "Unknown status",
      raw: displayValue(rawStatus, "Not available"),
    };
  }

  function countIsZero(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric === 0;
  }

  function numericCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  }

  function normalizeCustomerNameForDedupe(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function customerProductionScore(salon, locationsCount, staffCount) {
    const staffScore = numericCount(staffCount) * 1000000;
    const locationScore = numericCount(locationsCount) * 10000;
    const activityDate = timestampToDate(pickFirst(salon, ["lastActivityAt", "lastActiveAt", "updatedAt", "createdAt"], null));
    const activityScore = activityDate ? activityDate.getTime() : 0;
    return staffScore + locationScore + activityScore;
  }

  function ownerIsMissing(salon, ownerProfile) {
    const ownerSignal = pickFirst(salon, ["ownerName", "owner", "createdByName", "contactName", "ownerUid", "ownerId", "ownerEmail", "email", "contactEmail"], "");
    const ownerName = displayValue(ownerProfile?.name, "");
    const ownerEmail = displayValue(ownerProfile?.email, "");
    return !ownerSignal && !ownerName && !ownerEmail;
  }

  function testNameReasons(name) {
    const normalizedName = String(name || "").toLowerCase();
    const testTerms = [
      { term: "neo neo", reason: "name contains neo neo" },
      { term: "apple", reason: "name contains apple" },
      { term: "demo", reason: "name contains demo" },
      { term: "test", reason: "name contains test" },
    ];
    return testTerms
      .filter(({ term }) => normalizedName.includes(term))
      .map(({ reason }) => reason);
  }

  function billingIsMissing(salon) {
    return !pickFirst(salon, ["billingStatus", "accountStatus", "subscriptionStatus", "planStatus"], "");
  }

  function activityIsMissing(salon) {
    return !pickFirst(salon, ["lastActivityAt", "lastActiveAt", "updatedAt"], "");
  }

  function buildCustomerHiddenReasons(salon, ownerProfile, locationsCount, staffCount) {
    const reasons = [];
    reasons.push(...testNameReasons(salon?.name));
    if (ownerIsMissing(salon, ownerProfile)) reasons.push("owner missing");
    if (!pickFirst(salon, ["createdAt"], null)) reasons.push("createdAt missing");
    if (countIsZero(locationsCount) && countIsZero(staffCount)) reasons.push("locations count = 0 and staff count = 0");
    if (billingIsMissing(salon) && activityIsMissing(salon)) reasons.push("billing missing and no activity");
    return reasons;
  }

  function ownerUidForProductionGrouping(row) {
    return String(row.ownerUid || "").trim();
  }

  function applyOwnerDuplicateHiddenReasons(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!row.isProductionCustomer) return;
      const key = ownerUidForProductionGrouping(row);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    groups.forEach((group) => {
      if (group.length < 2) return;
      const keeper = group.slice().sort((a, b) => b.duplicateScore - a.duplicateScore)[0];
      group.forEach((row) => {
        if (row.id === keeper.id) return;
        row.hiddenReasons = [
          ...(row.hiddenReasons || []),
          `same ownerUid as another salon (kept ${keeper.id})`,
        ];
        row.isProductionCustomer = false;
      });
    });
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

  async function readOwnerProfile(db, salon, debugContext = null) {
    const ownerDirect = pickFirst(salon, ["ownerName", "owner", "createdByName", "contactName"], "");
    const ownerEmailDirect = pickFirst(salon, ["ownerEmail", "email", "contactEmail"], "");
    if (ownerDirect || ownerEmailDirect) {
      if (debugContext?.customer360) {
        console.log("[Fair Flow Console] Success owner", {
          salonId: debugContext.salonId || salon.id || null,
          ownerUid: salon.ownerUid || salon.ownerId || null,
          source: "salon document fields",
        });
      }
      return {
        name: displayValue(ownerDirect, "Not available"),
        email: displayValue(ownerEmailDirect, "Not available"),
      };
    }

    const ownerUid = displayValue(salon.ownerUid || salon.ownerId || "", "");
    if (!ownerUid) {
      if (debugContext?.customer360) {
        console.log("[Fair Flow Console] Success owner", {
          salonId: debugContext.salonId || salon.id || null,
          ownerUid: null,
          source: "no ownerUid on salon document",
        });
      }
      return { name: "Not available", email: "Not available" };
    }

    // READ ONLY V1: optional owner profile lookup from existing users/{uid}.
    try {
      if (debugContext?.customer360) {
        console.log("[Fair Flow Console] Loading owner user", {
          path: `users/${ownerUid}`,
          salonId: debugContext.salonId || salon.id || null,
          ownerUid,
        });
      }
      const userSnap = await getDoc(doc(db, "users", ownerUid));
      if (debugContext?.customer360) {
        console.log("[Fair Flow Console] Success owner", {
          path: `users/${ownerUid}`,
          salonId: debugContext.salonId || salon.id || null,
          ownerUid,
          exists: userSnap.exists(),
        });
      }
      if (!userSnap.exists()) return { name: ownerUid, email: "Not available" };
      const user = userSnap.data() || {};
      return {
        name: displayValue(pickFirst(user, ["name", "displayName", "email"], ownerUid)),
        email: displayValue(pickFirst(user, ["email"], "Not available")),
      };
    } catch (error) {
      if (debugContext?.customer360) {
        console.error("[Fair Flow Console] Failed owner", {
          path: `users/${ownerUid}`,
          salonId: debugContext.salonId || salon.id || null,
          ownerUid,
          errorCode: error?.code || null,
          errorMessage: error?.message || String(error),
          error,
        });
      }
      return { name: ownerUid, email: "Not available" };
    }
  }

  function mapSalonToCustomerRow(salon, ownerProfile, locationsCount, staffCount) {
    const businessName = displayValue(salon?.name, "Missing salon name");
    const customerStatus = classifyCustomerStatus(salon);
    const hiddenReasons = buildCustomerHiddenReasons(salon, ownerProfile, locationsCount, staffCount);
    const duplicateScore = customerProductionScore(salon, locationsCount, staffCount);
    const plan = displayValue(pickFirst(salon, ["plan", "planName", "subscriptionPlan"], "Not available"));
    const billing = displayValue(pickFirst(salon, ["billingStatus", "accountStatus", "status", "subscriptionStatus"], "Not available"));
    const lastActivity = displayDate(pickFirst(salon, ["lastActivityAt", "lastActiveAt", "updatedAt", "createdAt"], null));
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
      customerStatus,
      hiddenReasons,
      isProductionCustomer: hiddenReasons.length === 0,
      duplicateScore,
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
    return allCustomerRowsCache.filter((row) => row.isProductionCustomer);
  }

  function customerStatusBadgeClass(statusGroup) {
    if (statusGroup === "active") return "healthy";
    if (statusGroup === "unknown") return "warning";
    return "error";
  }

  function updateCustomerFilterButtons() {
    customerFilterButtons.forEach((button) => {
      if (button.dataset.customersFilter === "active") {
        button.textContent = "Production only";
      }
      const isActive = button.dataset.customersFilter === customersFilterMode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
  }

  function updateCustomersSummary(totalCount, visibleCount) {
    if (!customersStatus) return;
    const productionCount = allCustomerRowsCache.filter((row) => row.isProductionCustomer).length;
    const hiddenCount = Math.max(totalCount - productionCount, 0);
    if (customersFilterMode === "all") {
      customersStatus.textContent = `Showing all ${totalCount} customers. Showing ${visibleCount} total rows. Hidden ${hiddenCount} test / incomplete customers in Production only.`;
      return;
    }
    customersStatus.textContent = `Showing ${productionCount} production customers. Hidden ${hiddenCount} test / incomplete customers.`;
  }

  function logCustomerHiddenReasons() {
    const hiddenRows = allCustomerRowsCache.filter((row) => !row.isProductionCustomer);
    const sameOwnerRows = hiddenRows.filter((row) => (row.hiddenReasons || []).some((reason) => reason.includes("same ownerUid")));
    const reasonCounts = hiddenRows.reduce((acc, row) => {
      (row.hiddenReasons || ["hidden"]).forEach((reason) => {
        acc[reason] = (acc[reason] || 0) + 1;
      });
      return acc;
    }, {});
    logReadOnlyDebug("Customer hidden reasons", {
      totalCustomers: allCustomerRowsCache.length,
      productionCustomers: allCustomerRowsCache.length - hiddenRows.length,
      hiddenCustomers: hiddenRows.length,
      reasonCounts,
      sameOwnerHiddenCustomers: sameOwnerRows.length,
      sameOwnerGroups: sameOwnerRows.reduce((acc, row) => {
        const key = row.ownerUid || "missing ownerUid";
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      table: hiddenRows.map((row) => ({
        salonId: row.id,
        name: row.businessName,
        ownerUid: row.ownerUid || "Not available",
        status: row.customerStatus?.raw || "Not available",
        locationsCount: row.locationsCount,
        staffCount: row.staffCount,
        hiddenReasons: (row.hiddenReasons || []).join(", "),
      })),
    });
  }

  function renderCustomerRows(rows) {
    const incomingRows = Array.isArray(rows) ? rows.slice() : [];
    if (rows) {
      allCustomerRowsCache = incomingRows;
      applyOwnerDuplicateHiddenReasons(allCustomerRowsCache);
      logCustomerHiddenReasons();
    }
    const visibleRows = getVisibleCustomerRows();
    customerRowsCache = visibleRows.slice();
    renderSupportCustomerOptions(customerRowsCache);
    updateCustomerFilterButtons();
    updateCustomersSummary(allCustomerRowsCache.length, visibleRows.length);
    if (!customersTableBody) return;
    if (!visibleRows.length) {
      const message = customersFilterMode === "active"
        ? "No production customers found"
        : "No customers found";
      customersTableBody.innerHTML = `
        <tr>
          <td colspan="8"><strong>${escapeHtml(message)}</strong><small>Use All to view test or incomplete customers.</small></td>
        </tr>
      `;
      return;
    }

    customersTableBody.innerHTML = visibleRows.map((row) => `
      <tr class="ff-platform-customer-row" tabindex="0" data-customer-360-open data-customer-id="${escapeHtml(row.id)}" data-customer-name="${escapeHtml(row.businessName)}" data-customer-owner="${escapeHtml(row.owner)}" data-customer-email="${escapeHtml(row.ownerEmail)}" data-customer-plan="${escapeHtml(row.plan)}" data-customer-health="${escapeHtml(row.health)}" data-customer-billing="${escapeHtml(row.billing)}" data-customer-locations-count="${escapeHtml(row.locationsCount)}" data-customer-staff-count="${escapeHtml(row.staffCount)}" data-customer-last-activity="${escapeHtml(row.lastActivity)}">
        <td><strong>${escapeHtml(row.businessName)}</strong><small>Firestore salon: ${escapeHtml(row.id)} - Status: ${escapeHtml(row.customerStatus?.label || "Unknown status")}${row.hiddenReasons?.length ? ` - Hidden: ${escapeHtml(row.hiddenReasons.join(", "))}` : ""}</small></td>
        <td>${escapeHtml(row.owner)}</td>
        <td>${escapeHtml(row.locationsCount)}</td>
        <td>${escapeHtml(row.staffCount)}</td>
        <td><span class="ff-platform-badge">${escapeHtml(row.plan)}</span></td>
        <td><span class="ff-platform-badge ${customerStatusBadgeClass(row.customerStatus?.group)}">${escapeHtml(row.customerStatus?.label || row.billing)}</span></td>
        <td><span class="ff-platform-health">${escapeHtml(row.health)}</span></td>
        <td>${escapeHtml(row.lastActivity)}</td>
      </tr>
    `).join("");
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
        limit: 50,
        currentUid: currentAuthUser?.uid || null,
        currentEmail: currentAuthUser?.email || null,
      });
      const salonsSnap = await getDocs(query(collection(db, "salons"), limit(50)));
      console.log("[Fair Flow Console] Customers query success count", {
        count: salonsSnap.size,
        currentUid: currentAuthUser?.uid || null,
        currentEmail: currentAuthUser?.email || null,
      });
      const rows = await Promise.all(salonsSnap.docs.map(async (salonDoc) => {
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

  function renderDataUsageLoading() {
    setText("[data-customer-360-usage-status-line]", "READ ONLY V1: Loading usage metadata...");
    setText("[data-customer-360-storage-used]", "Loading...");
    setText("[data-customer-360-media-storage]", "Loading...");
    setText("[data-customer-360-training-storage]", "Not available");
    setText("[data-customer-360-total-files]", "Loading...");
    setText("[data-customer-360-monthly-uploads]", "Loading...");
    setText("[data-customer-360-plan-limit]", "Not available");
    const status = shell.querySelector("[data-customer-360-usage-status]");
    if (status) status.innerHTML = `<span class="ff-platform-badge">Loading</span>`;
  }

  function renderDataUsageUnavailable(message = "READ ONLY V1: Usage metadata not available.") {
    setText("[data-customer-360-usage-status-line]", message);
    setText("[data-customer-360-storage-used]", "Not available");
    setText("[data-customer-360-media-storage]", "Not available");
    setText("[data-customer-360-training-storage]", "Not available");
    setText("[data-customer-360-total-files]", "Not available");
    setText("[data-customer-360-monthly-uploads]", "Not available");
    setText("[data-customer-360-plan-limit]", "Not available");
    const status = shell.querySelector("[data-customer-360-usage-status]");
    if (status) status.innerHTML = `<span class="ff-platform-badge">Not available</span>`;
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

      const planLimit = displayValue(pickFirst(salon, ["storageLimit", "storageLimitGb", "planStorageLimit", "usageLimitGb"], ""), "Not available");
      setText("[data-customer-360-storage-used]", hasAnySize ? formatBytes(mediaBytes) : "Not available");
      setText("[data-customer-360-media-storage]", hasAnySize ? formatBytes(mediaBytes) : "Not available");
      setText("[data-customer-360-training-storage]", "Not available");
      setText("[data-customer-360-total-files]", totalFiles ? String(totalFiles) : "Not available");
      setText("[data-customer-360-monthly-uploads]", totalFiles ? String(monthlyUploads) : "Not available");
      setText("[data-customer-360-plan-limit]", planLimit);
      const status = shell.querySelector("[data-customer-360-usage-status]");
      if (status) status.innerHTML = `<span class="ff-platform-badge healthy">Normal</span>`;
      const limited = worksSnap.size >= mediaWorkLimit ? ` Limited scan: first ${mediaWorkLimit} works, ${mediaItemsPerWorkLimit} media items each.` : "";
      setText("[data-customer-360-usage-status-line]", `READ ONLY V1: Loaded media usage metadata.${limited}`);
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
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 data usage load failed", error);
      renderDataUsageUnavailable(`READ ONLY V1: Could not load usage metadata (${error?.code || "unknown"}).`);
    }
  }

  function requestActivityMs(request) {
    const last = timestampToDate(request?.lastActivityAt);
    const created = timestampToDate(request?.createdAt);
    return (last || created || new Date(0)).getTime();
  }

  function renderRequestsUnavailable(message = "READ ONLY V1 - Inbox / Requests: Not available.") {
    setText("[data-customer-360-requests-status]", message);
    setText("[data-customer-360-requests-open]", "--");
    setText("[data-customer-360-requests-pending]", "--");
    setText("[data-customer-360-requests-needs-info]", "--");
    setText("[data-customer-360-requests-approved]", "--");
    setText("[data-customer-360-requests-denied]", "--");
    const body = shell.querySelector("[data-customer-360-requests-body]");
    if (body) body.innerHTML = `<tr><td colspan="7">Not available</td></tr>`;
  }

  function renderRequestsLoading() {
    setText("[data-customer-360-requests-status]", "READ ONLY V1 - Inbox / Requests: Loading...");
    const body = shell.querySelector("[data-customer-360-requests-body]");
    if (body) body.innerHTML = `<tr><td colspan="7">Loading...</td></tr>`;
  }

  function renderRequestsReadOnly(requests) {
    const counts = requests.reduce((acc, request) => {
      const status = String(request?.status || "").toLowerCase();
      if (status === "open") acc.open += 1;
      if (status === "pending") acc.pending += 1;
      if (status === "needs_info") acc.needsInfo += 1;
      if (status === "approved" || status === "done") acc.approvedDone += 1;
      if (status === "denied") acc.denied += 1;
      return acc;
    }, { open: 0, pending: 0, needsInfo: 0, approvedDone: 0, denied: 0 });

    setText("[data-customer-360-requests-open]", String(counts.open));
    setText("[data-customer-360-requests-pending]", String(counts.pending));
    setText("[data-customer-360-requests-needs-info]", String(counts.needsInfo));
    setText("[data-customer-360-requests-approved]", String(counts.approvedDone));
    setText("[data-customer-360-requests-denied]", String(counts.denied));

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
      const counts = requests.reduce((acc, request) => {
        const status = String(request?.status || "").toLowerCase();
        if (status === "open") acc.open += 1;
        if (status === "pending") acc.pending += 1;
        if (status === "needs_info") acc.needsInfo += 1;
        if (status === "approved" || status === "done") acc.approvedDone += 1;
        if (status === "denied") acc.denied += 1;
        return acc;
      }, { open: 0, pending: 0, needsInfo: 0, approvedDone: 0, denied: 0 });
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
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 inbox requests load failed", error);
      renderRequestsUnavailable(`READ ONLY V1 - Inbox / Requests: Could not load (${error?.code || "unknown"}).`);
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
    setText("[data-customer-360-locations-count]", displayValue(row.dataset.customerLocationsCount, "Not available"));
    setText("[data-customer-360-staff-count]", displayValue(row.dataset.customerStaffCount, "Not available"));
    setText("[data-customer-360-plan]", displayValue(row.dataset.customerPlan, "Not available"));
    setText("[data-customer-360-plan-copy]", displayValue(row.dataset.customerPlan, "Not available"));
    setText("[data-customer-360-plan-billing]", displayValue(row.dataset.customerPlan, "Not available"));
    setText("[data-customer-360-billing]", displayValue(row.dataset.customerBilling, "Not available"));
    setText("[data-customer-360-payment]", displayValue(row.dataset.customerBilling, "Not available"));
    setText("[data-customer-360-created-at]", "Loading...");
    setText("[data-customer-360-last-activity]", displayValue(row.dataset.customerLastActivity, "Not available"));
    setText("[data-customer-360-initials]", getInitials(name));
    renderDataUsageLoading();
    renderRequestsLoading();
  }

  async function loadCustomer360ReadOnly(salonId, row) {
    // READ ONLY V1: Customer 360 detail load uses getDoc/getDocs only.
    setCustomer360Loading(row);
    if (!canRunReadOnlyReads()) {
      setText("[data-customer-360-status]", "Please log in to Fair Flow first, then reopen Fair Flow Console.");
      renderLocations([]);
      renderDataUsageUnavailable();
      renderRequestsUnavailable();
      return;
    }
    if (!salonId) {
      setText("[data-customer-360-status]", "READ ONLY V1: Missing salonId for this row.");
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
      const lastActivity = displayDate(pickFirst(salon, ["lastActivityAt", "lastActiveAt", "updatedAt", "createdAt"], null));
      const gracePeriod = displayDate(pickFirst(salon, ["gracePeriodEndsAt"], null));

      setText("[data-customer-360-status]", `READ ONLY V1: Loaded salon ${salonId}.`);
      setText("[data-customer-360-name]", businessName);
      setText("[data-customer-360-name-copy]", businessName);
      setText("[data-customer-360-owner]", ownerProfile.name);
      setText("[data-customer-360-email]", ownerProfile.email);
      setText("[data-customer-360-phone]", displayValue(pickFirst(salon, ["phone", "ownerPhone", "contactPhone"], "Not available")));
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
          ownerName: ownerProfile.name,
          ownerEmail: ownerProfile.email,
          locationsCount: locations.length,
          staffCount: staffRows.length,
          plan,
          billingStatus: billing,
          createdAt,
          lastActivity,
          gracePeriod,
        },
        notAvailable: Object.entries({
          ownerName: ownerProfile.name,
          ownerEmail: ownerProfile.email,
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
      await Promise.all([
        loadDataUsageReadOnly(salonId, salon),
        loadInboxRequestsReadOnly(salonId),
      ]);
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 customer detail load failed", error);
      setText("[data-customer-360-status]", `READ ONLY V1: Could not load details (${error?.code || "unknown"}).`);
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
    const health = data.customerHealth || "Healthy";

    setText("[data-customer-360-name]", name);
    setText("[data-customer-360-name-copy]", name);
    setText("[data-customer-360-owner]", owner);
    setText("[data-customer-360-plan]", plan);
    setText("[data-customer-360-plan-copy]", plan);
    setText("[data-customer-360-plan-billing]", plan);
    setText("[data-customer-360-billing]", billing);
    setText("[data-customer-360-payment]", billing);
    setText("[data-customer-360-initials]", getInitials(name));
    setHealthBadge(health);
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
      const nextMode = button.dataset.customersFilter === "all" ? "all" : "active";
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

  function startAuthGate() {
    console.log("[Fair Flow Console] Auth checking");
    setAuthStatus("Checking Fair Flow session...", "checking");
    if (customersStatus) customersStatus.textContent = "Checking Fair Flow session...";
    if (customersTableBody) {
      customersTableBody.innerHTML = `<tr><td colspan="8">Checking Fair Flow session...</td></tr>`;
    }

    const app = getConsoleApp();
    consoleAuth = getAuth(app);
    onAuthStateChanged(consoleAuth, (user) => {
      authReady = true;
      currentAuthUser = user || null;

      if (!user) {
        console.log("[Fair Flow Console] Auth signed out");
        setAuthStatus("Please log in to Fair Flow first, then reopen Fair Flow Console.", "signed-out");
        setReadOnlyBlocked("Please log in to Fair Flow first, then reopen Fair Flow Console.");
        return;
      }

      console.log("[Fair Flow Console] Auth signed in:", user.uid, user.email || "");
      setAuthStatus(`Signed in as: ${user.email || user.uid}`, "signed-in");
      console.log("[Fair Flow Console] Starting read-only Firestore loading");
      loadFirestoreCustomersReadOnly();
    });
  }

  startAuthGate();
})();
