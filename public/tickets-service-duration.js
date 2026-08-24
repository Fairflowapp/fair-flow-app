/**
 * Service duration UI conversion. Firestore still stores durationMinutes only.
 */
const MAX_MINUTES = 1440;
const HOUR_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const MINUTE_CHOICES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function asInt(value) {
  if (value == null || value === "") return NaN;
  const n = Number(value);
  return Number.isInteger(n) ? n : NaN;
}

export function splitServiceDurationMinutes(totalMinutes) {
  const n = asInt(totalMinutes);
  if (!Number.isInteger(n) || n < 0) return { hours: 0, minutes: 0 };
  return {
    hours: Math.floor(n / 60),
    minutes: n % 60
  };
}

export function joinServiceDurationMinutes(hours, minutes) {
  const h = asInt(hours);
  const m = asInt(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59) return null;
  const total = (h * 60) + m;
  if (total < 1 || total > MAX_MINUTES) return null;
  return total;
}

export function formatServiceDurationLabel(totalMinutes) {
  const n = asInt(totalMinutes);
  if (!Number.isInteger(n) || n < 1) return "";
  const hours = Math.floor(n / 60);
  const minutes = n % 60;
  if (hours > 0 && minutes > 0) return hours + " hr " + minutes + " min";
  if (hours > 0) return hours + " hr";
  return minutes + " min";
}

function optionList(base, selected) {
  const out = base.slice();
  const extra = asInt(selected);
  if (Number.isInteger(extra) && extra >= 0 && out.indexOf(extra) === -1) {
    out.push(extra);
    out.sort(function (a, b) { return a - b; });
  }
  return out;
}

function optionsHtml(values, selected) {
  const current = asInt(selected);
  return values.map(function (value) {
    return '<option value="' + value + '"' + (value === current ? " selected" : "") + ">" + value + "</option>";
  }).join("");
}

export function serviceDurationControlsHtml(totalMinutes, ids) {
  const parts = splitServiceDurationMinutes(totalMinutes);
  const hoursId = ids && ids.hoursId ? ids.hoursId : "serviceDurationHours";
  const minutesId = ids && ids.minutesId ? ids.minutesId : "serviceDurationMinutes";
  const errorId = ids && ids.errorId ? ids.errorId : "serviceDurationError";
  const compact = !!(ids && ids.compact);
  const fieldStyle = compact
    ? "display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:600;color:#6b7280;"
    : "display:flex;flex-direction:column;gap:4px;flex:1;font-size:12px;font-weight:600;color:#6b7280;";
  const selectStyle = compact
    ? "width:88px;padding:7px 9px;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#111827;background:#fff;box-sizing:border-box;"
    : "width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px;font-size:14px;color:#111827;background:#fff;box-sizing:border-box;";
  return (
    '<div>' +
      '<div style="display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;">' +
        '<label style="' + fieldStyle + '">' +
          "<span>Hours</span>" +
          '<select id="' + hoursId + '" style="' + selectStyle + '">' + optionsHtml(optionList(HOUR_CHOICES, parts.hours), parts.hours) + "</select>" +
        "</label>" +
        '<label style="' + fieldStyle + '">' +
          "<span>Minutes</span>" +
          '<select id="' + minutesId + '" style="' + selectStyle + '">' + optionsHtml(optionList(MINUTE_CHOICES, parts.minutes), parts.minutes) + "</select>" +
        "</label>" +
      "</div>" +
      '<div id="' + errorId + '" style="display:none;margin-top:6px;font-size:12px;font-weight:600;color:#b91c1c;">Duration cannot be 0 hr 0 min.</div>' +
    "</div>"
  );
}

export function showServiceDurationError(errorEl, hoursEl, minutesEl) {
  if (errorEl) {
    errorEl.style.display = "block";
    errorEl.textContent = "Duration cannot be 0 hr 0 min.";
  }
  [hoursEl, minutesEl].forEach(function (el) {
    if (!el) return;
    const prev = el.style.borderColor;
    el.style.borderColor = "#ef4444";
    setTimeout(function () { el.style.borderColor = prev || "#e5e7eb"; }, 1400);
  });
  if (hoursEl && typeof hoursEl.focus === "function") hoursEl.focus();
}

if (typeof window !== "undefined") {
  window.ffServiceDuration = {
    splitServiceDurationMinutes,
    joinServiceDurationMinutes,
    formatServiceDurationLabel
  };
}
