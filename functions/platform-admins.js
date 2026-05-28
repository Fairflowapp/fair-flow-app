const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const functions = require("firebase-functions");

const REGION = "us-central1";
const ROLES = new Set(["owner", "admin", "support", "billing", "readonly"]);
const PERMISSIONS = Object.freeze({
  customers: "customers",
  customer360: "customer360",
  support: "support",
  billing: "billing",
  taxMonitoring: "taxMonitoring",
  platformHealth: "platformHealth",
  team: "team",
  alerts: "alerts",
  settings: "settings",
  admins: "admins",
  manageAdmins: "manageAdmins",
  manageRoles: "manageRoles",
});
const PERMANENT_OWNER_EMAILS = new Set(["shiri@fairflowapp.com"]);

const DEFAULT_PERMISSIONS_BY_ROLE = Object.freeze({
  owner: Object.fromEntries(Object.values(PERMISSIONS).map((key) => [key, true])),
  admin: {
    customers: true,
    customer360: true,
    support: true,
    billing: true,
    taxMonitoring: true,
    platformHealth: true,
    team: true,
    alerts: true,
    settings: true,
    admins: false,
    manageAdmins: false,
    manageRoles: false,
  },
  support: {
    customers: true,
    customer360: true,
    support: true,
    billing: false,
    taxMonitoring: false,
    platformHealth: true,
    team: false,
    alerts: true,
    settings: false,
    admins: false,
    manageAdmins: false,
    manageRoles: false,
  },
  billing: {
    customers: true,
    customer360: true,
    support: false,
    billing: true,
    taxMonitoring: true,
    platformHealth: false,
    team: false,
    alerts: true,
    settings: false,
    admins: false,
    manageAdmins: false,
    manageRoles: false,
  },
  readonly: {
    customers: true,
    customer360: true,
    support: true,
    billing: true,
    taxMonitoring: true,
    platformHealth: true,
    team: true,
    alerts: true,
    settings: false,
    admins: false,
    manageAdmins: false,
    manageRoles: false,
  },
});

const OWNER_PERMISSIONS = Object.freeze(Object.fromEntries(Object.values(PERMISSIONS).map((key) => [key, true])));

function normalizeRole(raw) {
  const role = String(raw || "readonly").trim().toLowerCase();
  if (!ROLES.has(role)) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid platform admin role.");
  }
  return role;
}

function normalizePermissions(role, rawPermissions = {}) {
  const defaults = DEFAULT_PERMISSIONS_BY_ROLE[role] || DEFAULT_PERMISSIONS_BY_ROLE.readonly;
  const out = { ...defaults };
  Object.values(PERMISSIONS).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(rawPermissions || {}, key)) {
      out[key] = rawPermissions[key] === true;
    }
  });
  if (role === "owner") {
    Object.values(PERMISSIONS).forEach((key) => {
      out[key] = true;
    });
  }
  return out;
}

function publicAdminDoc(uid, data = {}) {
  const role = normalizeRole(data.role || "readonly");
  return {
    uid,
    email: String(data.email || "").trim().toLowerCase(),
    name: String(data.name || "").trim(),
    role,
    active: data.active === true,
    permissions: normalizePermissions(role, data.permissions || {}),
    primaryOwner: data.primaryOwner === true || isPermanentOwnerEmail(data.email),
    createdAt: data.createdAt || null,
    createdBy: data.createdBy || "",
    updatedAt: data.updatedAt || null,
    updatedBy: data.updatedBy || "",
    lastLoginAt: data.lastLoginAt || null,
  };
}

async function getAuthEmail(auth) {
  const tokenEmail = String(auth?.token?.email || "").trim().toLowerCase();
  if (tokenEmail) return tokenEmail;
  if (!auth?.uid) return "";
  try {
    const user = await admin.auth().getUser(auth.uid);
    return String(user.email || "").trim().toLowerCase();
  } catch (err) {
    console.warn("[platform admins] could not resolve auth email", {
      uid: auth.uid,
      code: err?.code || "",
      message: err?.message || String(err),
    });
    return "";
  }
}

function isPermanentOwnerEmail(email) {
  return PERMANENT_OWNER_EMAILS.has(String(email || "").trim().toLowerCase());
}

async function ensurePermanentOwner(auth) {
  const email = await getAuthEmail(auth);
  if (!isPermanentOwnerEmail(email)) return null;
  console.log("[platform admins] BOOTSTRAP OWNER START", {
    uid: auth.uid,
    email,
  });

  const ref = admin.firestore().doc(`platformAdmins/${auth.uid}`);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : {};
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    email,
    name: String(existing.name || auth.token?.name || auth.token?.displayName || "Shiri").trim(),
    role: "owner",
    active: true,
    permissions: { ...OWNER_PERMISSIONS },
    primaryOwner: true,
    createdAt: existing.createdAt || now,
    createdBy: existing.createdBy || "permanent-owner",
    updatedAt: now,
    updatedBy: "permanent-owner",
    lastLoginAt: now,
  };
  await ref.set(payload, { merge: true });
  console.log("[platform admins] BOOTSTRAP OWNER SUCCESS", {
    uid: auth.uid,
    email,
    primaryOwner: true,
  });
  return publicAdminDoc(auth.uid, payload);
}

async function getExistingAdmin(uid) {
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
  const snap = await admin.firestore().doc(`platformAdmins/${uid}`).get();
  if (!snap.exists) return null;
  return publicAdminDoc(uid, snap.data() || {});
}

async function migrateLegacyPlatformAdminIfNeeded(auth) {
  const ref = admin.firestore().doc(`platformAdmins/${auth.uid}`);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (data.role && data.active === true && data.permissions) {
    return publicAdminDoc(auth.uid, data);
  }
  if (data.active === false) {
    return publicAdminDoc(auth.uid, data);
  }
  const email = String(data.email || auth.token?.email || "").trim().toLowerCase();
  const name = String(data.name || auth.token?.name || auth.token?.displayName || email).trim();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    email,
    name,
    role: data.role || "owner",
    active: true,
    permissions: normalizePermissions(data.role || "owner", data.permissions || {}),
    createdAt: data.createdAt || now,
    createdBy: data.createdBy || auth.uid,
    updatedAt: now,
    updatedBy: auth.uid,
  };
  await ref.set(payload, { merge: true });
  console.warn("[platform admins] migrated legacy platform admin", {
    uid: auth.uid,
    email,
    role: payload.role,
  });
  return publicAdminDoc(auth.uid, payload);
}

async function getActiveAdmin(uid) {
  const adminDoc = await getExistingAdmin(uid);
  if (!adminDoc || adminDoc.active !== true) {
    throw new functions.https.HttpsError("permission-denied", "Console admin access required.");
  }
  return adminDoc;
}

async function assertOwner(uid) {
  const actor = await getActiveAdmin(uid);
  if (actor.role !== "owner") {
    throw new functions.https.HttpsError("permission-denied", "Console owner role required.");
  }
  return actor;
}

async function maybeBootstrapFirstOwner(auth) {
  const fs = admin.firestore();
  const existing = await fs.collection("platformAdmins").limit(1).get();
  if (!existing.empty) return null;

  const email = String(auth.token?.email || "").trim().toLowerCase();
  if (!email) {
    throw new functions.https.HttpsError("permission-denied", "Email is required for first console owner bootstrap.");
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const payload = {
    email,
    name: String(auth.token?.name || auth.token?.displayName || email).trim(),
    role: "owner",
    active: true,
    permissions: normalizePermissions("owner"),
    createdAt: now,
    createdBy: auth.uid,
    updatedAt: now,
    updatedBy: auth.uid,
    lastLoginAt: now,
  };
  await fs.doc(`platformAdmins/${auth.uid}`).set(payload, { merge: true });
  console.warn("[platform admins] bootstrapped first owner", { uid: auth.uid, email });
  return publicAdminDoc(auth.uid, payload);
}

exports.getPlatformAdminSessionV1 = functions.region(REGION).https.onCall(
  async (_data, context) => {
    const auth = context.auth;
    if (!auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
    console.log("[platform admins] session check started", {
      uid: auth.uid,
      tokenEmail: String(auth.token?.email || "").trim().toLowerCase(),
    });

    let adminDoc = await ensurePermanentOwner(auth);
    if (!adminDoc) {
      adminDoc = await migrateLegacyPlatformAdminIfNeeded(auth);
    }
    if (!adminDoc) {
      throw new functions.https.HttpsError("permission-denied", "Access Denied.");
    }
    if (adminDoc.active !== true) {
      throw new functions.https.HttpsError("failed-precondition", "Access Disabled.");
    }

    await admin.firestore().doc(`platformAdmins/${auth.uid}`).set(
      {
        lastLoginAt: admin.firestore.FieldValue.serverTimestamp(),
        email: adminDoc.email || String(auth.token?.email || "").trim().toLowerCase(),
      },
      { merge: true }
    );
    console.log("[platform admins] session check succeeded", {
      uid: auth.uid,
      email: adminDoc.email,
      role: adminDoc.role,
      active: adminDoc.active,
      primaryOwner: adminDoc.primaryOwner === true,
    });
    return { ok: true, admin: adminDoc };
  }
);

exports.listPlatformAdminsV1 = functions.region(REGION).https.onCall(
  async (_data, context) => {
    const auth = context.auth;
    if (!auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
    await assertOwner(auth.uid);

    const snap = await admin.firestore().collection("platformAdmins").orderBy("email").get();
    return {
      ok: true,
      admins: snap.docs.map((doc) => publicAdminDoc(doc.id, doc.data() || {})),
    };
  }
);

exports.savePlatformAdminV1 = functions.region(REGION).https.onCall(
  async (data, context) => {
    const auth = context.auth;
    if (!auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
    await assertOwner(auth.uid);

    data = data || {};
    const email = String(data.email || "").trim().toLowerCase();
    const name = String(data.name || "").trim();
    let role = normalizeRole(data.role || "readonly");
    let active = data.active !== false;
    let permissions = normalizePermissions(role, data.permissions || {});
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new functions.https.HttpsError("invalid-argument", "Valid email required.");
    }

    let userRecord;
    let createdAuthUser = false;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (err) {
      if (err?.code !== "auth/user-not-found") throw err;
      userRecord = await admin.auth().createUser({
        email,
        displayName: name || email,
        emailVerified: false,
        disabled: false,
      });
      createdAuthUser = true;
    }

    const targetUid = userRecord.uid;
    const existing = await getExistingAdmin(targetUid);
    if (targetUid === auth.uid && existing?.role === "owner" && (role !== "owner" || active !== true)) {
      throw new functions.https.HttpsError("failed-precondition", "Owner cannot remove their own owner access.");
    }
    if (isPermanentOwnerEmail(email)) {
      role = "owner";
      active = true;
      permissions = { ...OWNER_PERMISSIONS };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const payload = {
      email,
      name: name || userRecord.displayName || email,
      role,
      active,
      permissions,
      primaryOwner: isPermanentOwnerEmail(email) || existing?.primaryOwner === true,
      updatedAt: now,
      updatedBy: auth.uid,
    };
    if (!existing) {
      payload.createdAt = now;
      payload.createdBy = auth.uid;
    }

    await admin.firestore().doc(`platformAdmins/${targetUid}`).set(payload, { merge: true });

    let resetLink = "";
    if (createdAuthUser) {
      try {
        resetLink = await admin.auth().generatePasswordResetLink(email);
      } catch (err) {
        console.warn("[platform admins] password reset link failed", {
          email,
          message: err?.message || String(err),
        });
      }
    }

    console.log("[platform admins] saved", {
      actorUid: auth.uid,
      targetUid,
      email,
      role,
      active,
      createdAuthUser,
    });
    return { ok: true, uid: targetUid, createdAuthUser, resetLink };
  }
);

exports.setPlatformAdminActiveV1 = functions.region(REGION).https.onCall(
  async (data, context) => {
    const auth = context.auth;
    if (!auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
    await assertOwner(auth.uid);

    const uid = String(data?.uid || "").trim();
    const active = data?.active === true;
    if (!uid) throw new functions.https.HttpsError("invalid-argument", "uid required.");

    const existing = await getExistingAdmin(uid);
    if (!existing) throw new functions.https.HttpsError("not-found", "Platform admin not found.");
    if (uid === auth.uid && existing.role === "owner" && active !== true) {
      throw new functions.https.HttpsError("failed-precondition", "Owner cannot deactivate their own owner access.");
    }
    if (isPermanentOwnerEmail(existing.email) && active !== true) {
      throw new functions.https.HttpsError("failed-precondition", "Permanent console owner cannot be deactivated.");
    }

    await admin.firestore().doc(`platformAdmins/${uid}`).set(
      {
        active,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: auth.uid,
      },
      { merge: true }
    );
    return { ok: true, uid, active };
  }
);
