// Pure queue write guard (no Firebase). Used by onQueueStateWrite and unit tests.

const JUSTIFY_WINDOW_MS = 10 * 60 * 1000;

function normName(v) {
  return String(v == null ? "" : v).trim().toLowerCase();
}

function itemKeys(it) {
  if (it == null) return ["∅"];
  if (typeof it !== "object") return ["v:" + String(it)];
  const keys = [];
  if (it.staffId != null && String(it.staffId).trim() !== "") keys.push("s:" + String(it.staffId));
  if (it.name != null && String(it.name).trim() !== "") keys.push("n:" + String(it.name).trim().toLowerCase());
  return keys.length ? keys : ["?"];
}

function collectKeys(list) {
  const out = new Set();
  (Array.isArray(list) ? list : []).forEach((it) => itemKeys(it).forEach((k) => out.add(k)));
  return out;
}

function keysOverlap(keys, set) {
  return keys.some((k) => set.has(k));
}

function logKey(e) {
  if (e == null) return "∅";
  if (typeof e !== "object") return "v:" + String(e);
  const ts = typeof e.ts === "number" ? e.ts : "";
  return "t:" + ts + "|a:" + String(e.action || "") + "|w:" + String(e.worker || "") + "|p:" + String(e.performedBy || "");
}

function isAddAction(action) {
  const a = String(action || "").trim();
  if (/^join blocked/i.test(a)) return false;
  return /^(join|add technician)/i.test(a);
}

function isIntentAction(action) {
  const a = String(action || "").trim();
  if (/^join blocked/i.test(a)) return false;
  return /^(start|finish|join|remove|add technician|queue reset|automatic queue reset)/i.test(a);
}

function justifiedNames(afterLog, beforeLog, predicate) {
  const names = new Set();
  const known = new Set((Array.isArray(beforeLog) ? beforeLog : []).map(logKey));
  const now = Date.now();
  (Array.isArray(afterLog) ? afterLog : []).forEach((e) => {
    if (!e || typeof e !== "object") return;
    if (known.has(logKey(e))) return;
    if (!predicate(e.action)) return;
    const ts = typeof e.ts === "number" ? e.ts : 0;
    if (!ts || Math.abs(now - ts) > JUSTIFY_WINDOW_MS) return;
    const w = normName(e.worker);
    if (w) names.add(w);
  });
  return names;
}

function samePeople(a, b) {
  const ka = [...collectKeys(a)].sort().join(",");
  const kb = [...collectKeys(b)].sort().join(",");
  return ka === kb;
}

function protectQueueWrite(before, after) {
  const beforeQueue = Array.isArray(before.queue) ? before.queue : [];
  const beforeService = Array.isArray(before.service) ? before.service : [];
  const beforeLog = Array.isArray(before.log) ? before.log : [];
  const afterQueue = Array.isArray(after.queue) ? after.queue.slice() : [];
  const afterService = Array.isArray(after.service) ? after.service.slice() : [];
  const afterLog = Array.isArray(after.log) ? after.log : [];

  const addOk = justifiedNames(afterLog, beforeLog, isAddAction);
  const intentOk = justifiedNames(afterLog, beforeLog, isIntentAction);
  const liveKeys = collectKeys(beforeQueue.concat(beforeService));

  const queue = afterQueue.filter((it) => keysOverlap(itemKeys(it), liveKeys) || addOk.has(normName(it && it.name)));
  const service = afterService.filter((it) => keysOverlap(itemKeys(it), liveKeys) || addOk.has(normName(it && it.name)));

  const present = collectKeys(queue.concat(service));
  beforeQueue.forEach((it) => {
    if (keysOverlap(itemKeys(it), present)) return;
    if (intentOk.has(normName(it && it.name))) return;
    queue.push(it);
    itemKeys(it).forEach((k) => present.add(k));
  });
  beforeService.forEach((it) => {
    if (keysOverlap(itemKeys(it), present)) return;
    if (intentOk.has(normName(it && it.name))) return;
    service.push(it);
    itemKeys(it).forEach((k) => present.add(k));
  });

  return { queue, service, changed: !samePeople(queue.concat(service), afterQueue.concat(afterService)) };
}

module.exports = { protectQueueWrite };
