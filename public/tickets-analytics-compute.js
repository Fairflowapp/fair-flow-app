/**
 * Tickets Analytics — pure computation.
 *
 * Pure analytics logic for the Tickets screen: number/currency/hour formatters,
 * ticket parsing + normalization, business-hours resolution and the core
 * metrics + insights builders. Extracted verbatim from tickets-analytics.js
 * (computeTicketsAnalytics had its dead `= getSelectedRange()` default dropped
 * — its callers always pass an explicit range). No DOM. Reads come from data.
 */

import {
  LOG,
  cleanString,
  getLocationScope,
  readStaffNames,
  readCandidateArrays,
  readSettingsBusinessHours,
} from "./tickets-analytics-data.js?v=20260816_dash_range";

export const LOC_LOG = "[TicketsAnalytics LocationScope]";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function fmtNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : "—";
}

export function fmtCurrency(value) {
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

export function fmtHourRange(hour24) {
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

function logLocationScope(source, scope, before, after, skippedNoLocation) {
  console.log(LOC_LOG, source, {
    activeLocationId: scope?.id || "",
    recordsBeforeFilter: before,
    recordsAfterFilter: after,
    skippedRecordsWithoutLocationId: skippedNoLocation,
  });
}

function viewerIsMultiBranch() {
  try {
    return typeof window.ffUserHasMultipleLocations === "function" && !!window.ffUserHasMultipleLocations();
  } catch (_) {
    return false;
  }
}

function ticketMatchesAnalyticsLocation(ticket, scope) {
  if (!scope?.hasLocation) return false;
  if (ticket.locationId) return ticket.locationId === scope.id;
  return !viewerIsMultiBranch();
}

function isCompletedTicketStatus(status) {
  const s = String(status || "").toUpperCase();
  return !s || s === "CLOSED" || s === "ARCHIVED";
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
    parseTimestamp(raw.createdAt ?? raw.closedAt ?? raw.timestamp) ??
    parseTimestamp(raw.createdAtMs ?? raw.closedAtMs ?? raw.timestampMs);
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

export async function computeTicketsAnalytics(range) {
  const source = await readCandidateArrays(range);
  const scope = getLocationScope();
  const activeLocationId = scope.id;
  const staffNames = readStaffNames();
  const missingFields = { timestamp: 0, amount: 0, employee: 0, location: 0, items: 0 };
  const parsed = [];
  let skippedNoLocation = 0;

  source.list.forEach((raw) => {
    try {
      if (raw && raw.deleted === true) return;
      if (!isCompletedTicketStatus(raw?.status)) return;
      const ticket = parseTicket(raw, staffNames, missingFields);
      if (!ticket) return;
      if (!ticketMatchesAnalyticsLocation(ticket, scope)) {
        if (!ticket.locationId) skippedNoLocation += 1;
        return;
      }
      if (!ticket.locationId) skippedNoLocation += 1;
      if (!Number.isFinite(ticket.timestamp) || ticket.timestamp < range.fromMs || ticket.timestamp > range.toMs) return;
      parsed.push(ticket);
    } catch (err) {
      console.warn(LOG, "ticket parse error", err, raw);
    }
  });
  logLocationScope("tickets", scope, source.list.length, parsed.length, skippedNoLocation);

  const businessHours = resolveBusinessHoursForWeek();
  const byDayBuckets = DAY_NAMES.map((dayName, dayIdx) => ({ dayIdx, dayName, ...makeBucket() }));
  const dayHourMap = new Map();
  const employeeMap = new Map();
  const itemMap = new Map();
  const hourCounts = new Map();
  const result = {
    sourceName: source.name,
    activeLocationId,
    locationLabel: scope.label,
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
    rangeLabel: range.label,
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
    const activityHours = Array.from(dayHourMap.values())
      .filter((bucket) => bucket.dayIdx === day.dayIdx && bucket.tickets > 0)
      .map((bucket) => bucket.hour);
    const displayHours = Array.from(new Set([...(day.hours || []), ...activityHours])).sort((a, b) => a - b);
    const hours = displayHours
      .map((hour) => {
          const bucket = dayHourMap.get(`${day.dayIdx}|${hour}`) || { dayIdx: day.dayIdx, hour, ...makeBucket() };
          return { ...bucket, averageTicket: avgAmount(bucket) };
        });
    const peak = hours.reduce((best, row) => (row.tickets > (best?.tickets || 0) ? row : best), null);
    return {
      ...day,
      hasActivityOutsideHours: activityHours.some((hour) => !(day.hours || []).includes(hour)),
      peakHour: peak && peak.tickets ? peak.hour : null,
      hours,
    };
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
    range: range.label,
    activeLocationId: activeLocationId || "(all/general)",
  });

  return result;
}

export function buildInsights(metrics) {
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
