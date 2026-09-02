/**
 * Dashboard — pure compute + formatting.
 *
 * Number/time/currency formatters and the insight builder. No DOM, no I/O, no
 * imports from data: buildInsights operates on the snapshot object passed in.
 * Extracted verbatim from dashboard.js.
 */

export function fmtNumber(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (typeof n !== "number") return String(n);
  if (Math.abs(n) >= 1000) return n.toLocaleString();
  return String(n);
}

export function fmtMinutes(min) {
  if (!Number.isFinite(min) || min <= 0) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export function fmtHourRange(hour24) {
  if (!Number.isFinite(hour24) || hour24 < 0 || hour24 > 23) return "—";
  const next = (hour24 + 1) % 24;
  const label = (h) => {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  };
  return `${label(hour24).replace(/ AM| PM/, "")}–${label(next)}`;
}

export function fmtCurrency(v) {
  if (!Number.isFinite(v)) return "—";
  try {
    return v.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  } catch (_) {
    return `$${Math.round(v).toLocaleString()}`;
  }
}

export function buildInsights(snap) {
  const out = [];
  // High wait
  if (Number.isFinite(snap.queue.avgWaitMin) && snap.queue.avgWaitMin >= 20) {
    out.push({ kind: "warn", icon: "⚠️", text: `High wait times detected — average is ${fmtMinutes(snap.queue.avgWaitMin)}.` });
  }
  // Big queue
  if (snap.queue.inQueue >= 8) {
    out.push({ kind: "warn", icon: "⚠️", text: `Long queue — ${snap.queue.inQueue} customers waiting right now.` });
  }
  // Overtime
  if (snap.time.hasData && snap.time.overtimeHours >= 5) {
    out.push({ kind: "warn", icon: "⚠️", text: `High overtime — ${snap.time.overtimeHours.toFixed(1)}h beyond 40h/staff per week.` });
  }
  // Tasks completion
  if (snap.tasks.hasData && snap.tasks.completionRate != null && snap.tasks.completionRate < 50) {
    out.push({ kind: "warn", icon: "⚠️", text: `Tasks completion is low — only ${snap.tasks.completionRate}% completed.` });
  }
  // Positive: nothing pending
  if (!out.length) {
    if (snap.tasks.hasData && snap.tasks.completionRate != null && snap.tasks.completionRate >= 90) {
      out.push({ kind: "good", icon: "✅", text: `Great job — ${snap.tasks.completionRate}% of tasks are completed.` });
    } else {
      out.push({ kind: "info", icon: "ℹ️", text: "No alerts right now. Things look quiet." });
    }
  }
  return out.slice(0, 4);
}
