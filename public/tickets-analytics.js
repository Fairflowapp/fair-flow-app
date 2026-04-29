/**
 * Tickets Analytics — standalone screen for ticket insights.
 *
 * Self-contained module: injects #ticketsAnalyticsScreen DOM and scoped CSS,
 * exposes window.goToTicketsAnalytics(), and reads best-effort ticket data from
 * globals when available. It does not write Firestore or change Tickets logic.
 */

const LOG = "[TicketsAnalytics]";
const SCREEN_ID = "ticketsAnalyticsScreen";
const STYLE_ID = "ffTicketsAnalyticsStyles";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const OTHER_NAV_IDS = [
  "dashboardBtn",
  "queueBtn",
  "ticketsBtn",
  "tasksBtn",
  "chatBtn",
  "inboxBtn",
  "mediaBtn",
  "scheduleBtn",
  "timeClockBtn",
  "inventoryBtn",
  "profileBtn",
];

let _injected = false;

// ---------- Formatting ----------

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
}

function fmtCurrency(value) {
  if (!Number.isFinite(value)) return "—";
  try {
    return value.toLocaleString(undefined, {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  } catch (_) {
    return `$${value.toFixed(2)}`;
  }
}

function fmtHourRange(hour24) {
  if (!Number.isFinite(hour24)) return "—";
  const label = (hour) => {
    const h = ((hour % 24) + 24) % 24;
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };
  const start = label(hour24);
  const end = label(hour24 + 1);
  return `${start.replace(/ AM| PM/, "")}–${end}`;
}

// ---------- DOM ----------

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${SCREEN_ID} {
      display: none;
      position: fixed;
      top: var(--header-h, 60px);
      left: 0; right: 0; bottom: 0;
      background: #f5f6fa;
      z-index: 9850;
      flex-direction: column;
      overflow: auto;
      pointer-events: auto;
    }
    #${SCREEN_ID} .ta-wrap {
      max-width: 1280px;
      margin: 0 auto;
      padding: 24px 28px 48px;
      width: 100%;
    }
    #${SCREEN_ID} .ta-back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: 0;
      color: #6b7280;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0;
      margin-bottom: 14px;
    }
    #${SCREEN_ID} .ta-back:hover { color: #9d68b9; }
    #${SCREEN_ID} .ta-h1 {
      margin: 0 0 4px 0;
      font-size: 22px;
      font-weight: 800;
      color: #111827;
      letter-spacing: -0.01em;
    }
    #${SCREEN_ID} .ta-sub {
      margin: 0 0 22px 0;
      font-size: 13px;
      color: #6b7280;
    }
    #${SCREEN_ID} .ta-section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #6b7280;
      margin: 22px 2px 10px;
    }
    #${SCREEN_ID} .ta-summary {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }
    #${SCREEN_ID} .ta-card,
    #${SCREEN_ID} .ta-panel {
      background: #fff;
      border: 1px solid #e5e7eb;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    #${SCREEN_ID} .ta-card {
      border-radius: 14px;
      padding: 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    #${SCREEN_ID} .ta-card-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
    }
    #${SCREEN_ID} .ta-card-value {
      font-size: 24px;
      font-weight: 800;
      color: #111827;
      line-height: 1.1;
    }
    #${SCREEN_ID} .ta-card-foot {
      font-size: 12px;
      color: #6b7280;
    }
    #${SCREEN_ID} .ta-panel {
      border-radius: 16px;
      padding: 18px 20px;
    }
    #${SCREEN_ID} .ta-empty {
      border: 1px dashed #d1d5db;
      background: #fff;
      border-radius: 14px;
      padding: 24px;
      color: #6b7280;
      font-size: 14px;
      text-align: center;
    }
    #${SCREEN_ID} .ta-table-wrap { overflow-x: auto; }
    #${SCREEN_ID} .ta-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    #${SCREEN_ID} .ta-table th,
    #${SCREEN_ID} .ta-table td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
      white-space: nowrap;
    }
    #${SCREEN_ID} .ta-table th {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #6b7280;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
    }
    #${SCREEN_ID} .ta-table tr:last-child td { border-bottom: 0; }
    #${SCREEN_ID} .ta-table .num { text-align: right; font-variant-numeric: tabular-nums; }
    #${SCREEN_ID} .ta-day {
      border: 1px solid #eef0f3;
      border-radius: 12px;
      background: #fff;
      margin-bottom: 10px;
      overflow: hidden;
    }
    #${SCREEN_ID} .ta-day:last-child { margin-bottom: 0; }
    #${SCREEN_ID} .ta-day-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 12px 14px;
      background: #f9fafb;
      color: #111827;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
    }
    #${SCREEN_ID} .ta-day-title::-webkit-details-marker { display: none; }
    #${SCREEN_ID} .ta-day-meta {
      color: #6b7280;
      font-weight: 600;
    }
    #${SCREEN_ID} .ta-day-body {
      padding: 12px 14px 14px;
    }
    #${SCREEN_ID} .ta-hour-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
    }
    #${SCREEN_ID} .ta-hour-card {
      background: #f9fafb;
      border: 1px solid #eef0f3;
      border-radius: 10px;
      padding: 10px 12px;
    }
    #${SCREEN_ID} .ta-hour-card.is-peak {
      background: linear-gradient(135deg, rgba(157, 104, 185, 0.10), rgba(255, 149, 128, 0.10));
      border-color: #d8b6e8;
    }
    #${SCREEN_ID} .ta-hour-title {
      font-size: 13px;
      font-weight: 800;
      color: #111827;
      margin-bottom: 8px;
    }
    #${SCREEN_ID} .ta-hour-row {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 12px;
      line-height: 1.6;
      color: #4b5563;
    }
    #${SCREEN_ID} .ta-hour-row strong {
      color: #111827;
      font-variant-numeric: tabular-nums;
    }
    #${SCREEN_ID} .ta-closed {
      padding: 10px 12px;
      border: 1px dashed #e5e7eb;
      border-radius: 10px;
      background: #f9fafb;
      color: #6b7280;
      font-size: 13px;
    }
    #${SCREEN_ID} .ta-insights {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    #${SCREEN_ID} .ta-insight {
      padding: 10px 12px;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      color: #1e40af;
      font-size: 13px;
      line-height: 1.4;
    }
    @media (max-width: 900px) {
      #${SCREEN_ID} .ta-wrap { padding: 16px 14px 32px; }
      #${SCREEN_ID} .ta-card-value { font-size: 21px; }
    }
  `;
  document.head.appendChild(style);
}

function buildScreen() {
  if (document.getElementById(SCREEN_ID)) return document.getElementById(SCREEN_ID);
  const root = document.createElement("div");
  root.id = SCREEN_ID;
  root.innerHTML = `
    <div class="ta-wrap">
      <button type="button" class="ta-back" id="ffTaBack" aria-label="Back to dashboard">← Back to dashboard</button>
      <h1 class="ta-h1">Tickets Analytics</h1>
      <p class="ta-sub">Understand ticket volume, revenue, and employee performance</p>

      <div class="ta-section-title">Summary</div>
      <div id="ffTaSummary" class="ta-summary"></div>

      <div class="ta-section-title">Tickets by Day</div>
      <div id="ffTaByDay" class="ta-panel"></div>

      <div class="ta-section-title">Tickets by Hour</div>
      <div id="ffTaByHour" class="ta-panel"></div>

      <div class="ta-section-title">Top Selling Items</div>
      <div id="ffTaItems" class="ta-panel"></div>

      <div class="ta-section-title">Insights</div>
      <div id="ffTaInsights" class="ta-panel"></div>
    </div>
  `;
  document.body.appendChild(root);
  const back = root.querySelector("#ffTaBack");
  if (back) {
    back.addEventListener("click", () => {
      hideSelf();
      try {
        if (typeof window.goToDashboard === "function") window.goToDashboard();
      } catch (err) {
        console.warn(LOG, "back nav failed", err);
      }
    });
  }
  return root;
}

// ---------- Data helpers ----------

function parseTimestamp(value) {
  try {
    if (value == null) return null;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 100000000000 ? value : value * 1000;
    }
    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value === "string") {
      const ms = Date.parse(value);
      return Number.isNaN(ms) ? null : ms;
    }
    if (typeof value.toMillis === "function") {
      const ms = value.toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value.toDate === "function") {
      const d = value.toDate();
      const ms = d && typeof d.getTime === "function" ? d.getTime() : NaN;
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value.seconds === "number") {
      return value.seconds * 1000 + Math.floor(Number(value.nanoseconds || 0) / 1000000);
    }
  } catch (err) {
    console.warn(LOG, "timestamp parse failed", err);
  }
  return null;
}

function parseAmount(ticket) {
  const raw = ticket && (ticket.totalAmount ?? ticket.total ?? ticket.amount);
  if (raw == null || raw === "") return null;
  const value = typeof raw === "string" ? Number(raw.replace(/[$,]/g, "")) : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseMoneyValue(value) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "string" ? Number(value.replace(/[$,]/g, "")) : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanString(value) {
  return value == null ? "" : String(value).trim();
}

function getActiveLocationId() {
  try {
    if (typeof window.ffGetActiveLocationId === "function") {
      const id = cleanString(window.ffGetActiveLocationId());
      if (id) return id;
    }
  } catch (err) {
    console.warn(LOG, "active location helper failed", err);
  }
  try {
    const id = cleanString(window.__ff_active_location_id || window.activeLocationId || window.currentLocationId);
    if (id) return id;
  } catch (_) {}
  return "";
}

function readStaffNames() {
  const byId = new Map();
  try {
    const store = typeof window.ffGetStaffStore === "function" ? window.ffGetStaffStore() : null;
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    staff.forEach((s) => {
      const id = cleanString(s?.id || s?.staffId || s?.uid);
      const name = cleanString(s?.name || s?.staffName || s?.displayName || s?.email);
      if (id && name) byId.set(id, name);
    });
  } catch (err) {
    console.warn(LOG, "staff helper failed", err);
  }
  try {
    const store = JSON.parse(localStorage.getItem("ff_staff_v1") || "{}");
    const staff = Array.isArray(store?.staff) ? store.staff : [];
    staff.forEach((s) => {
      const id = cleanString(s?.id || s?.staffId || s?.uid);
      const name = cleanString(s?.name || s?.staffName || s?.displayName || s?.email);
      if (id && name && !byId.has(id)) byId.set(id, name);
    });
  } catch (_) {}
  return byId;
}

async function readCandidateArrays() {
  const candidates = [];
  const addCandidate = (name, value) => {
    try {
      if (Array.isArray(value)) candidates.push({ name, list: value });
    } catch (_) {}
  };

  addCandidate("window.currentTickets", window.currentTickets);
  addCandidate("window.allTickets", window.allTickets);
  addCandidate("window.ticketsCache", window.ticketsCache);
  addCandidate("window.ticketSummaries", window.ticketSummaries);
  addCandidate("window.ticketSummariesCache", window.ticketSummariesCache);

  [
    "getCurrentTickets",
    "getAllTickets",
    "getTicketsCache",
    "getTicketSummaries",
    "ffGetCurrentTickets",
    "ffGetTicketSummaries",
  ].forEach((fnName) => {
    try {
      if (typeof window[fnName] === "function") {
        const value = window[fnName]();
        addCandidate(`window.${fnName}()`, value);
      }
    } catch (err) {
      console.warn(LOG, "data helper failed", fnName, err);
    }
  });

  let selected = candidates.find((c) => c.list.length) || candidates[0] || null;
  if (!selected || !selected.list.length) {
    try {
      if (typeof window.ffLoadTicketsForAnalytics === "function") {
        const loaded = await window.ffLoadTicketsForAnalytics();
        if (Array.isArray(loaded)) {
          candidates.push({ name: "window.ffLoadTicketsForAnalytics()", list: loaded });
          selected = { name: "window.ffLoadTicketsForAnalytics()", list: loaded };
        }
      }
    } catch (err) {
      console.warn(LOG, "analytics ticket loader failed", err);
    }
  }
  console.log(LOG, "data source detected", selected ? selected.name : "none");
  return selected || { name: "none", list: [] };
}

function readTicketLineItems(raw) {
  const candidates = [
    raw?.performedLines,
    raw?.lineItems,
    raw?.items,
    raw?.services,
    raw?.ticketItems,
  ];
  const lines = candidates.find((value) => Array.isArray(value)) || [];
  return lines.map((line) => {
    if (!line || typeof line !== "object") return null;
    const itemId = cleanString(line.serviceId ?? line.itemId ?? line.id ?? line.catalogId);
    const name = cleanString(
      line.serviceName ??
      line.itemName ??
      line.name ??
      line.title ??
      line.label,
    );
    const quantityRaw = Number(line.quantity ?? line.qty ?? line.count ?? 1);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? quantityRaw : 1;
    const unitPrice =
      parseMoneyValue(line.ticketPrice) ??
      parseMoneyValue(line.price) ??
      parseMoneyValue(line.amount) ??
      parseMoneyValue(line.catalogPrice) ??
      0;
    const lineTotal =
      parseMoneyValue(line.totalAmount) ??
      parseMoneyValue(line.total) ??
      (unitPrice * quantity);
    const displayName = name || itemId || "Unnamed item";
    if (!displayName || displayName === "Unnamed item") return null;
    return {
      itemId,
      name: displayName,
      quantity,
      totalAmount: Number.isFinite(lineTotal) ? lineTotal : 0,
    };
  }).filter(Boolean);
}

function parseTicket(raw, staffNames, missingFields) {
  if (!raw || typeof raw !== "object") return null;
  const timestamp =
    parseTimestamp(raw.closedAt ?? raw.createdAt ?? raw.timestamp) ??
    parseTimestamp(raw.closedAtMs ?? raw.createdAtMs ?? raw.timestampMs);
  const amount = parseAmount(raw);
  const employeeId = cleanString(
    raw.staffId ??
    raw.employeeId ??
    raw.technicianId ??
    raw.techId ??
    raw.technicianStaffId ??
    raw.finalizedByUid,
  );
  const employeeName = cleanString(
    raw.employeeName ??
    raw.staffName ??
    raw.technicianName ??
    raw.employee ??
    raw.staff,
  ) || (employeeId && staffNames.get(employeeId)) || "Unassigned";
  const locationId = cleanString(raw.locationId);
  const items = readTicketLineItems(raw);

  if (!Number.isFinite(timestamp)) missingFields.timestamp += 1;
  if (!Number.isFinite(amount)) missingFields.amount += 1;
  if (!employeeId && employeeName === "Unassigned") missingFields.employee += 1;
  if (!locationId) missingFields.location += 1;
  if (!items.length) missingFields.items += 1;

  if (!Number.isFinite(timestamp) && !Number.isFinite(amount)) return null;
  return {
    id: cleanString(raw.id || raw.ticketId || raw.summaryId),
    timestamp,
    amount: Number.isFinite(amount) ? amount : 0,
    employeeId,
    employeeName,
    locationId,
    items,
  };
}

function _taTimeToMinutes(value) {
  const match = cleanString(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function readSettingsBusinessHours() {
  try {
    if (window.settings && typeof window.settings.businessHours === "object") {
      return { source: "window.settings.businessHours", value: window.settings.businessHours };
    }
  } catch (_) {}
  try {
    const stored = JSON.parse(localStorage.getItem("ffv24_settings") || "{}");
    if (stored && typeof stored.businessHours === "object") {
      return { source: "localStorage.ffv24_settings.businessHours", value: stored.businessHours };
    }
  } catch (_) {}
  return null;
}

function resolveBusinessHoursForWeek() {
  let source = "fallback";
  let rawHours = null;
  const found = readSettingsBusinessHours();
  if (found?.value) {
    source = found.source;
    rawHours = found.value;
  }
  if (rawHours && typeof window.ffScheduleHelpers?.normalizeBusinessHours === "function") {
    try {
      rawHours = window.ffScheduleHelpers.normalizeBusinessHours(rawHours);
    } catch (err) {
      console.warn(LOG, "business hours normalize failed", err);
    }
  }
  if (!rawHours || typeof rawHours !== "object") {
    rawHours = {};
    DAY_KEYS.forEach((day) => {
      rawHours[day] = { isOpen: true, openTime: "09:00", closeTime: "21:00" };
    });
  }

  const byDay = DAY_KEYS.map((dayKey, dayIdx) => {
    const entry = rawHours[dayKey] && typeof rawHours[dayKey] === "object" ? rawHours[dayKey] : null;
    const openMin = entry?.isOpen === true ? _taTimeToMinutes(entry.openTime) : null;
    const closeMin = entry?.isOpen === true ? _taTimeToMinutes(entry.closeTime) : null;
    const isOpen = Number.isFinite(openMin) && Number.isFinite(closeMin) && closeMin > openMin;
    const hours = [];
    if (isOpen) {
      for (let h = Math.floor(openMin / 60); h < Math.ceil(closeMin / 60) && h <= 23; h += 1) {
        hours.push(h);
      }
    }
    return {
      dayIdx,
      dayName: DAY_NAMES[dayIdx],
      isOpen,
      openTime: isOpen ? entry.openTime : null,
      closeTime: isOpen ? entry.closeTime : null,
      hours,
    };
  });

  console.log(LOG, "business hours resolved", { source });
  return { source, byDay };
}

function makeBucket() {
  return { tickets: 0, totalAmount: 0, highestTicket: 0 };
}

function addToBucket(bucket, amount) {
  bucket.tickets += 1;
  bucket.totalAmount += amount;
  bucket.highestTicket = Math.max(bucket.highestTicket, amount);
}

function avgAmount(bucket) {
  return bucket && bucket.tickets ? bucket.totalAmount / bucket.tickets : null;
}

async function computeTicketsAnalytics() {
  const source = await readCandidateArrays();
  const activeLocationId = getActiveLocationId();
  const staffNames = readStaffNames();
  const missingFields = { timestamp: 0, amount: 0, employee: 0, location: 0, items: 0 };
  const parsed = [];

  source.list.forEach((raw) => {
    try {
      const ticket = parseTicket(raw, staffNames, missingFields);
      if (!ticket) return;
      if (activeLocationId && ticket.locationId && ticket.locationId !== activeLocationId) return;
      parsed.push(ticket);
    } catch (err) {
      console.warn(LOG, "ticket parse error", err, raw);
    }
  });

  const businessHours = resolveBusinessHoursForWeek();
  const byDayBuckets = DAY_NAMES.map((dayName, dayIdx) => ({ dayIdx, dayName, ...makeBucket() }));
  const dayHourMap = new Map();
  const employeeMap = new Map();
  const itemMap = new Map();
  const hourCounts = new Map();
  const result = {
    sourceName: source.name,
    activeLocationId,
    rawCount: source.list.length,
    parsedCount: parsed.length,
    totalTickets: 0,
    totalAmount: 0,
    averageTicket: null,
    highestTicket: null,
    busiestDay: null,
    peakHour: null,
    byDay: byDayBuckets,
    byDayHour: [],
    employees: [],
    items: [],
    bestSellingItem: null,
    businessHours,
    missingFields,
    hasData: parsed.length > 0,
  };

  parsed.forEach((ticket) => {
    const amount = Number.isFinite(ticket.amount) ? ticket.amount : 0;
    result.totalTickets += 1;
    result.totalAmount += amount;
    result.highestTicket = Math.max(result.highestTicket || 0, amount);

    if (Number.isFinite(ticket.timestamp)) {
      const date = new Date(ticket.timestamp);
      const dayIdx = date.getDay();
      const hour = date.getHours();
      addToBucket(byDayBuckets[dayIdx], amount);
      const key = `${dayIdx}|${hour}`;
      if (!dayHourMap.has(key)) dayHourMap.set(key, { dayIdx, hour, ...makeBucket() });
      addToBucket(dayHourMap.get(key), amount);
      hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
    }

    const employeeKey = ticket.employeeId || `name:${ticket.employeeName || "Unassigned"}`;
    if (!employeeMap.has(employeeKey)) {
      employeeMap.set(employeeKey, {
        employeeId: ticket.employeeId,
        employeeName: ticket.employeeName || "Unassigned",
        tickets: 0,
        totalAmount: 0,
      });
    }
    const employee = employeeMap.get(employeeKey);
    employee.tickets += 1;
    employee.totalAmount += amount;

    ticket.items.forEach((item) => {
      const itemKey = item.itemId || item.name.toLowerCase();
      if (!itemMap.has(itemKey)) {
        itemMap.set(itemKey, {
          itemId: item.itemId,
          name: item.name,
          sold: 0,
          totalAmount: 0,
        });
      }
      const row = itemMap.get(itemKey);
      row.sold += item.quantity;
      row.totalAmount += item.totalAmount;
    });
  });

  result.averageTicket = result.totalTickets ? result.totalAmount / result.totalTickets : null;
  result.busiestDay = byDayBuckets.reduce((best, row) => (row.tickets > (best?.tickets || 0) ? row : best), null);
  const peakHourEntry = Array.from(hourCounts.entries()).sort((a, b) => b[1] - a[1])[0] || null;
  result.peakHour = peakHourEntry ? { hour: peakHourEntry[0], tickets: peakHourEntry[1] } : null;
  result.byDay.forEach((row) => {
    row.averageTicket = avgAmount(row);
  });
  result.byDayHour = businessHours.byDay.map((day) => {
    const hours = day.isOpen
      ? day.hours.map((hour) => {
          const bucket = dayHourMap.get(`${day.dayIdx}|${hour}`) || { dayIdx: day.dayIdx, hour, ...makeBucket() };
          return { ...bucket, averageTicket: avgAmount(bucket) };
        })
      : [];
    const peak = hours.reduce((best, row) => (row.tickets > (best?.tickets || 0) ? row : best), null);
    return { ...day, peakHour: peak && peak.tickets ? peak.hour : null, hours };
  });
  result.employees = Array.from(employeeMap.values())
    .map((row) => ({ ...row, averageTicket: row.tickets ? row.totalAmount / row.tickets : null }))
    .sort((a, b) => b.totalAmount - a.totalAmount || b.tickets - a.tickets || a.employeeName.localeCompare(b.employeeName));
  result.items = Array.from(itemMap.values())
    .map((row) => ({ ...row, averagePrice: row.sold ? row.totalAmount / row.sold : null }))
    .sort((a, b) => b.sold - a.sold || b.totalAmount - a.totalAmount || a.name.localeCompare(b.name));
  result.bestSellingItem = result.items[0] || null;

  console.log(LOG, "tickets parsed count", { raw: result.rawCount, parsed: result.parsedCount });
  console.log(LOG, "missing fields", missingFields);
  console.log(LOG, "metrics calculated", {
    tickets: result.totalTickets,
    totalAmount: result.totalAmount,
    itemRows: result.items.length,
    activeLocationId: activeLocationId || "(all/general)",
  });

  return result;
}

// ---------- Render ----------

function renderEmpty(message = "No ticket data available yet") {
  const summary = document.getElementById("ffTaSummary");
  const byDay = document.getElementById("ffTaByDay");
  const byHour = document.getElementById("ffTaByHour");
  const items = document.getElementById("ffTaItems");
  const insights = document.getElementById("ffTaInsights");
  if (summary) {
    summary.innerHTML = ["Total Tickets", "Total Amount", "Average Ticket", "Busiest Day", "Peak Hour", "Best Selling Item"].map((label) => `
      <div class="ta-card">
        <div class="ta-card-label">${escapeHtml(label)}</div>
        <div class="ta-card-value">—</div>
        <div class="ta-card-foot">Not enough data yet</div>
      </div>
    `).join("");
  }
  const empty = `<div class="ta-empty">${escapeHtml(message)}</div>`;
  if (byDay) byDay.innerHTML = empty;
  if (byHour) byHour.innerHTML = empty;
  if (items) items.innerHTML = empty;
  if (insights) insights.innerHTML = '<ul class="ta-insights"><li class="ta-insight">No ticket data available yet.</li></ul>';
}

function renderSummary(metrics) {
  const root = document.getElementById("ffTaSummary");
  if (!root) return;
  const cards = [
    { label: "Total Tickets", value: fmtNumber(metrics.totalTickets), foot: metrics.activeLocationId ? "Active location" : "All visible tickets" },
    { label: "Total Amount", value: fmtCurrency(metrics.totalAmount), foot: "All parsed tickets" },
    { label: "Average Ticket", value: fmtCurrency(metrics.averageTicket), foot: "Revenue per ticket" },
    { label: "Busiest Day", value: metrics.busiestDay?.tickets ? metrics.busiestDay.dayName : "—", foot: metrics.busiestDay?.tickets ? `${fmtNumber(metrics.busiestDay.tickets)} tickets` : "Not enough data yet" },
    { label: "Peak Hour", value: metrics.peakHour ? fmtHourRange(metrics.peakHour.hour) : "—", foot: metrics.peakHour ? `${fmtNumber(metrics.peakHour.tickets)} tickets` : "Not enough data yet" },
    { label: "Best Selling Item", value: metrics.bestSellingItem?.name || "—", foot: metrics.bestSellingItem ? `${fmtNumber(metrics.bestSellingItem.sold)} sold` : "No item data yet" },
  ];
  root.innerHTML = cards.map((card) => `
    <div class="ta-card">
      <div class="ta-card-label">${escapeHtml(card.label)}</div>
      <div class="ta-card-value">${escapeHtml(card.value)}</div>
      <div class="ta-card-foot">${escapeHtml(card.foot)}</div>
    </div>
  `).join("");
}

function renderByDay(metrics) {
  const root = document.getElementById("ffTaByDay");
  if (!root) return;
  root.innerHTML = `
    <div class="ta-table-wrap">
      <table class="ta-table">
        <thead>
          <tr>
            <th>Day</th>
            <th class="num">Tickets</th>
            <th class="num">Total Amount</th>
            <th class="num">Average Ticket</th>
            <th class="num">Highest Ticket</th>
          </tr>
        </thead>
        <tbody>
          ${metrics.byDay.map((row) => `
            <tr>
              <td>${escapeHtml(row.dayName)}</td>
              <td class="num">${escapeHtml(fmtNumber(row.tickets))}</td>
              <td class="num">${escapeHtml(row.tickets ? fmtCurrency(row.totalAmount) : "$0.00")}</td>
              <td class="num">${escapeHtml(row.tickets ? fmtCurrency(row.averageTicket) : "—")}</td>
              <td class="num">${escapeHtml(row.tickets ? fmtCurrency(row.highestTicket) : "—")}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderByHour(metrics) {
  const root = document.getElementById("ffTaByHour");
  if (!root) return;
  root.innerHTML = metrics.byDayHour.map((day) => {
    const dayTickets = day.hours.reduce((sum, hour) => sum + hour.tickets, 0);
    const dayAmount = day.hours.reduce((sum, hour) => sum + hour.totalAmount, 0);
    if (!day.isOpen) {
      return `
        <details class="ta-day">
          <summary class="ta-day-title">
            <span>${escapeHtml(day.dayName)}</span>
            <span class="ta-day-meta">Closed</span>
          </summary>
          <div class="ta-day-body"><div class="ta-closed">Business hours are closed for this day.</div></div>
        </details>
      `;
    }
    return `
      <details class="ta-day">
        <summary class="ta-day-title">
          <span>${escapeHtml(day.dayName)}</span>
          <span class="ta-day-meta">${escapeHtml(fmtNumber(dayTickets))} tickets · ${escapeHtml(fmtCurrency(dayAmount))}</span>
        </summary>
        <div class="ta-day-body">
          <div class="ta-hour-grid">
            ${day.hours.map((hour) => `
              <div class="ta-hour-card ${day.peakHour === hour.hour ? "is-peak" : ""}">
                <div class="ta-hour-title">${escapeHtml(fmtHourRange(hour.hour))}</div>
                <div class="ta-hour-row"><span>Tickets</span><strong>${escapeHtml(fmtNumber(hour.tickets))}</strong></div>
                <div class="ta-hour-row"><span>Total</span><strong>${escapeHtml(hour.tickets ? fmtCurrency(hour.totalAmount) : "$0.00")}</strong></div>
                <div class="ta-hour-row"><span>Average</span><strong>${escapeHtml(hour.tickets ? fmtCurrency(hour.averageTicket) : "—")}</strong></div>
              </div>
            `).join("")}
          </div>
        </div>
      </details>
    `;
  }).join("");
}

function renderItems(metrics) {
  const root = document.getElementById("ffTaItems");
  if (!root) return;
  const rows = (metrics.items || []).slice(0, 10);
  if (!rows.length) {
    root.innerHTML = '<div class="ta-empty">No item-level data yet</div>';
    return;
  }
  root.innerHTML = `
    <div class="ta-table-wrap">
      <table class="ta-table">
        <thead>
          <tr>
            <th>Item</th>
            <th class="num">Sold</th>
            <th class="num">Total Amount</th>
            <th class="num">Average Price</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td class="num">${escapeHtml(fmtNumber(row.sold))}</td>
              <td class="num">${escapeHtml(fmtCurrency(row.totalAmount))}</td>
              <td class="num">${escapeHtml(fmtCurrency(row.averagePrice))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function buildInsights(metrics) {
  if (!metrics.hasData) return [];
  const out = [];
  if (metrics.busiestDay?.tickets) {
    out.push(`Highest revenue day: ${metrics.busiestDay.dayName}`);
  }
  if (metrics.peakHour) {
    out.push(`Peak ticket activity around ${fmtHourRange(metrics.peakHour.hour)}`);
  }
  if (Number.isFinite(metrics.averageTicket)) {
    out.push(`Average ticket is ${fmtCurrency(metrics.averageTicket)}`);
  }
  const topEmployee = metrics.employees[0];
  if (topEmployee && topEmployee.totalAmount > 0) {
    out.push(`${topEmployee.employeeName || "Unassigned"} has the highest ticket total`);
  }
  if (out.length < 4 && metrics.bestSellingItem) {
    out.push(`Best selling item: ${metrics.bestSellingItem.name}`);
  }
  return out.slice(0, 4);
}

function renderInsights(metrics) {
  const root = document.getElementById("ffTaInsights");
  if (!root) return;
  const items = buildInsights(metrics);
  if (!items.length) {
    root.innerHTML = '<ul class="ta-insights"><li class="ta-insight">Not enough data yet.</li></ul>';
    return;
  }
  root.innerHTML = `
    <ul class="ta-insights">
      ${items.map((text) => `<li class="ta-insight">${escapeHtml(text)}</li>`).join("")}
    </ul>
  `;
}

async function refresh() {
  const screen = document.getElementById(SCREEN_ID);
  if (!screen || screen.style.display === "none") return;
  try {
    const metrics = await computeTicketsAnalytics();
    if (!metrics.hasData) {
      renderEmpty("No ticket data available yet");
      return;
    }
    renderSummary(metrics);
    renderByDay(metrics);
    renderByHour(metrics);
    renderItems(metrics);
    renderInsights(metrics);
  } catch (err) {
    console.error(LOG, "refresh failed", err);
    renderEmpty("No ticket data available yet");
  }
}

// ---------- Navigation ----------

function hideOtherScreens() {
  const ids = [
    "tasksScreen",
    "inboxScreen",
    "chatScreen",
    "mediaScreen",
    "trainingScreen",
    "scheduleScreen",
    "timeClockScreen",
    "ticketsScreen",
    "inventoryScreen",
    "manageQueueScreen",
    "userProfileScreen",
    "myProfileScreen",
    "pointsAppScreen",
    "owner-view",
    "dashboardScreen",
    "queueAnalyticsScreen",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  ["#joinBar", ".joinBar", ".wrap", "#queueControls"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) el.style.display = "none";
  });
}

function hideSelf() {
  const screen = document.getElementById(SCREEN_ID);
  if (screen) screen.style.display = "none";
}

function bindAutoHideOnOtherNav() {
  OTHER_NAV_IDS.forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn || btn._ffTaHideHandler) return;
    btn._ffTaHideHandler = () => { hideSelf(); };
    btn.addEventListener("click", btn._ffTaHideHandler, { capture: true });
  });
}

export function goToTicketsAnalytics() {
  console.log(LOG, "screen opened");
  try {
    if (typeof window.ffCloseGlobalBlockingOverlays === "function") window.ffCloseGlobalBlockingOverlays();
  } catch (_) {}
  try {
    if (typeof window.closeStaffMembersModal === "function") window.closeStaffMembersModal();
  } catch (_) {}
  ensureInjected();
  hideOtherScreens();

  const headerEl = document.querySelector(".header");
  if (headerEl) {
    document.documentElement.style.setProperty("--header-h", `${headerEl.offsetHeight}px`);
  }

  const screen = document.getElementById(SCREEN_ID);
  if (screen) {
    screen.style.display = "flex";
    screen.style.setProperty("pointer-events", "auto", "important");
  }
  document.querySelectorAll(".btn-pill").forEach((b) => b.classList.remove("active"));
  refresh();
}

function ensureInjected() {
  if (_injected) return;
  injectStyles();
  buildScreen();
  bindAutoHideOnOtherNav();
  _injected = true;
  console.log(LOG, "screen injected");
}

function init() {
  window.goToTicketsAnalytics = goToTicketsAnalytics;
  ensureInjected();
  if (!window.__ffTaLocationListenerBound) {
    window.__ffTaLocationListenerBound = true;
    document.addEventListener("ff-active-location-changed", () => {
      console.log(LOG, "active location changed → refresh");
      refresh();
    });
    document.addEventListener("ff-tickets-data-changed", () => {
      console.log(LOG, "tickets data changed → refresh");
      refresh();
    });
  }
  console.log(LOG, "init complete");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
  init();
}
