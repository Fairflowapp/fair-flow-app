/**
 * Employee Onboarding S5 — catalog write callables (categories / templates / packages).
 * Client Firestore writes for these collections become false after deploy.
 */
const { onCall } = require("firebase-functions/v2/https");
const {
  HttpsError,
  REGION,
  V1_TYPES,
  db,
  trimStr,
  requireAuth,
  assertCanManageOnboardingSettings,
  nameToId,
  uniqueDocId,
  normalizeAudience,
  normalizeTaskConfig,
  normalizePackageItems,
  nowTs,
} = require("./onboarding-writes-helpers");

function catCol(salonId) {
  return db().collection(`salons/${salonId}/onboardingCategories`);
}
function tmplCol(salonId) {
  return db().collection(`salons/${salonId}/onboardingTaskTemplates`);
}
function pkgCol(salonId) {
  return db().collection(`salons/${salonId}/onboardingPackages`);
}

async function maxSort(col) {
  const snap = await col.get();
  let max = -1;
  snap.docs.forEach((d) => {
    const n = Number((d.data() || {}).sortOrder);
    if (Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

exports.createOnboardingCategory = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const name = trimStr(request.data && request.data.name);
  if (!salonId || !name) {
    throw new HttpsError("invalid-argument", "Missing salonId or name.");
  }
  await assertCanManageOnboardingSettings(uid, salonId);
  const col = catCol(salonId);
  const id = await uniqueDocId(col, nameToId(name) || `cat_${Date.now()}`);
  const locationId = trimStr(request.data && request.data.locationId) || null;
  const row = {
    id,
    name,
    active: request.data && request.data.active === false ? false : true,
    sortOrder:
      request.data && Number.isFinite(Number(request.data.sortOrder))
        ? Number(request.data.sortOrder)
        : (await maxSort(col)) + 1,
    locationId,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  await col.doc(id).set(row);
  return { id, category: row };
});

exports.updateOnboardingCategory = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const categoryId = trimStr(request.data && request.data.categoryId);
  if (!salonId || !categoryId) {
    throw new HttpsError("invalid-argument", "Missing salonId or categoryId.");
  }
  await assertCanManageOnboardingSettings(uid, salonId);
  const ref = catCol(salonId).doc(categoryId);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Category not found.");
  const updates = request.data && request.data.updates ? request.data.updates : {};
  const patch = { updatedAt: nowTs() };
  if (updates.name !== undefined) {
    const name = trimStr(updates.name);
    if (!name) throw new HttpsError("invalid-argument", "Name cannot be empty.");
    patch.name = name;
  }
  if (updates.active !== undefined) patch.active = updates.active === true;
  if (updates.sortOrder !== undefined) patch.sortOrder = Number(updates.sortOrder) || 0;
  await ref.set(patch, { merge: true });
  return { id: categoryId, ok: true };
});

exports.deleteOnboardingCategory = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const categoryId = trimStr(request.data && request.data.categoryId);
  if (!salonId || !categoryId) {
    throw new HttpsError("invalid-argument", "Missing salonId or categoryId.");
  }
  await assertCanManageOnboardingSettings(uid, salonId);
  const tmpls = await tmplCol(salonId).get();
  const inUse = tmpls.docs.some(
    (d) => trimStr((d.data() || {}).categoryId) === categoryId
  );
  if (inUse) {
    throw new HttpsError(
      "failed-precondition",
      "Cannot delete: one or more task templates still use this category."
    );
  }
  await catCol(salonId).doc(categoryId).delete();
  return { ok: true, id: categoryId };
});

function assertTaskType(taskType, currentType) {
  if (!V1_TYPES.includes(taskType)) {
    throw new HttpsError(
      "invalid-argument",
      `taskType must be one of: ${V1_TYPES.join(", ")}`
    );
  }
  if (currentType && taskType !== currentType) {
    throw new HttpsError("failed-precondition", "taskType cannot be changed.");
  }
}

exports.createOnboardingTaskTemplate = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const payload = (request.data && request.data.payload) || request.data || {};
    const name = trimStr(payload.name);
    const taskType = trimStr(payload.taskType);
    if (!salonId || !name) {
      throw new HttpsError("invalid-argument", "Missing salonId or name.");
    }
    await assertCanManageOnboardingSettings(uid, salonId);
    assertTaskType(taskType);
    const config = normalizeTaskConfig(taskType, payload.config);
    const col = tmplCol(salonId);
    const id = await uniqueDocId(col, nameToId(name) || `tmpl_${Date.now()}`);
    const row = {
      id,
      name,
      taskType,
      categoryId: trimStr(payload.categoryId) || null,
      description: trimStr(payload.description),
      active: payload.active === false ? false : true,
      defaultRequired: payload.defaultRequired === false ? false : true,
      config,
      sortOrder: Number.isFinite(Number(payload.sortOrder))
        ? Number(payload.sortOrder)
        : (await maxSort(col)) + 1,
      locationId: trimStr(payload.locationId) || null,
      createdAt: nowTs(),
      updatedAt: nowTs(),
    };
    await col.doc(id).set(row);
    return { id, template: row };
  }
);

exports.updateOnboardingTaskTemplate = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const templateId = trimStr(request.data && request.data.templateId);
    if (!salonId || !templateId) {
      throw new HttpsError("invalid-argument", "Missing salonId or templateId.");
    }
    await assertCanManageOnboardingSettings(uid, salonId);
    const ref = tmplCol(salonId).doc(templateId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Template not found.");
    const current = snap.data() || {};
    const updates = (request.data && request.data.updates) || {};
    const taskType = trimStr(
      updates.taskType !== undefined ? updates.taskType : current.taskType
    );
    assertTaskType(taskType, current.taskType);
    const mergedConfig =
      updates.config !== undefined ? updates.config : current.config;
    const config = normalizeTaskConfig(taskType, mergedConfig);
    const name = trimStr(
      updates.name !== undefined ? updates.name : current.name
    );
    if (!name) throw new HttpsError("invalid-argument", "Name is required.");
    const patch = {
      name,
      taskType,
      categoryId:
        updates.categoryId !== undefined
          ? trimStr(updates.categoryId) || null
          : current.categoryId || null,
      description:
        updates.description !== undefined
          ? trimStr(updates.description)
          : trimStr(current.description),
      active:
        updates.active !== undefined
          ? updates.active === true
          : current.active !== false,
      defaultRequired:
        updates.defaultRequired !== undefined
          ? updates.defaultRequired !== false
          : current.defaultRequired !== false,
      config,
      updatedAt: nowTs(),
    };
    if (updates.sortOrder !== undefined) {
      patch.sortOrder = Number(updates.sortOrder) || 0;
    }
    await ref.set(patch, { merge: true });
    return { id: templateId, ok: true };
  }
);

exports.deleteOnboardingTaskTemplate = onCall(
  { region: REGION },
  async (request) => {
    const uid = requireAuth(request);
    const salonId = trimStr(request.data && request.data.salonId);
    const templateId = trimStr(request.data && request.data.templateId);
    if (!salonId || !templateId) {
      throw new HttpsError("invalid-argument", "Missing salonId or templateId.");
    }
    await assertCanManageOnboardingSettings(uid, salonId);
    const pkgs = await pkgCol(salonId).get();
    const inUse = pkgs.docs.some((d) => {
      const items = (d.data() || {}).items;
      return (
        Array.isArray(items) &&
        items.some((it) => it && trimStr(it.templateId) === templateId)
      );
    });
    if (inUse) {
      throw new HttpsError(
        "failed-precondition",
        "Cannot delete: this template is used in one or more packages."
      );
    }
    await tmplCol(salonId).doc(templateId).delete();
    return { ok: true, id: templateId };
  }
);

async function assertPackageEsignOk(salonId, items) {
  const list = normalizePackageItems(items);
  if (!list.length) {
    throw new HttpsError("invalid-argument", "Choose at least one item.");
  }
  const tmpls = await tmplCol(salonId).get();
  const byId = {};
  tmpls.docs.forEach((d) => {
    byId[d.id] = d.data() || {};
  });
  for (const it of list) {
    const tmpl = byId[it.templateId];
    if (!tmpl) {
      throw new HttpsError(
        "failed-precondition",
        `Unknown item "${it.templateId}".`
      );
    }
    if (tmpl.taskType !== "electronic_signature") continue;
    normalizeTaskConfig("electronic_signature", {
      ...(tmpl.config || {}),
      ...(it.configOverrides || {}),
    });
  }
}

exports.createOnboardingPackage = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const payload = (request.data && request.data.payload) || request.data || {};
  const name = trimStr(payload.name);
  if (!salonId || !name) {
    throw new HttpsError("invalid-argument", "Missing salonId or name.");
  }
  await assertCanManageOnboardingSettings(uid, salonId);
  const items = normalizePackageItems(payload.items);
  await assertPackageEsignOk(salonId, items);
  const col = pkgCol(salonId);
  const id = await uniqueDocId(col, nameToId(name) || `pkg_${Date.now()}`);
  const row = {
    id,
    name,
    description: trimStr(payload.description),
    active: payload.active === false ? false : true,
    audience: normalizeAudience(payload.audience),
    items,
    sortOrder: Number.isFinite(Number(payload.sortOrder))
      ? Number(payload.sortOrder)
      : (await maxSort(col)) + 1,
    locationId: trimStr(payload.locationId) || null,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  await col.doc(id).set(row);
  return { id, package: row };
});

exports.updateOnboardingPackage = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const packageId = trimStr(request.data && request.data.packageId);
  if (!salonId || !packageId) {
    throw new HttpsError("invalid-argument", "Missing salonId or packageId.");
  }
  await assertCanManageOnboardingSettings(uid, salonId);
  const ref = pkgCol(salonId).doc(packageId);
  if (!(await ref.get()).exists) throw new HttpsError("not-found", "Package not found.");
  const updates = (request.data && request.data.updates) || {};
  const patch = { updatedAt: nowTs() };
  if (updates.name !== undefined) {
    const name = trimStr(updates.name);
    if (!name) throw new HttpsError("invalid-argument", "Name cannot be empty.");
    patch.name = name;
  }
  if (updates.description !== undefined) patch.description = trimStr(updates.description);
  if (updates.active !== undefined) patch.active = updates.active === true;
  if (updates.audience !== undefined) patch.audience = normalizeAudience(updates.audience);
  if (updates.items !== undefined) {
    const items = normalizePackageItems(updates.items);
    await assertPackageEsignOk(salonId, items);
    patch.items = items;
  }
  if (updates.sortOrder !== undefined) patch.sortOrder = Number(updates.sortOrder) || 0;
  await ref.set(patch, { merge: true });
  return { id: packageId, ok: true };
});

exports.deleteOnboardingPackage = onCall({ region: REGION }, async (request) => {
  const uid = requireAuth(request);
  const salonId = trimStr(request.data && request.data.salonId);
  const packageId = trimStr(request.data && request.data.packageId);
  if (!salonId || !packageId) {
    throw new HttpsError("invalid-argument", "Missing salonId or packageId.");
  }
  await assertCanManageOnboardingSettings(uid, salonId);
  await pkgCol(salonId).doc(packageId).delete();
  return { ok: true, id: packageId };
});
