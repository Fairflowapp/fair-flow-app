// inventory-devtools.js
// Browser-console diagnostic helpers for inventory multi-branch housekeeping.
// Extracted verbatim from inventory.js (Phase 16).

import { db } from "/app.js?v=20260610_force_lp_ios";
import { getDocs, collection, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { invState } from "./inventory-state.js?v=20260627_inventory_split";
import { getSalonId, _ffInvActiveLocId } from "./inventory-spine.js?v=20260701_inventory_spine_split";

if (typeof window !== "undefined") {
  // Lightweight diagnostic helper — run `ffInventoryDumpLocations()` from the
  // browser console to see every category & subcategory in Firestore grouped
  // by their stamped `locationId`. Useful when verifying multi-branch
  // separation end-to-end after bulk deletes/edits.
  /**
   * One-shot cleanup utility — removes inventory categories that have no
   * `locationId` stamp (and all of their subcategories). These are leftovers
   * from before multi-branch separation was wired up and are currently
   * invisible in every branch, so deleting them is a safe housekeeping step.
   * Returns `{ deletedCategories, deletedSubcategories }` for confirmation.
   */
  window.ffInventoryDeleteUnstampedCategories = async function ffInventoryDeleteUnstampedCategories() {
    try {
      const salonId = await getSalonId();
      if (!salonId) { alert("No salonId — cannot clean up."); return; }
      const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
      const orphans = catSnap.docs.filter((d) => {
        const lid = d.data()?.locationId;
        return !(typeof lid === "string" && lid.trim());
      });
      if (orphans.length === 0) { alert("Nothing to clean up — no unstamped categories found."); return { deletedCategories: 0, deletedSubcategories: 0 }; }

      const names = orphans.map((d) => d.data()?.name || "(unnamed)").join(", ");
      const ok = confirm(`Delete ${orphans.length} unstamped category(ies) and all of their subcategories?\n\n${names}\n\nThis cannot be undone.`);
      if (!ok) return "CANCELLED";

      let batch = writeBatch(db);
      let n = 0;
      const commits = [];
      let deletedSubs = 0;
      for (const c of orphans) {
        const subSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories/${c.id}/inventorySubcategories`));
        for (const s of subSnap.docs) {
          batch.delete(s.ref);
          deletedSubs++;
          if (++n >= 450) { commits.push(batch.commit()); batch = writeBatch(db); n = 0; }
        }
        batch.delete(c.ref);
        if (++n >= 450) { commits.push(batch.commit()); batch = writeBatch(db); n = 0; }
      }
      if (n > 0) commits.push(batch.commit());
      await Promise.all(commits);
      alert(`Cleanup done.\n\nDeleted ${orphans.length} category(ies) and ${deletedSubs} subcategory(ies).`);
      try { document.dispatchEvent(new CustomEvent("ff-active-location-changed")); } catch (_) {}
      return { deletedCategories: orphans.length, deletedSubcategories: deletedSubs };
    } catch (e) {
      console.error("[Inventory/cleanup] failed", e);
      alert("Cleanup failed: " + ((e && e.message) || e));
      return "ERROR";
    }
  };

  window.ffInventoryDumpLocations = async function ffInventoryDumpLocations() {
    try {
      const salonId = await getSalonId();
      if (!salonId) {
        console.warn("[Inventory/dump] No salonId resolved.");
        return "NO_SALON";
      }
      const active = _ffInvActiveLocId() || "(none)";
      const catSnap = await getDocs(collection(db, `salons/${salonId}/inventoryCategories`));
      const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const buckets = {};
      const detailed = [];
      for (const c of cats) {
        const key = typeof c.locationId === "string" && c.locationId.trim() ? c.locationId.trim() : "(unstamped)";
        if (!buckets[key]) buckets[key] = 0;
        buckets[key] += 1;
        detailed.push({ id: c.id, name: c.name || "(unnamed)", locationId: key });
      }

      const lines = [];
      lines.push(`active=${active}`);
      lines.push(`firestoreTotal=${cats.length}`);
      lines.push(`memoryTree=${(invState._categoryTree || []).length} cats (what the sidebar renders)`);
      lines.push(`bucketCount=${Object.keys(buckets).length}`);
      lines.push("--- by bucket ---");
      for (const [k, v] of Object.entries(buckets)) {
        lines.push(`  ${k}: ${v}`);
      }
      lines.push("--- in-memory tree (sidebar) ---");
      for (const c of (invState._categoryTree || [])) {
        lines.push(`  ${c.name || "(unnamed)"}  (id=${c.id}, subs=${(c.subcategories || []).length})`);
      }
      lines.push("--- firestore detailed ---");
      for (const d of detailed) {
        lines.push(`  ${d.locationId}  →  ${d.name}  (id=${d.id})`);
      }
      const report = lines.join("\n");
      // Alert guarantees visibility regardless of console filter levels
      try { alert("Inventory dump:\n\n" + report); } catch (_) {}
      console.warn("[Inventory/dump] " + report);
      return { active, total: cats.length, buckets, detailed };
    } catch (e) {
      console.error("[Inventory/dump] failed", e);
      try { alert("Inventory dump failed: " + ((e && e.message) || e)); } catch (_) {}
      return "ERROR";
    }
  };
}
