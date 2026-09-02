/**
 * Employee Onboarding Runs — create / activate / cancel / skip / get.
 */

import {
  getDocs,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import {
  _createLocks,
  _actionLocks,
  _salonId,
  _trim,
  runsCol,
  tasksCol,
  ffCanManageOnboardingRunsClient,
} from "./run-cloud-shared.js?v=20260812_od_s5";
import {
  ffOnboardingCall,
  ffOnboardingCallError,
} from "./onboarding-cf.js?v=20260812_od_s5";

export async function ffGetOnboardingRuns(staffId) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  if (!salonId || !sid) return [];
  try {
    const snap = await getDocs(runsCol(salonId, sid));
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => {
        const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : Number(a.createdAtMs || 0);
        const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : Number(b.createdAtMs || 0);
        return tb - ta;
      });
  } catch (e) {
    console.warn("[OnboardingRun] get runs failed", e);
    return [];
  }
}

export async function ffGetOnboardingRunTasks(staffId, runId) {
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  if (!salonId || !sid || !rid) return [];
  try {
    const snap = await getDocs(tasksCol(salonId, sid, rid));
    return snap.docs
      .map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  } catch (e) {
    console.warn("[OnboardingRun] get tasks failed", e);
    return [];
  }
}

/**
 * Create a draft run from a package (snapshot). Idempotent against double-click via lock key.
 */
export async function ffCreateOnboardingRunFromPackage({
  staffId,
  packageId,
  dueDate,
  templates,
  categories,
  pkg,
} = {}) {
  void templates;
  void categories;
  const salonId = _salonId();
  const sid = _trim(staffId);
  const pid = _trim(packageId);
  if (!salonId || !sid || !pid) throw new Error("Missing salon, staff, or package");
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");

  const lockKey = `${salonId}::${sid}::create::${pid}`;
  if (_createLocks.has(lockKey)) throw new Error("Create already in progress");
  _createLocks.add(lockKey);
  try {
    const packageRow = pkg || null;
    if (!packageRow || packageRow.id !== pid) {
      throw new Error("Package snapshot required");
    }
    const out = await ffOnboardingCall("createOnboardingRunFromPackage", {
      salonId,
      staffId: sid,
      packageId: pid,
      dueDate: dueDate || null,
    });
    const runId = out && out.runId;
    return { runId, run: { id: runId }, tasks: [] };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not start onboarding"));
  } finally {
    _createLocks.delete(lockKey);
  }
}

export async function ffActivateOnboardingRun(staffId, runId) {
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  try {
    const out = await ffOnboardingCall("activateOnboardingRun", {
      salonId,
      staffId: sid,
      runId: rid,
    });
    return { id: rid, status: out && out.status };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not activate onboarding"));
  }
}

export async function ffCancelOnboardingRun(staffId, runId) {
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  try {
    await ffOnboardingCall("cancelOnboardingRun", {
      salonId,
      staffId: sid,
      runId: rid,
    });
    return { id: rid, status: "cancelled" };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Could not cancel onboarding"));
  }
}

export async function ffSkipOnboardingTask(staffId, runId, taskId) {
  if (!ffCanManageOnboardingRunsClient()) throw new Error("Permission denied");
  const salonId = _salonId();
  const sid = _trim(staffId);
  const rid = _trim(runId);
  const tid = _trim(taskId);
  const lock = `${salonId}::${sid}::${rid}::${tid}::skip`;
  if (_actionLocks.has(lock)) return null;
  _actionLocks.add(lock);
  try {
    await ffOnboardingCall("skipOnboardingTask", {
      salonId,
      staffId: sid,
      runId: rid,
      taskId: tid,
    });
    return { ok: true };
  } catch (e) {
    throw new Error(ffOnboardingCallError(e, "Skip failed"));
  } finally {
    _actionLocks.delete(lock);
  }
}

