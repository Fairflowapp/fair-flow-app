// V1 Foundation Only: static section navigation for the Fair Flow Console.
// READ ONLY V1: Firestore integration below uses getDoc/getDocs only. No writes, no Stripe, no app module imports.
import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
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
  const customerBack = shell.querySelector("[data-customer-360-back]");
  let previousSectionId = "customers";
  let consoleDb = null;

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

  async function safeSubcollectionCount(db, salonId, subcollectionName) {
    // READ ONLY V1: Count by reading subcollection docs only. No writes or mutations.
    try {
      const snap = await getDocs(collection(db, "salons", salonId, subcollectionName));
      return String(snap.size);
    } catch (_) {
      return "Not available";
    }
  }

  async function readOwnerProfile(db, salon) {
    const ownerDirect = pickFirst(salon, ["ownerName", "owner", "createdByName", "contactName"], "");
    const ownerEmailDirect = pickFirst(salon, ["ownerEmail", "email", "contactEmail"], "");
    if (ownerDirect || ownerEmailDirect) {
      return {
        name: displayValue(ownerDirect, "Not available"),
        email: displayValue(ownerEmailDirect, "Not available"),
      };
    }

    const ownerUid = displayValue(salon.ownerUid || salon.ownerId || "", "");
    if (!ownerUid) return { name: "Not available", email: "Not available" };

    // READ ONLY V1: optional owner profile lookup from existing users/{uid}.
    try {
      const userSnap = await getDoc(doc(db, "users", ownerUid));
      if (!userSnap.exists()) return { name: ownerUid, email: "Not available" };
      const user = userSnap.data() || {};
      return {
        name: displayValue(pickFirst(user, ["name", "displayName", "email"], ownerUid)),
        email: displayValue(pickFirst(user, ["email"], "Not available")),
      };
    } catch (_) {
      return { name: ownerUid, email: "Not available" };
    }
  }

  function mapSalonToCustomerRow(salon, ownerProfile, locationsCount, staffCount) {
    const businessName = displayValue(pickFirst(salon, ["name", "businessName", "salonName", "displayName"], salon.id));
    const plan = displayValue(pickFirst(salon, ["plan", "planName", "subscriptionPlan"], "Not available"));
    const billing = displayValue(pickFirst(salon, ["billingStatus", "accountStatus", "status", "subscriptionStatus"], "Not available"));
    const lastActivity = displayDate(pickFirst(salon, ["lastActivityAt", "lastActiveAt", "updatedAt", "createdAt"], null));
    return {
      id: salon.id,
      businessName,
      owner: ownerProfile.name,
      ownerEmail: ownerProfile.email,
      locationsCount,
      staffCount,
      plan,
      billing,
      health: "Placeholder",
      lastActivity,
    };
  }

  function renderCustomerRows(rows) {
    if (!customersTableBody) return;
    if (!rows.length) {
      customersTableBody.innerHTML = `
        <tr>
          <td colspan="8"><strong>No customers found</strong><small>READ ONLY V1: salons collection returned no documents.</small></td>
        </tr>
      `;
      return;
    }

    customersTableBody.innerHTML = rows.map((row) => `
      <tr class="ff-platform-customer-row" tabindex="0" data-customer-360-open data-customer-id="${escapeHtml(row.id)}" data-customer-name="${escapeHtml(row.businessName)}" data-customer-owner="${escapeHtml(row.owner)}" data-customer-email="${escapeHtml(row.ownerEmail)}" data-customer-plan="${escapeHtml(row.plan)}" data-customer-health="${escapeHtml(row.health)}" data-customer-billing="${escapeHtml(row.billing)}" data-customer-locations-count="${escapeHtml(row.locationsCount)}" data-customer-staff-count="${escapeHtml(row.staffCount)}" data-customer-last-activity="${escapeHtml(row.lastActivity)}">
        <td><strong>${escapeHtml(row.businessName)}</strong><small>Firestore salon: ${escapeHtml(row.id)}</small></td>
        <td>${escapeHtml(row.owner)}</td>
        <td>${escapeHtml(row.locationsCount)}</td>
        <td>${escapeHtml(row.staffCount)}</td>
        <td><span class="ff-platform-badge">${escapeHtml(row.plan)}</span></td>
        <td><span class="ff-platform-badge">${escapeHtml(row.billing)}</span></td>
        <td><span class="ff-platform-health">${escapeHtml(row.health)}</span></td>
        <td>${escapeHtml(row.lastActivity)}</td>
      </tr>
    `).join("");
  }

  async function loadFirestoreCustomersReadOnly() {
    if (!customersTableBody) return;
    try {
      if (customersStatus) {
        customersStatus.textContent = "READ ONLY V1: Loading customers from Firestore collection salons...";
      }
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      consoleDb = getFirestore(app);
      const salonsSnap = await getDocs(query(collection(consoleDb, "salons"), limit(50)));
      const rows = await Promise.all(salonsSnap.docs.map(async (salonDoc) => {
        const salon = { id: salonDoc.id, ...(salonDoc.data() || {}) };
        const [ownerProfile, locationsCount, staffCount] = await Promise.all([
          readOwnerProfile(consoleDb, salon),
          safeSubcollectionCount(consoleDb, salonDoc.id, "locations"),
          safeSubcollectionCount(consoleDb, salonDoc.id, "staff"),
        ]);
        return mapSalonToCustomerRow(salon, ownerProfile, locationsCount, staffCount);
      }));
      renderCustomerRows(rows);
      if (customersStatus) {
        customersStatus.textContent = `READ ONLY V1: Loaded ${rows.length} customers from Firestore collection salons.`;
      }
    } catch (error) {
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
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 data usage load failed", error);
      renderDataUsageUnavailable(`READ ONLY V1: Could not load usage metadata (${error?.code || "unknown"}).`);
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
  }

  async function loadCustomer360ReadOnly(salonId, row) {
    // READ ONLY V1: Customer 360 detail load uses getDoc/getDocs only.
    setCustomer360Loading(row);
    if (!salonId) {
      setText("[data-customer-360-status]", "READ ONLY V1: Missing salonId for this row.");
      return;
    }
    try {
      if (!consoleDb) {
        const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        consoleDb = getFirestore(app);
      }

      const [salonSnap, locationsSnap, staffSnap] = await Promise.all([
        getDoc(doc(consoleDb, "salons", salonId)),
        getDocs(collection(consoleDb, "salons", salonId, "locations")),
        getDocs(collection(consoleDb, "salons", salonId, "staff")),
      ]);

      const salon = salonSnap.exists() ? { id: salonId, ...(salonSnap.data() || {}) } : { id: salonId };
      const ownerProfile = await readOwnerProfile(consoleDb, salon);
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
      await loadDataUsageReadOnly(salonId, salon);
    } catch (error) {
      console.warn("[Fair Flow Console] READ ONLY V1 customer detail load failed", error);
      setText("[data-customer-360-status]", `READ ONLY V1: Could not load details (${error?.code || "unknown"}).`);
      renderLocations([]);
      renderDataUsageUnavailable();
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

  loadFirestoreCustomersReadOnly();
})();
