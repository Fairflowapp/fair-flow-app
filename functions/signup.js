const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");

if (!admin.apps.length) admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const TEAM_SIZES = new Set(["1", "2-5", "6-15", "16+"]);
const SERVICES = new Set([
  "Nail services",
  "Hair & styling",
  "Facials & skincare",
  "Massages",
  "Lashes & eyebrows",
  "Waxing & sugaring",
  "Barbering",
  "Makeup",
  "Med spa",
  "Other",
]);
const CURRENT_SOLUTIONS = new Set([
  "Pen & paper",
  "Spreadsheets",
  "Another software",
  "Just getting started",
]);
const REFERRAL_SOURCES = new Set(["Instagram", "Google", "A friend", "Other"]);

function cleanString(value) {
  return String(value || "").trim();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function generateDefaultAdminPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function ownerDefaultPermissions() {
  return {
    queue_view: true,
    queue_manage: true,
    queue_locked_view: false,
    tickets_view: true,
    tickets_manage: true,
    tasks_view: true,
    tasks_use: true,
    tasks_manage: true,
    tasks_reset: true,
    chat_view: true,
    chat_manage: true,
    chat_free_text: true,
    inbox_view: true,
    inbox_manage: true,
    inbox_send: true,
    media_view: true,
    media_manage: true,
    inventory_view: true,
    inventory_manage: true,
    schedule_view: true,
    schedule_manage: true,
    training_view: true,
    training_manage: true,
    settings_view: true,
    settings_manage: true,
    staff_view: true,
    staff_manage: true,
    history_view: true,
    history_export: true,
    history_clear: true,
  };
}

function parseInput(data) {
  const firstName = cleanString(data && data.firstName);
  const lastName = cleanString(data && data.lastName);
  const businessName = cleanString(data && data.businessName);
  const teamSize = cleanString(data && data.teamSize);
  const currentSolution = cleanString(data && data.currentSolution);
  const currentSolutionName = cleanString(data && data.currentSolutionName);
  const referralSource = cleanString(data && data.referralSource);
  const rawServices = Array.isArray(data && data.services) ? data.services : [];
  const services = rawServices
    .map((item) => cleanString(item))
    .filter(Boolean);

  if (!firstName) {
    throw new HttpsError("invalid-argument", "First name is required.");
  }
  if (!lastName) {
    throw new HttpsError("invalid-argument", "Last name is required.");
  }
  if (!businessName) {
    throw new HttpsError("invalid-argument", "Business name is required.");
  }
  if (!TEAM_SIZES.has(teamSize)) {
    throw new HttpsError("invalid-argument", "Team size is invalid.");
  }
  if (!services.length || services.some((service) => !SERVICES.has(service))) {
    throw new HttpsError("invalid-argument", "Select at least one valid service.");
  }
  if (currentSolution && !CURRENT_SOLUTIONS.has(currentSolution)) {
    throw new HttpsError("invalid-argument", "Current solution is invalid.");
  }
  if (referralSource && !REFERRAL_SOURCES.has(referralSource)) {
    throw new HttpsError("invalid-argument", "Referral source is invalid.");
  }

  return {
    firstName,
    lastName,
    businessName,
    services: Array.from(new Set(services)),
    teamSize,
    currentSolution,
    currentSolutionName: currentSolution === "Another software" ? currentSolutionName : "",
    referralSource,
  };
}

function onboardingOptionalFields(input) {
  const payload = {};
  if (input.currentSolution) payload.currentSolution = input.currentSolution;
  if (input.currentSolutionName) payload.currentSolutionName = input.currentSolutionName;
  if (input.referralSource) payload.referralSource = input.referralSource;
  return payload;
}

exports.createSalonAccount = onCall({ region: "us-central1" }, async (request) => {
  const context = { auth: request.auth };
  if (!context.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }

  const uid = context.auth.uid;
  const input = parseInput(request.data || {});
  const authUser = await admin.auth().getUser(uid);
  const email = normalizeEmail(authUser.email || context.auth.token?.email || "");
  const ownerName = `${input.firstName} ${input.lastName}`.trim();

  return db.runTransaction(async (tx) => {
    const userRef = db.collection("users").doc(uid);
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      const existingSalonId = cleanString((userSnap.data() || {}).salonId);
      if (existingSalonId) {
        const optionalOnboarding = onboardingOptionalFields(input);
        if (Object.keys(optionalOnboarding).length) {
          const onboardingPatch = {};
          Object.keys(optionalOnboarding).forEach((key) => {
            onboardingPatch[`onboarding.${key}`] = optionalOnboarding[key];
          });
          tx.set(db.collection("salons").doc(existingSalonId), onboardingPatch, { merge: true });
        }
        return { salonId: existingSalonId };
      }
    }

    const activeMemberships = await tx.get(
      userRef.collection("memberships")
        .where("status", "==", "active")
        .limit(1),
    );
    if (!activeMemberships.empty) {
      const membership = activeMemberships.docs[0];
      const existingSalonId = cleanString((membership.data() || {}).salonId || membership.id);
      if (existingSalonId) {
        const optionalOnboarding = onboardingOptionalFields(input);
        if (Object.keys(optionalOnboarding).length) {
          const onboardingPatch = {};
          Object.keys(optionalOnboarding).forEach((key) => {
            onboardingPatch[`onboarding.${key}`] = optionalOnboarding[key];
          });
          tx.set(db.collection("salons").doc(existingSalonId), onboardingPatch, { merge: true });
        }
        return { salonId: existingSalonId };
      }
    }

    const salonRef = db.collection("salons").doc();
    const salonId = salonRef.id;
    const staffId = `staff_${uid}`;
    const adminPin = generateDefaultAdminPin();
    const nowMs = Date.now();
    const serverNow = FieldValue.serverTimestamp();

    tx.set(salonRef, {
      name: input.businessName,
      ownerUid: uid,
      adminPin,
      createdAt: serverNow,
      plan: "trial",
      status: "active",
      accountStatus: "locked",
      accountStatusReason: "billing_required",
      accountStatusUpdatedAt: serverNow,
      onboarding: {
        services: input.services,
        teamSize: input.teamSize,
        ...onboardingOptionalFields(input),
        source: "website",
        completedAt: serverNow,
      },
    });

    tx.set(salonRef.collection("staff").doc(staffId), {
      id: staffId,
      uid,
      userId: uid,
      authUid: uid,
      memberId: uid,
      salonId,
      accountId: salonId,
      name: ownerName,
      firstName: input.firstName,
      lastName: input.lastName,
      email,
      emailLower: email,
      role: "owner",
      isAdmin: true,
      isManager: false,
      isArchived: false,
      invited: true,
      inviteStatus: "accepted",
      permissions: ownerDefaultPermissions(),
      technicianTypes: [],
      allowedLocationIds: [],
      primaryLocationId: null,
      createdAt: nowMs,
      updatedAt: serverNow,
      updatedAtMs: nowMs,
      _syncedAt: serverNow,
    });

    tx.set(salonRef.collection("members").doc(uid), {
      name: ownerName,
      email,
      emailLower: email,
      role: "owner",
      staffId,
      createdAt: serverNow,
      updatedAt: serverNow,
    });

    tx.set(salonRef.collection("settings").doc("main"), {
      ownerUid: uid,
      adminPin,
      brandName: input.businessName,
      updatedAt: serverNow,
    });

    tx.set(userRef, {
      role: "owner",
      salonId,
      staffId,
      name: ownerName,
      email,
      createdAt: serverNow,
      updatedAt: serverNow,
    }, { merge: true });

    tx.set(userRef.collection("memberships").doc(salonId), {
      salonId,
      staffId,
      role: "owner",
      status: "active",
      email,
      name: ownerName,
      source: "website_signup",
      updatedAt: serverNow,
    }, { merge: true });

    return { salonId };
  });
});
