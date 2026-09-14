/**
 * Smart Scheduling Phase 13 physical resource constraints.
 * No Firestore, DOM, Calendar, or Reports.
 * Usage: node scripts/test-booking-smart-scheduling-resources.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");

function load(rel, windowObj) {
  new Function("window", fs.readFileSync(path.join(root, rel), "utf8"))(windowObj);
}

const windowObj = {};
[
  "public/booking/smart-scheduling/normalize.js",
  "public/booking/smart-scheduling/gaps.js",
  "public/booking/smart-scheduling/candidates.js",
  "public/booking/smart-scheduling/score.js",
  "public/booking/smart-scheduling/engine.js",
  "public/booking/smart-scheduling/moves.js",
  "public/booking/smart-scheduling/day-analysis.js",
  "public/booking/smart-scheduling/priorities.js",
  "public/booking/smart-scheduling/assign.js",
  "public/booking/smart-scheduling/cancellation-recovery.js",
  "public/booking/smart-scheduling/waitlist.js",
  "public/booking/smart-scheduling/recovery-planner.js",
  "public/booking/smart-scheduling/gap-planner.js",
  "public/booking/smart-scheduling/global-plan.js",
  "public/booking/smart-scheduling/salon-plan.js",
  "public/booking/smart-scheduling/multi-service.js",
  "public/booking/smart-scheduling/parallel-multi-service.js",
  "public/booking/smart-scheduling/resource-aware-multi-service.js"
].forEach(function (rel) { load(rel, windowObj); });

const api = windowObj.ffBookingSmartScheduling;
if (!api || typeof api.rankResourceAwareVisitPlans !== "function") {
  console.error("Smart Scheduling resource-aware API did not load.");
  process.exit(1);
}

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log("PASS:", name);
  else {
    failed += 1;
    console.log("FAIL:", name, extra == null ? "" : extra);
  }
}

function line(startMin, endMin, extra) {
  return Object.assign({
    lineId: "l-" + startMin + "-" + endMin,
    appointmentId: "a-" + startMin,
    providerId: extra && extra.providerId || "provA",
    startMin: startMin,
    endMin: endMin,
    status: "scheduled"
  }, extra || {});
}

function makeDay(overrides) {
  return api.normalizeProviderDay(Object.assign({
    dateKey: "2026-09-14",
    locationId: "locA",
    providerId: "provA",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    lines: [],
    allowedOverlapMinutes: 0
  }, overrides || {}));
}

function makeResource(overrides) {
  return Object.assign({
    resourceId: "chair-1",
    resourceType: "pedicure_chair",
    locationId: "locA",
    dateKey: "2026-09-14",
    workingIntervals: [{ startMin: 9 * 60, endMin: 18 * 60 }],
    occupied: []
  }, overrides || {});
}

function svc(lineKey, durationMinutes, eligible, extra) {
  return Object.assign({
    lineKey: lineKey,
    serviceId: "svc-" + lineKey,
    durationMinutes: durationMinutes,
    eligibleProviderIds: eligible,
    assignmentType: "any_provider"
  }, extra || {});
}

function req(requirementKey, eligible, extra) {
  return Object.assign({
    requirementKey: requirementKey,
    eligibleResourceIds: eligible,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0
  }, extra || {});
}

function assignmentOf(plan, lineKey, requirementKey) {
  const lineRow = (plan && plan.serviceLines || []).find(function (row) { return row.lineKey === lineKey; });
  return (lineRow && lineRow.resourceAssignments || []).find(function (row) {
    return row.requirementKey === requirementKey;
  });
}

const emptyA = makeDay({ providerId: "provA" });
const emptyB = makeDay({ providerId: "provB" });
const chair1 = makeResource({ resourceId: "chair-1" });
const chair2 = makeResource({ resourceId: "chair-2" });
const snapA = JSON.stringify(emptyA);
const snapChair = JSON.stringify(chair1);

check("public resource-aware API loaded", !!(
  api.rankResourceAwareVisitPlans
  && api.recommendResourceAwareVisit
  && api.compareResourceAwareVisitPlans
  && api.RESOURCE_AWARE
  && api.PHASE12_INTERNALS
));

// ---------------------------------------------------------------------------
// PEDICURE CHAIR BASIC / PROVIDER FREE RESOURCE BUSY / RESOURCE FREE PROVIDER BUSY
// ---------------------------------------------------------------------------

const basicReq = {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("chair", ["chair-1"])]
    })
  ],
  preferredStartMin: 10 * 60
};
const basic = api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], basicReq);
check("provider and chair available yields a valid plan", basic && basic.valid && assignmentOf(basic, "pedi", "chair") && assignmentOf(basic, "pedi", "chair").resourceId === "chair-1", basic);
check("resource reservation matches the service window when buffers are 0", basic && assignmentOf(basic, "pedi", "chair").reservationStartMin === 10 * 60 && assignmentOf(basic, "pedi", "chair").reservationEndMin === 11 * 60);

const busyChair = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "booked", startMin: 10 * 60, endMin: 11 * 60 }]
});
check("provider free / only chair occupied is invalid", api.recommendResourceAwareVisit([emptyA, emptyB], [busyChair], basicReq) === null);

const busyProv = makeDay({
  providerId: "provB",
  lines: [line(10 * 60, 11 * 60, { providerId: "provB" })]
});
check("chair free / required provider busy is invalid", api.recommendResourceAwareVisit([emptyA, busyProv], [chair1], basicReq) === null);

// ---------------------------------------------------------------------------
// ALTERNATIVE / SPECIFIC RESOURCE
// ---------------------------------------------------------------------------

const alt = api.recommendResourceAwareVisit([emptyA, emptyB], [busyChair, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("chair", ["chair-1", "chair-2"])]
    })
  ],
  preferredStartMin: 10 * 60
});
check("busy chair 1 falls through to free chair 2", alt && assignmentOf(alt, "pedi", "chair").resourceId === "chair-2", alt);

const specificFail = api.recommendResourceAwareVisit([emptyA, emptyB], [busyChair, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("chair", ["chair-1", "chair-2"], { specificResourceId: "chair-1" })]
    })
  ],
  preferredStartMin: 10 * 60
});
check("specific busy resource is not silently switched", specificFail === null);

// ---------------------------------------------------------------------------
// PARALLEL CHAIRS / UNIQUENESS / NON-GREEDY
// ---------------------------------------------------------------------------

const twoChairs = api.recommendResourceAwareVisit([emptyA, emptyB], [chair1, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-2"])] })
  ],
  preferredStartMin: 10 * 60
});
check("two simultaneous services can use two distinct chairs", twoChairs && twoChairs.valid && assignmentOf(twoChairs, "mani", "chair").resourceId === "chair-1" && assignmentOf(twoChairs, "pedi", "chair").resourceId === "chair-2");

check("two simultaneous lines cannot share the only chair", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: 10 * 60
}) === null);

const packedChair1 = makeResource({
  resourceId: "chair-1",
  occupied: [{ occupancyId: "am", startMin: 9 * 60, endMin: 10 * 60 }]
});
const greedy = api.recommendResourceAwareVisit([emptyA, emptyB], [packedChair1, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1", "chair-2"])] }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: 10 * 60
});
check("non-greedy: A gets chair 2 so B can keep chair 1", greedy && assignmentOf(greedy, "mani", "chair").resourceId === "chair-2" && assignmentOf(greedy, "pedi", "chair").resourceId === "chair-1", greedy && {
  mani: greedy && assignmentOf(greedy, "mani", "chair"),
  pedi: greedy && assignmentOf(greedy, "pedi", "chair")
});

const packedA = makeDay({
  providerId: "provA",
  lines: [
    line(9 * 60, 10 * 60, { providerId: "provA", lineId: "a-am", appointmentId: "a-am" }),
    line(11 * 60, 12 * 60, { providerId: "provA", lineId: "a-noon", appointmentId: "a-noon" })
  ]
});
const combo = api.recommendResourceAwareVisit([packedA, emptyB], [packedChair1, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA", "provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1", "chair-2"])] }),
    svc("pedi", 60, ["provA", "provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: 10 * 60
});
check("provider + resource non-greedy still finds a complete visit", combo && combo.valid && (combo.serviceLines || []).map(function (row) { return row.providerId; }).filter(function (id, idx, list) { return list.indexOf(id) === idx; }).length === 2 && assignmentOf(combo, "pedi", "chair").resourceId === "chair-1", combo);

// ---------------------------------------------------------------------------
// MULTIPLE REQUIREMENTS / BUFFERS / SPLIT SHIFT
// ---------------------------------------------------------------------------

const room1 = makeResource({ resourceId: "room-1", resourceType: "massage_room" });
const device1 = makeResource({ resourceId: "device-1", resourceType: "device" });
const both = api.recommendResourceAwareVisit([emptyA, emptyB], [room1, device1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("facial", 60, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("room", ["room-1"]), req("device", ["device-1"])]
    })
  ],
  preferredStartMin: 10 * 60
});
check("one service can require room and device together", both && assignmentOf(both, "facial", "room").resourceId === "room-1" && assignmentOf(both, "facial", "device").resourceId === "device-1");
const busyDevice = makeResource({
  resourceId: "device-1",
  resourceType: "device",
  occupied: [{ occupancyId: "used", startMin: 10 * 60, endMin: 11 * 60 }]
});
check("missing either of two required resources invalidates the candidate", api.recommendResourceAwareVisit([emptyA, emptyB], [room1, busyDevice], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("facial", 60, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("room", ["room-1"]), req("device", ["device-1"])]
    })
  ],
  preferredStartMin: 10 * 60
}) === null);

const bufferedRoom = makeResource({ resourceId: "room-a", resourceType: "massage_room" });
const roomB = makeResource({ resourceId: "room-b", resourceType: "massage_room" });
const bufferSame = {
  serviceLines: [
    svc("massage", 60, ["provA"], {
      resourceRequirements: [req("room", ["room-a"], { bufferAfterMinutes: 15 })]
    }),
    svc("next", 30, ["provB"], {
      resourceRequirements: [req("room", ["room-a"])]
    })
  ],
  preferredStartMin: 10 * 60
};
const bufferReq = {
  serviceLines: [
    svc("massage", 60, ["provA"], {
      resourceRequirements: [req("room", ["room-a"], { bufferAfterMinutes: 15 })]
    }),
    svc("next", 30, ["provB"], {
      resourceRequirements: [req("room", ["room-a", "room-b"])]
    })
  ],
  preferredStartMin: 10 * 60
};
check("same room is still busy during buffer after 11:00", api.recommendResourceAwareVisit([emptyA, emptyB], [bufferedRoom], bufferSame) === null);
const bufferAlt = api.recommendResourceAwareVisit([emptyA, emptyB], [bufferedRoom, roomB], bufferReq);
check("later block can use an alternative room while Room A is in cleanup", bufferAlt && assignmentOf(bufferAlt, "massage", "room").resourceId === "room-a" && assignmentOf(bufferAlt, "next", "room").resourceId === "room-b" && assignmentOf(bufferAlt, "massage", "room").reservationEndMin === 11 * 60 + 15, bufferAlt);

const beforeReq = {
  serviceLines: [
    svc("one", 60, ["provA"], {
      resourceRequirements: [req("room", ["room-a"], { bufferBeforeMinutes: 15 })]
    }),
    svc("two", 30, ["provB"])
  ],
  preferredStartMin: 10 * 60
};
const beforeBusy = makeResource({
  resourceId: "room-a",
  resourceType: "massage_room",
  occupied: [{ occupancyId: "early", startMin: 9 * 60 + 30, endMin: 9 * 60 + 50 }]
});
check("bufferBefore requires the resource from 9:45", api.recommendResourceAwareVisit([emptyA, emptyB], [beforeBusy], beforeReq) === null);
const beforeOk = api.recommendResourceAwareVisit([emptyA, emptyB], [bufferedRoom], beforeReq);
check("bufferBefore 15 reserves from 9:45 when the first service starts at 10:00", beforeOk && assignmentOf(beforeOk, "one", "room").reservationStartMin === 9 * 60 + 45 && assignmentOf(beforeOk, "one", "room").serviceStartMin === 10 * 60);

const splitRoom = makeResource({
  resourceId: "room-split",
  resourceType: "massage_room",
  workingIntervals: [{ startMin: 10 * 60, endMin: 12 * 60 }, { startMin: 13 * 60, endMin: 17 * 60 }]
});
check("resource reservation cannot bridge a split-shift gap", api.recommendResourceAwareVisit([emptyA, emptyB], [splitRoom], {
  serviceLines: [
    svc("one", 45, ["provA"]),
    svc("two", 45, ["provB"], { resourceRequirements: [req("room", ["room-split"])] })
  ],
  preferredStartMin: 11 * 60 + 30
}) === null);

// ---------------------------------------------------------------------------
// PHASE 12 RULES / HISTORICAL DOUBLE BOOK / NO-RESOURCE REGRESSION
// ---------------------------------------------------------------------------

check("Phase 12 same-provider parallel uniqueness still holds", api.recommendResourceAwareVisit([emptyA], [chair1, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("pedi", 60, ["provA"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-2"])] })
  ],
  preferredStartMin: 10 * 60
}) === null);

const messy = makeResource({
  resourceId: "chair-messy",
  occupied: [
    { occupancyId: "x", startMin: 10 * 60, endMin: 11 * 60 },
    { occupancyId: "y", startMin: 10 * 60 + 30, endMin: 11 * 60 + 30 }
  ]
});
check("historical overlapping occupancies do not crash and remain busy", api.recommendResourceAwareVisit([emptyA, emptyB], [messy], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 30, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("chair", ["chair-messy"])]
    })
  ],
  preferredStartMin: 10 * 60
}) === null);

const noResReq = {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g" })
  ],
  preferredStartMin: 10 * 60
};
const phase12 = api.recommendParallelMultiServiceVisit([emptyA, emptyB], noResReq);
const phase13 = api.recommendResourceAwareVisit([emptyA, emptyB], [], noResReq);
check("no resource requirements stay consistent with Phase 12", phase12 && phase13 && phase13.valid && phase13.visitStartMin === phase12.visitStartMin && phase13.parallelVisitPlanScore === phase12.parallelVisitPlanScore && phase13.resourceAwareVisitPlanScore === phase12.parallelVisitPlanScore && (phase13.serviceLines || []).every(function (row) { return (row.resourceAssignments || []).length === 0; }));

const late = api.rankResourceAwareVisitPlans([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"])] }),
    svc("late", 60, ["provA"], { resourceRequirements: [req("chair", ["chair-1"])] })
  ],
  preferredStartMin: 17 * 60
});
check("if the final service lacks a feasible resource the whole candidate fails", late.length === 0);

check("operational score has no resource bonus/penalty field", basic && basic.resourceAwareVisitPlanScore === basic.parallelVisitPlanScore && !("resourceScore" in basic));

// ---------------------------------------------------------------------------
// BOUNDS / VALIDATION / IMMUTABILITY
// ---------------------------------------------------------------------------

const bound = api.rankResourceAwareVisitPlans([emptyA, emptyB], [chair1, chair2], {
  serviceLines: [
    svc("mani", 30, ["provA"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1", "chair-2"])] }),
    svc("pedi", 30, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1", "chair-2"])] })
  ]
}, { maxVisitStartCandidates: 2, maxResourcesPerRequirement: 2, maxBlockAssignments: 2, maxEvaluatedVisitPlans: 2 });
check("bounded search reports Phase 13 resource limits", bound[0] && bound[0].searchMetadata.maxResourcesPerRequirement === 2 && bound[0].searchMetadata.maxResourceRequirementsPerLine === 2 && bound[0].searchMetadata.maxBlockAssignments === 2, bound[0] && bound[0].searchMetadata);
check("truncated search does not claim exhaustive optimality", bound[0] && bound[0].searchMetadata.truncated === true && bound[0].searchMetadata.exhaustive === false, bound[0] && bound[0].searchMetadata);

const reqSnap = JSON.stringify(basicReq);
check("duplicate resourceId is rejected", api.recommendResourceAwareVisit([emptyA], [chair1, makeResource({ resourceId: "chair-1" })], noResReq).reason === "duplicate_resource_id");
check("blank resourceId is rejected", api.recommendResourceAwareVisit([emptyA], [makeResource({ resourceId: "" })], noResReq).reason === "blank_resource_id");
check("mixed resource date/location is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [makeResource({ dateKey: "2026-09-15" })], basicReq).reason === "mixed_resource_location_or_date");
check("requirement references a missing resource", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-9"])] })
  ]
}).reason === "unknown_resource");
check("duplicate requirementKey inside a line is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1, chair2], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"]), req("chair", ["chair-2"])] })
  ]
}).reason === "duplicate_requirement_key");
check("blank requirementKey is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("", ["chair-1"])] })
  ]
}).reason === "blank_requirement_key");
check("empty eligibleResourceIds is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", [])] })
  ]
}).reason === "empty_eligible_resource_ids");
check("invalid specificResourceId is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"], { specificResourceId: "chair-9" })] })
  ]
}).reason === "invalid_specific_resource");
check("negative bufferBeforeMinutes is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"], { bufferBeforeMinutes: -5 })] })
  ]
}).reason === "negative_buffer_before");
check("negative bufferAfterMinutes is rejected", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], { parallelGroup: "g", resourceRequirements: [req("chair", ["chair-1"], { bufferAfterMinutes: -10 })] })
  ]
}).reason === "negative_buffer_after");
check("too many resource requirements is unsupported", api.recommendResourceAwareVisit([emptyA, emptyB], [chair1, chair2, makeResource({ resourceId: "chair-3" })], {
  serviceLines: [
    svc("mani", 60, ["provA"], { parallelGroup: "g" }),
    svc("pedi", 60, ["provB"], {
      parallelGroup: "g",
      resourceRequirements: [req("a", ["chair-1"]), req("b", ["chair-2"]), req("c", ["chair-3"])]
    })
  ]
}).reason === "too_many_resource_requirements_for_phase13");
check("malformed resource working interval is rejected", api.recommendResourceAwareVisit([emptyA], [makeResource({ workingIntervals: [{ startMin: 12 * 60, endMin: 10 * 60 }] })], noResReq).reason === "malformed_resource_working_interval");
check("malformed resource occupied interval is rejected", api.recommendResourceAwareVisit([emptyA], [makeResource({ occupied: [{ occupancyId: "bad", startMin: 10 * 60, endMin: 10 * 60 }] })], noResReq).reason === "malformed_resource_occupied_interval");

check("providerDays are unchanged", JSON.stringify(emptyA) === snapA);
check("resourceDays are unchanged", JSON.stringify(chair1) === snapChair);
check("request is unchanged", JSON.stringify(basicReq) === reqSnap);
check("same inputs yield the same logical result", JSON.stringify(basic) === JSON.stringify(api.recommendResourceAwareVisit([emptyA, emptyB], [chair1], basicReq)));

const src = fs.readFileSync(path.join(root, "public/booking/smart-scheduling/resource-aware-multi-service.js"), "utf8");
check("purity: no Firebase APIs", !/firebase-firestore|getDocs\s*\(|onSnapshot\s*\(|updateDoc\s*\(|addDoc\s*\(/.test(src));
check("purity: no network", !/\bfetch\s*\(|XMLHttpRequest/.test(src));
check("purity: no writes / timers / Date", !/\bsetTimeout\b|\bsetInterval\b|\bDate\s*\(|createAppointment|updateAppointment|cancelAppointment/.test(src));
check("purity: no DOM / Calendar / Reports", !/\bdocument\b|\blocalStorage\b|ffBookingCal|ffBookingReports/.test(src));
check("purity: no messaging / booking", !/sendSms|sendEmail|twilio|mailer|bookClient|autoBook|acceptLink/i.test(src));
check("does not rewrite Phase 11 / Phase 12 planners", !/function rankParallelMultiServiceVisitPlans/.test(src) && !/function rankMultiServiceVisitPlans/.test(src));

if (failed) {
  console.log("\n" + failed + " check(s) failed.");
  process.exit(1);
}
console.log("\nAll resource-aware visit checks passed.");
