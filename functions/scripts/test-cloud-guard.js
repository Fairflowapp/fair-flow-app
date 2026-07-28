/**
 * Offline unit test for ffProtectCloudData in public/queue-cloud.js.
 * Loads the module source with imports/exports stripped and firebase stubbed,
 * then replays the 2026-07-28 production wipe scenario plus legit flows.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let src = fs.readFileSync(path.join(__dirname, "..", "..", "public", "queue-cloud.js"), "utf8");
src = src.replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
src = src.replace(/^export\s+/gm, "");

const sandbox = {
  console,
  Date,
  JSON,
  Math,
  Array,
  Object,
  String,
  Number,
  Set,
  Promise,
  setTimeout,
  clearTimeout,
  // firebase stubs — never actually called in this test
  doc: () => ({}),
  getDoc: () => Promise.resolve({ exists: () => false }),
  getDocFromServer: () => Promise.resolve({ exists: () => false }),
  setDoc: () => Promise.resolve(),
  onSnapshot: () => () => {},
  serverTimestamp: () => 0,
  onAuthStateChanged: () => {},
  auth: { currentUser: null },
  db: {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const {
  ffProtectCloudData,
  setAuthServerState,
} = (() => {
  return {
    ffProtectCloudData: vm.runInContext("ffProtectCloudData", sandbox),
    setAuthServerState: vm.runInContext("setAuthServerState", sandbox),
  };
})();

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log("PASS:", name); }
  else { failures++; console.log("FAIL:", name, extra || ""); }
}

const now = Date.now();
const P = (name) => ({ name, staffId: "id_" + name.replace(/\s+/g, "_").toLowerCase() });
const row = (action, worker, ts) => ({ ts, time: "x", action, worker, performedBy: worker });

// ── Scenario 1: the production wipe ─────────────────────────────────────────
// Cloud (freshest): 6 people in queue, log has their Join rows.
const joiners = ["Solange", "Mileidys", "Monica", "Johana", "Katy", "Margi"];
const srvLog = joiners.map((n, i) => row("Join", n, now - (60 - i) * 60000));
setAuthServerState(joiners.map(P), [], srvLog);

// Stale phone payload from an hour ago: only 2 people, log missing 4 Join rows.
const staleBody = {
  queue: [P("Solange"), P("Mileidys")],
  service: [],
  log: srvLog.slice(0, 2),
};
const guarded1 = ffProtectCloudData(staleBody, false);
check("wipe scenario: all 6 people survive",
  guarded1.queue.length === 6,
  "got queue=" + guarded1.queue.map((x) => x.name).join(","));
check("wipe scenario: no Join rows lost",
  guarded1.log.length === 6,
  "got log len=" + guarded1.log.length);

// ── Scenario 2: genuine fresh removal is allowed ────────────────────────────
setAuthServerState(joiners.map(P), [], srvLog);
const removalBody = {
  queue: joiners.filter((n) => n !== "Katy").map(P),
  service: [],
  log: srvLog.concat([row("Remove", "Katy", now - 5000)]), // fresh row, unknown to cloud
};
const guarded2 = ffProtectCloudData(removalBody, false);
check("fresh removal: Katy stays removed",
  guarded2.queue.length === 5 && !guarded2.queue.some((x) => x.name === "Katy"),
  "got queue=" + guarded2.queue.map((x) => x.name).join(","));

// ── Scenario 3: STALE removal (old ts) is undone ────────────────────────────
setAuthServerState(joiners.map(P), [], srvLog);
const staleRemovalBody = {
  queue: joiners.filter((n) => n !== "Katy").map(P),
  service: [],
  log: srvLog.concat([row("Remove", "Katy", now - 3 * 60 * 60000)]), // 3h old
};
const guarded3 = ffProtectCloudData(staleRemovalBody, false);
check("stale removal: Katy restored",
  guarded3.queue.some((x) => x.name === "Katy"),
  "got queue=" + guarded3.queue.map((x) => x.name).join(","));

// ── Scenario 4: move to In Service is untouched ─────────────────────────────
setAuthServerState(joiners.map(P), [], srvLog);
const moveBody = {
  queue: joiners.filter((n) => n !== "Monica").map(P),
  service: [P("Monica")],
  log: srvLog.concat([row("Start (Available - In service)", "Monica", now - 2000)]),
};
const guarded4 = ffProtectCloudData(moveBody, false);
check("move: Monica in service, not duplicated back to queue",
  guarded4.service.length === 1 && guarded4.queue.length === 5,
  "q=" + guarded4.queue.length + " s=" + guarded4.service.length);

// ── Scenario 5: explicit reset bypasses the guard ───────────────────────────
setAuthServerState(joiners.map(P), [], srvLog);
const resetBody = { queue: [], service: [], log: srvLog.concat([row("Queue Reset (6 workers removed)", "", now)]) };
const guarded5 = ffProtectCloudData(resetBody, true);
check("explicit reset: queue really empties", guarded5.queue.length === 0);

// ── Scenario 6: new join passes through untouched ───────────────────────────
setAuthServerState(joiners.map(P), [], srvLog);
const joinBody = {
  queue: joiners.map(P).concat([P("Elizabeth")]),
  service: [],
  log: srvLog.concat([row("Join", "Elizabeth", now - 1000)]),
};
const guarded6 = ffProtectCloudData(joinBody, false);
check("join: Elizabeth added, nobody lost",
  guarded6.queue.length === 7,
  "got queue=" + guarded6.queue.map((x) => x.name).join(","));

console.log(failures ? `\n${failures} FAILURES` : "\nALL TESTS PASSED");
process.exit(failures ? 1 : 0);
