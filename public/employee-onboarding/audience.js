/**
 * Employee Onboarding — Audience matching (v1).
 *
 * Package.audience:
 *   { workerClassifications: string[], technicianTypeIds: string[] }
 *
 * Both empty → Universal (matches everyone).
 * Dimensions are AND; technicianTypeIds are OR within the list.
 */

function _normStr(v) {
  return String(v == null ? "" : v).trim();
}

function _normStrList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of arr) {
    const s = _normStr(raw);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function _normClassificationList(arr) {
  return _normStrList(arr)
    .map((s) => s.toLowerCase())
    .filter((s) => s === "w2" || s === "1099");
}

/**
 * Normalize audience payload for save / compare.
 */
export function ffNormalizeOnboardingAudience(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    workerClassifications: _normClassificationList(src.workerClassifications),
    technicianTypeIds: _normStrList(src.technicianTypeIds),
  };
}

export function ffIsUniversalOnboardingAudience(audience) {
  const a = ffNormalizeOnboardingAudience(audience);
  return a.workerClassifications.length === 0 && a.technicianTypeIds.length === 0;
}

/**
 * @param {object} packageOrAudience - package with .audience, or audience object itself
 * @param {object} staff - staff row with workerClassification / technicianTypes
 */
export function ffMatchesOnboardingAudience(packageOrAudience, staff) {
  const audience =
    packageOrAudience && packageOrAudience.audience
      ? packageOrAudience.audience
      : packageOrAudience;
  const a = ffNormalizeOnboardingAudience(audience);

  if (a.workerClassifications.length === 0 && a.technicianTypeIds.length === 0) {
    return true;
  }

  const staffWc = _normStr(
    staff && (staff.workerClassification || staff.worker_classification)
  ).toLowerCase();
  const staffTypes = _normStrList(
    staff && (staff.technicianTypes || staff.technicianTypeIds)
  );

  const wcOk =
    a.workerClassifications.length === 0 ||
    (!!staffWc && a.workerClassifications.indexOf(staffWc) !== -1);

  let ttOk = true;
  if (a.technicianTypeIds.length > 0) {
    ttOk = a.technicianTypeIds.some((id) => staffTypes.indexOf(id) !== -1);
  }

  return !!(wcOk && ttOk);
}

export function ffDescribeOnboardingAudience(audience, technicianTypesById) {
  const a = ffNormalizeOnboardingAudience(audience);
  if (ffIsUniversalOnboardingAudience(a)) return "Universal (all staff)";

  const parts = [];
  if (a.workerClassifications.length) {
    parts.push(
      "Classification: " +
        a.workerClassifications
          .map((c) => (c === "w2" ? "W-2" : c === "1099" ? "1099" : c))
          .join(", ")
    );
  }
  if (a.technicianTypeIds.length) {
    const map = technicianTypesById && typeof technicianTypesById === "object"
      ? technicianTypesById
      : {};
    const labels = a.technicianTypeIds.map((id) => {
      const t = map[id];
      return (t && t.name) || id;
    });
    parts.push("Technician types: " + labels.join(", "));
  }
  return parts.join(" · ");
}

/**
 * Filter packages that match a real staff row (Stage B helper; no Runs yet).
 * Inactive packages are excluded by default.
 */
export function ffFilterOnboardingPackagesForStaff(packages, staff, opts) {
  const list = Array.isArray(packages) ? packages : [];
  const includeInactive = !!(opts && opts.includeInactive);
  return list.filter((pkg) => {
    if (!pkg || typeof pkg !== "object") return false;
    if (!includeInactive && pkg.active === false) return false;
    return ffMatchesOnboardingAudience(pkg, staff);
  });
}

if (typeof window !== "undefined") {
  window.ffNormalizeOnboardingAudience = ffNormalizeOnboardingAudience;
  window.ffIsUniversalOnboardingAudience = ffIsUniversalOnboardingAudience;
  window.ffMatchesOnboardingAudience = ffMatchesOnboardingAudience;
  window.ffDescribeOnboardingAudience = ffDescribeOnboardingAudience;
  window.ffFilterOnboardingPackagesForStaff = ffFilterOnboardingPackagesForStaff;
}
