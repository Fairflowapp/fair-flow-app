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
  ffMerge3,
} = (() => {
  return {
    ffProtectCloudData: vm.runInContext("ffProtectCloudData", sandbox),
    setAuthServerState: vm.runInContext("setAuthServerState", sandbox),
    ffMerge3: vm.runInContext("ffMerge3", sandbox),
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

// ── Scenario 7: Aug 13 stale Available overwrite (no Finish rows) ───────────
const liveAvail = ["Lala", "Yuliet"];
const liveService = ["Elizabeth", "Margi", "Arce", "Erieliz", "Monica", "Maria", "Solange", "Luz", "Mileidys", "Rosio"];
const liveLog = liveService.map((n, i) => row("Start (Available - In service)", n, now - (40 - i) * 60000));
setAuthServerState(liveAvail.map(P), liveService.map(P), liveLog);
const staleMorning = ["Elizabeth", "Margi", "Arce", "Erieliz", "Monica", "Solange", "Luz", "Mileidys", "Rosio"];
const staleJumpBody = {
  queue: staleMorning.map(P),
  service: [],
  log: liveLog.slice(0, 2),
};
const guarded7 = ffProtectCloudData(staleJumpBody, false);
const g7svc = guarded7.service.map((x) => x.name);
check("aug13 jump-back: In Service people stay in service",
  liveService.every((n) => g7svc.includes(n)),
  "service=" + g7svc.join(","));
check("aug13 jump-back: nobody from In Service left only on Available",
  liveService.every((n) => !guarded7.queue.some((x) => x.name === n) || guarded7.service.some((x) => x.name === n)),
  "queue=" + guarded7.queue.map((x) => x.name).join(","));

// ── Scenario 8: genuine Finish still moves that one person ──────────────────
setAuthServerState(liveAvail.map(P), liveService.map(P), liveLog);
const finishBody = {
  queue: liveAvail.concat(["Margi"]).map(P),
  service: liveService.filter((n) => n !== "Margi").map(P),
  log: liveLog.concat([row("Finish (In service - Available)", "Margi", now - 2000)]),
};
const guarded8 = ffProtectCloudData(finishBody, false);
check("genuine finish: Margi returns to Available",
  guarded8.queue.some((x) => x.name === "Margi") && !guarded8.service.some((x) => x.name === "Margi"),
  "q=" + guarded8.queue.map((x) => x.name).join(",") + " s=" + guarded8.service.map((x) => x.name).join(","));
check("genuine finish: other In Service people untouched",
  liveService.filter((n) => n !== "Margi").every((n) => guarded8.service.some((x) => x.name === n)));

// ── Scenario 9: merge of stale captured write after snapshot advanced base ──
const serverState = { queue: liveAvail.map(P), service: liveService.map(P), log: liveLog };
const staleLocal = { queue: staleMorning.map(P), service: [], log: liveLog.slice(0, 2) };
const merged9 = ffMerge3(serverState, staleLocal, serverState);
check("merge stale: adopts live In Service (no new log rows)",
  merged9.service.length === 10 && liveService.every((n) => merged9.service.some((x) => x.name === n)),
  "s=" + merged9.service.map((x) => x.name).join(","));

// ── Scenario 10: merge of one real Finish on top of live server ─────────────
const localFinish = {
  queue: liveAvail.concat(["Margi"]).map(P),
  service: liveService.filter((n) => n !== "Margi").map(P),
  log: liveLog.concat([row("Finish (In service - Available)", "Margi", now - 1000)]),
};
const merged10 = ffMerge3(serverState, localFinish, serverState);
check("merge finish: only Margi leaves In Service",
  !merged10.service.some((x) => x.name === "Margi") &&
    liveService.filter((n) => n !== "Margi").every((n) => merged10.service.some((x) => x.name === n)),
  "s=" + merged10.service.map((x) => x.name).join(","));

// ── Scenario 11: unrelated new log row must not mass-Finish ─────────────────
setAuthServerState(liveAvail.map(P), liveService.map(P), liveLog);
const taskNoiseBody = {
  queue: staleMorning.map(P),
  service: [],
  log: liveLog.concat([row("Task Completed: Hot Towels", "Margi", now - 1000)]),
};
const guarded11 = ffProtectCloudData(taskNoiseBody, false);
check("task-noise: In Service people stay in service",
  liveService.every((n) => guarded11.service.some((x) => x.name === n)),
  "s=" + guarded11.service.map((x) => x.name).join(","));
const merged11 = ffMerge3(serverState, taskNoiseBody, serverState);
check("task-noise merge: Task Completed does not Finish anyone",
  liveService.every((n) => merged11.service.some((x) => x.name === n)),
  "s=" + merged11.service.map((x) => x.name).join(","));

// ── Scenario 12: genuine Start still moves that one person ──────────────────
setAuthServerState(["Lala", "Yuliet", "Monica"].map(P), liveService.filter((n) => n !== "Monica").map(P), liveLog);
const startBody = {
  queue: ["Lala", "Yuliet"].map(P),
  service: liveService.map(P),
  log: liveLog.concat([row("Start (Available - In service)", "Monica", now - 1500)]),
};
const guarded12 = ffProtectCloudData(startBody, false);
check("genuine start: Monica in service, not duplicated on Available",
  guarded12.service.some((x) => x.name === "Monica") && !guarded12.queue.some((x) => x.name === "Monica"));

// ── Scenario 13: two devices Start different people — both survive ──────────
const coreSvc = ["Margi", "Arce", "Erieliz", "Maria", "Solange", "Luz", "Mileidys", "Rosio"];
const baseBothAvail = {
  queue: ["Lala", "Yuliet", "Monica", "Elizabeth"].map(P),
  service: coreSvc.map(P),
  log: coreSvc.map((n, i) => row("Start (Available - In service)", n, now - (40 - i) * 60000)),
};
const serverAfterLiz = {
  queue: ["Lala", "Yuliet", "Monica"].map(P),
  service: ["Elizabeth"].concat(coreSvc).map(P),
  log: baseBothAvail.log.concat([row("Start (Available - In service)", "Elizabeth", now - 4000)]),
};
const localMonicaStart = {
  queue: ["Lala", "Yuliet", "Elizabeth"].map(P),
  service: ["Monica"].concat(coreSvc).map(P),
  log: baseBothAvail.log.concat([row("Start (Available - In service)", "Monica", now - 1000)]),
};
const merged13 = ffMerge3(baseBothAvail, localMonicaStart, serverAfterLiz);
check("concurrent starts: Monica and Elizabeth both In Service",
  merged13.service.some((x) => x.name === "Monica") && merged13.service.some((x) => x.name === "Elizabeth"),
  "s=" + merged13.service.map((x) => x.name).join(","));

// ── Scenario 14: Start on one device + Finish of someone else on server ─────
const serverAfterMargiFinish = {
  queue: liveAvail.concat(["Margi"]).map(P),
  service: liveService.filter((n) => n !== "Margi").map(P),
  log: liveLog.concat([row("Finish (In service - Available)", "Margi", now - 3000)]),
};
const localYulietStart = {
  queue: ["Lala"].map(P),
  service: liveService.concat([P("Yuliet")]).map((x) => (x.name ? x : x)),
  log: liveLog.concat([row("Start (Available - In service)", "Yuliet", now - 1000)]),
};
localYulietStart.service = liveService.concat(["Yuliet"]).map(P);
const merged14 = ffMerge3(serverState, localYulietStart, serverAfterMargiFinish);
check("concurrent start+finish: Yuliet in service, Margi stays Available",
  merged14.service.some((x) => x.name === "Yuliet") &&
    !merged14.service.some((x) => x.name === "Margi") &&
    merged14.queue.some((x) => x.name === "Margi"),
  "q=" + merged14.queue.map((x) => x.name).join(",") + " s=" + merged14.service.map((x) => x.name).join(","));

// ── Scenario 15: explicit reset still empties ───────────────────────────────
setAuthServerState(liveAvail.map(P), liveService.map(P), liveLog);
const resetLive = { queue: [], service: [], log: liveLog.concat([row("Queue Reset (12 workers removed)", "", now)]) };
const guarded15 = ffProtectCloudData(resetLive, true);
check("reset: both lists empty", guarded15.queue.length === 0 && guarded15.service.length === 0);

// ── Scenario 16: post-reset leftover list must not come back ────────────────
setAuthServerState([], [], srvLog);
const leftoverBody = {
  queue: ["Elizabeth", "Mileidys", "Margi", "Katy", "Erieliz"].map(P),
  service: [],
  log: srvLog,
};
const guarded16 = ffProtectCloudData(leftoverBody, false);
check("post-reset leftovers: all stripped",
  guarded16.queue.length === 0 && guarded16.service.length === 0,
  "q=" + guarded16.queue.map((x) => x.name).join(","));

// ── Scenario 17: leftovers riding on top of this morning's real joins ───────
setAuthServerState(["Monica", "Mabel"].map(P), [], srvLog.concat([
  row("Join", "Monica", now - 40000),
  row("Join", "Mabel", now - 30000),
]));
const mixBody = {
  queue: ["Monica", "Mabel", "Elizabeth", "Mileidys"].map(P),
  service: [],
  log: srvLog,
};
const guarded17 = ffProtectCloudData(mixBody, false);
check("morning mix: keep Monica+Mabel, strip leftovers",
  guarded17.queue.map((x) => x.name).sort().join(",") === "Mabel,Monica",
  "q=" + guarded17.queue.map((x) => x.name).join(","));

// ── Scenario 18: a real Join this minute is still allowed ───────────────────
setAuthServerState(["Monica"].map(P), [], srvLog.concat([row("Join", "Monica", now - 20000)]));
const realJoin = {
  queue: ["Monica", "Solange"].map(P),
  service: [],
  log: srvLog.concat([row("Join", "Monica", now - 20000), row("Join", "Solange", now - 1000)]),
};
const guarded18 = ffProtectCloudData(realJoin, false);
check("fresh join: Solange stays",
  guarded18.queue.some((x) => x.name === "Solange") && guarded18.queue.some((x) => x.name === "Monica"),
  "q=" + guarded18.queue.map((x) => x.name).join(","));

console.log(failures ? `\n${failures} FAILURES` : "\nALL TESTS PASSED");
process.exit(failures ? 1 : 0);
