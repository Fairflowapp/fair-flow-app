/**
 * One-shot backfill: rebuild empty catalog.{tab} for neo nails - Miami
 * tasksState docs from active ∪ pending ∪ done (template fields only).
 *
 * Usage:
 *   node functions/scripts/backfill-neo-tasks-catalog.js --dryRun
 *   node functions/scripts/backfill-neo-tasks-catalog.js --apply
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS or an authorized-user ADC JSON.
 * Project: fairflowapp-db841 (hard-coded for this one-shot).
 */

const admin = require("firebase-admin");

const PROJECT = "fairflowapp-db841";
const SALON_ID = "Zmqs7MrHe4vgscfiCtNF";
const DOC_IDS = ["flilBCMfI7ASfZ0paJbg", "default", "hdy6nzY6onSHrjk2xR7Q"];
const TABS = ["opening", "closing", "weekly", "monthly", "yearly"];

const TEMPLATE_KEYS = [
  "id",
  "taskId",
  "title",
  "instructions",
  "assignTo",
  "technicianTypes",
  "isOneTime",
  "oneTimeDate",
  "scheduleWeekdays",
  "scheduleDayOfMonth",
  "scheduleMonth",
  "scheduleDay",
  "scheduleYear",
];

function parseArgs(argv) {
  const dryRun = argv.includes("--dryRun") || !argv.includes("--apply");
  const apply = argv.includes("--apply");
  return { dryRun: dryRun && !apply, apply };
}

function rowId(row) {
  return String((row && (row.taskId || row.id)) || "").trim();
}

function isTombstoned(tombstone, tab, id) {
  if (!tombstone || typeof tombstone !== "object" || !id) return false;
  const tabTomb = tombstone[tab];
  if (!tabTomb || typeof tabTomb !== "object") return false;
  if (tabTomb[id] === true) return true;
  if (Array.isArray(tabTomb) && tabTomb.map(String).includes(id)) return true;
  return false;
}

function toTemplateRow(row) {
  const id = rowId(row);
  if (!id) return null;
  const out = { id, taskId: id };
  for (const key of TEMPLATE_KEYS) {
    if (key === "id" || key === "taskId") continue;
    if (row[key] !== undefined && row[key] !== null) out[key] = row[key];
  }
  if (!out.title) out.title = "";
  if (out.instructions == null && (row.info != null || row.details != null)) {
    out.instructions = row.info || row.details || "";
  }
  return out;
}

function buildCatalogTab(data, tab) {
  const tabState = (data && data[tab]) || {};
  const tombstone = (data && data.tombstone) || {};
  const lists = ["active", "pending", "done"];
  const byId = new Map();
  for (const kind of lists) {
    const rows = Array.isArray(tabState[kind]) ? tabState[kind] : [];
    for (const row of rows) {
      const id = rowId(row);
      if (!id || isTombstoned(tombstone, tab, id)) continue;
      if (!byId.has(id)) {
        const tmpl = toTemplateRow(row);
        if (tmpl) byId.set(id, tmpl);
      }
    }
  }
  return Array.from(byId.values());
}

function listLens(data, tab) {
  const t = (data && data[tab]) || {};
  const uniq = new Set();
  for (const kind of ["active", "pending", "done"]) {
    for (const row of Array.isArray(t[kind]) ? t[kind] : []) {
      const id = rowId(row);
      if (id) uniq.add(id);
    }
  }
  return {
    active: Array.isArray(t.active) ? t.active.length : 0,
    pending: Array.isArray(t.pending) ? t.pending.length : 0,
    done: Array.isArray(t.done) ? t.done.length : 0,
    uniqueIds: uniq.size,
  };
}

async function main() {
  const { dryRun, apply } = parseArgs(process.argv.slice(2));
  if (!admin.apps.length) {
    admin.initializeApp({ projectId: PROJECT });
  }
  const db = admin.firestore();

  console.log(JSON.stringify({ project: PROJECT, salonId: SALON_ID, dryRun, apply }, null, 2));

  const report = [];
  for (const docId of DOC_IDS) {
    const ref = db.collection("salons").doc(SALON_ID).collection("tasksState").doc(docId);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`MISSING ${docId}`);
      continue;
    }
    const data = snap.data() || {};
    const catalog = (data.catalog && typeof data.catalog === "object") ? { ...data.catalog } : {};
    const updateCatalog = { ...catalog };
    const docReport = { docId, tabs: {} };
    let touched = false;

    for (const tab of TABS) {
      const existing = Array.isArray(catalog[tab]) ? catalog[tab] : [];
      const built = buildCatalogTab(data, tab);
      const lenses = listLens(data, tab);
      const tabReport = {
        existingCatalogLen: existing.length,
        listLens: `${lenses.active}/${lenses.pending}/${lenses.done}`,
        uniqueListIds: lenses.uniqueIds,
        builtLen: built.length,
        titles: built.map((r) => r.title || r.taskId),
        action: "skip",
      };
      if (existing.length > 0) {
        tabReport.action = "skip-nonempty-catalog";
      } else if (built.length === 0) {
        tabReport.action = "skip-nothing-to-build";
        updateCatalog[tab] = existing.length ? existing : [];
      } else {
        tabReport.action = dryRun ? "would-write" : "write";
        updateCatalog[tab] = built;
        touched = true;
      }
      docReport.tabs[tab] = tabReport;
    }

    report.push(docReport);

    if (touched && apply) {
      const curRev = (typeof data.rev === "number" && data.rev >= 0) ? data.rev : 0;
      await ref.update({
        catalog: updateCatalog,
        lastUpdateReason: "catalog-backfill",
        lastUpdatedByUid: "server:catalog-backfill",
        rev: curRev + 1,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`WROTE ${docId} rev ${curRev + 1}`);
    }
  }

  for (const doc of report) {
    console.log(`\n===== ${doc.docId} =====`);
    for (const tab of TABS) {
      const t = doc.tabs[tab];
      if (!t) continue;
      if (t.action === "skip-nothing-to-build" && t.uniqueListIds === 0 && t.existingCatalogLen === 0) continue;
      console.log(
        `${tab}: lists=${t.listLens} uniqueIds=${t.uniqueListIds} ` +
        `catalogWas=${t.existingCatalogLen} built=${t.builtLen} → ${t.action}`
      );
      if (t.titles && t.titles.length) {
        t.titles.forEach((title, i) => console.log(`  ${i + 1}. ${title}`));
      }
    }
  }

  console.log("\nDONE", dryRun ? "(dryRun — no writes)" : "(applied)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
