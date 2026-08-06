/**
 * Tasks Analytics — pure computation.
 *
 * Pure analytics logic for the Tasks screen: timestamp/normalization helpers,
 * task type/role resolvers, rate calculators, range filtering and the core
 * metrics + insights builders. Extracted verbatim from tasks-analytics.js
 * (computeMetrics had its dead `= getSelectedRange()` default dropped — its
 * only caller always passes an explicit range). No DOM, no Firestore.
 */

import { clean, safeArr, LOG, TABS, KINDS } from "./tasks-analytics-data.js?v=20260625_tasks_analytics_split";

const TASK_TYPE_LABELS = ["Opening", "Closing", "Weekly", "Monthly", "Yearly"];

function toMillis(value) {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value.toMillis === "function") {
    try { return value.toMillis(); } catch (_) { return null; }
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isCompleted(task, kind) {
  const status = clean(task?.status || task?.state).toLowerCase();
  return kind === "done" ||
    status === "done" ||
    status === "completed" ||
    task?.completed === true ||
    task?.isCompleted === true ||
    task?.done === true ||
    !!task?.completedAt ||
    !!task?.completedBy;
}

function taskType(task, tab) {
  const raw = clean(task?.type || task?.taskType || task?.category || tab).toLowerCase();
  if (raw.includes("open") || tab === "opening") return "Opening";
  if (raw.includes("close") || tab === "closing") return "Closing";
  if (raw.includes("week") || tab === "weekly") return "Weekly";
  if (raw.includes("month") || tab === "monthly") return "Monthly";
  if (raw.includes("year") || tab === "yearly") return "Yearly";
  return tab ? tab.charAt(0).toUpperCase() + tab.slice(1) : "Other";
}

function roleType(task) {
  const raw = clean(
    task?.assignedRole ||
    task?.staffRole ||
    task?.role ||
    task?.assignTo ||
    task?.assignedToRole ||
    task?.requiredRole,
  ).toLowerCase();
  if (/(manager|admin|owner|lead)/.test(raw)) return "Manager";
  if (/(service|provider|technician|tech|staff|employee)/.test(raw)) return "Service Provider";
  return "Other";
}

function taskTimestamp(task) {
  return toMillis(
    task?.createdAt ??
    task?.createdAtMs ??
    task?.created ??
    task?.addedAt ??
    task?.completedAt ??
    task?.dueDate,
  );
}

function dueTimestamp(task) {
  return toMillis(task?.dueDate ?? task?.dueAt ?? task?.deadline ?? task?.alertAt);
}

export function normalizeTasks(state) {
  const rows = [];
  const seen = new Set();
  TABS.forEach((tab) => {
    KINDS.forEach((kind) => {
      const list = safeArr(state?.[tab]?.[kind] || state?.[tab]?.items);
      list.forEach((task, index) => {
        if (!task || typeof task !== "object") return;
        const id = clean(task.taskId || task.id || task.title || `${tab}-${kind}-${index}`);
        const completed = isCompleted(task, kind);
        const key = `${tab}|${id}|${completed ? "done" : "open"}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({
          id,
          title: clean(task.title || task.name || id),
          tab,
          kind,
          completed,
          type: taskType(task, tab),
          role: roleType(task),
          createdMs: taskTimestamp(task),
          completedMs: toMillis(task.completedAt ?? task.completedAtMs),
          dueMs: dueTimestamp(task),
        });
      });
    });
  });
  return rows;
}

function rate(completed, total) {
  return total > 0 ? Math.round((completed / total) * 100) : null;
}

export function fmtRate(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function bucketRate(rows, label, picker) {
  const scoped = rows.filter((row) => picker(row) === label);
  return {
    label,
    total: scoped.length,
    completed: scoped.filter((row) => row.completed).length,
    rate: rate(scoped.filter((row) => row.completed).length, scoped.length),
  };
}

function periodRate(rows, fromMs, toMs) {
  const scoped = rows.filter((row) => {
    const ms = row.completedMs || row.createdMs;
    return Number.isFinite(ms) && ms >= fromMs && ms < toMs;
  });
  return {
    total: scoped.length,
    completed: scoped.filter((row) => row.completed).length,
    rate: rate(scoped.filter((row) => row.completed).length, scoped.length),
  };
}

function taskRangeMs(row) {
  return row.completedMs || row.createdMs || row.dueMs || null;
}

export function filterRowsByRange(rows, range) {
  const from = Number(range?.fromMs);
  const to = Number(range?.toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return rows;
  return rows.filter((row) => {
    const ms = taskRangeMs(row);
    return !Number.isFinite(ms) || (ms >= from && ms <= to);
  });
}

function previousRange(range) {
  const from = Number(range?.fromMs);
  const to = Number(range?.toMs);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const span = Math.max(1, to - from + 1);
  return { fromMs: from - span, toMs: from - 1 };
}

export function computeMetrics(rows, source, range, allRows = rows) {
  const now = Date.now();
  const completed = rows.filter((row) => row.completed).length;
  const open = rows.length - completed;
  const overdue = rows.filter((row) => !row.completed && Number.isFinite(row.dueMs) && row.dueMs < now).length;
  const prev = previousRange(range);
  const thisWeek = periodRate(allRows, range.fromMs, range.toMs + 1);
  const lastWeek = prev ? periodRate(allRows, prev.fromMs, prev.toMs + 1) : { total: 0, completed: 0, rate: null };
  const overallRate = rate(completed, rows.length);
  const labels = [...TASK_TYPE_LABELS];
  rows.forEach((row) => {
    if (row.type && !labels.includes(row.type)) labels.push(row.type);
  });
  const byType = labels.map((label) => bucketRate(rows, label, (row) => row.type));
  const byRole = ["Manager", "Service Provider", "Other"].map((label) => bucketRate(rows, label, (row) => row.role));
  const metrics = {
    source,
    total: rows.length,
    completed,
    open,
    overdue,
    completionRate: overallRate,
    byType,
    byRole,
    thisWeek,
    lastWeek,
    rangeLabel: range.label,
    hasData: rows.length > 0,
  };
  console.log(LOG, "metrics calculated", metrics);
  return metrics;
}

export function buildInsights(metrics) {
  if (!metrics.hasData) return [];
  const out = [];
  const closing = metrics.byType.find((row) => row.label === "Closing");
  const service = metrics.byRole.find((row) => row.label === "Service Provider");
  if (closing?.total >= 2 && Number.isFinite(closing.rate) && closing.rate < 70) {
    out.push({ kind: "warn", text: "Closing tasks often not completed." });
  }
  if (service?.total >= 2 && Number.isFinite(service.rate) && service.rate < 70) {
    out.push({ kind: "warn", text: "Service Providers have low completion rate." });
  }
  if (metrics.overdue >= 5 || (metrics.open > 0 && metrics.overdue / metrics.open >= 0.3)) {
    out.push({ kind: "warn", text: "High number of overdue tasks." });
  }
  if (Number.isFinite(metrics.completionRate) && metrics.completionRate >= 80) {
    out.push({ kind: "good", text: "Good task completion this week." });
  }
  if (!out.length) out.push({ kind: "info", text: "Task activity is being tracked. More insights will appear as patterns develop." });
  return out.slice(0, 4);
}
