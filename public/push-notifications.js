import {
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260510_firestore_lp";

const LOG = "[PushNotifications]";
const DEVICE_ID_KEY = "ff_push_device_id_v1";

function getPushPlugin() {
  return window.Capacitor?.Plugins?.PushNotifications || null;
}

function isNativeApp() {
  try {
    return window.Capacitor?.isNativePlatform?.() === true;
  } catch (_) {
    return false;
  }
}

function getPlatform() {
  try {
    return window.Capacitor?.getPlatform?.() || "unknown";
  } catch (_) {
    return "unknown";
  }
}

function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch (_) {
    return `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function cleanDocPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

function readPushContext() {
  const diag = typeof window.ffStaffCallDiagSnapshot === "function"
    ? window.ffStaffCallDiagSnapshot()
    : null;
  const salonId = String(window.currentSalonId || diag?.salonId || "").trim();
  const staffId = String(diag?.ownStaffId || window.__ff_authedStaffId || localStorage.getItem("ff_authedStaffId_v1") || "").trim();
  const staffName = String(
    diag?.presence?.name ||
    window.__ff_authedStaffName ||
    sessionStorage.getItem("ff_actor_name") ||
    auth.currentUser?.displayName ||
    auth.currentUser?.email ||
    ""
  ).trim();
  return { salonId, staffId, staffName };
}

async function waitForPushContext(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ctx = readPushContext();
    if (ctx.salonId && ctx.staffId) return ctx;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return readPushContext();
}

async function saveToken(tokenValue) {
  const user = auth.currentUser;
  if (!user || !tokenValue) return;
  const ctx = await waitForPushContext();
  if (!ctx.salonId || !ctx.staffId) {
    console.warn(LOG, "token not saved, missing salon/staff context", ctx);
    return;
  }

  const deviceId = getDeviceId();
  const tokenDocId = `${cleanDocPart(ctx.staffId)}_${cleanDocPart(deviceId)}`;
  await setDoc(doc(db, `salons/${ctx.salonId}/staffDeviceTokens`, tokenDocId), {
    token: tokenValue,
    uid: user.uid,
    staffId: ctx.staffId,
    staffName: ctx.staffName,
    deviceId,
    platform: getPlatform(),
    enabled: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  console.log(LOG, "registered device token", { salonId: ctx.salonId, staffId: ctx.staffId, platform: getPlatform() });
}

async function ensureAndroidChannel(PushNotifications) {
  if (getPlatform() !== "android" || typeof PushNotifications.createChannel !== "function") return;
  try {
    await PushNotifications.createChannel({
      id: "staff_calls",
      name: "Staff calls",
      description: "Urgent staff call alerts",
      importance: 5,
      visibility: 1,
      sound: "default",
      vibration: true,
    });
    await PushNotifications.createChannel({
      id: "fairflow_alerts",
      name: "Fair Flow alerts",
      description: "Chat and inbox alerts",
      importance: 5,
      visibility: 1,
      sound: "default",
      vibration: true,
    });
  } catch (err) {
    console.warn(LOG, "createChannel failed", err);
  }
}

async function initPushForSignedInUser() {
  if (!isNativeApp()) {
    console.log(LOG, "skipped: not running in native app");
    return;
  }
  const PushNotifications = getPushPlugin();
  if (!PushNotifications) {
    console.warn(LOG, "PushNotifications plugin not available");
    return;
  }

  await ensureAndroidChannel(PushNotifications);

  let permission = await PushNotifications.checkPermissions();
  if (permission.receive !== "granted") {
    permission = await PushNotifications.requestPermissions();
  }
  if (permission.receive !== "granted") {
    console.warn(LOG, "permission not granted");
    return;
  }

  await PushNotifications.register();
}

function bindPushListeners() {
  const PushNotifications = getPushPlugin();
  if (!PushNotifications || window.__ffPushListenersBound) return;
  window.__ffPushListenersBound = true;

  PushNotifications.addListener("registration", (token) => {
    saveToken(token?.value).catch((err) => console.warn(LOG, "save token failed", err));
  });

  PushNotifications.addListener("registrationError", (err) => {
    console.error(LOG, "registration error", err);
  });

  PushNotifications.addListener("pushNotificationReceived", (notification) => {
    console.log(LOG, "received", notification);
  });

  PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    try {
      const data = action?.notification?.data || {};
      if (data.type === "chat_message") {
        document.getElementById("chatBtn")?.click();
      } else if (data.type === "inbox_item") {
        document.getElementById("inboxBtn")?.click();
      } else {
        document.getElementById("queueBtn")?.click();
      }
    } catch (_) {}
  });
}

bindPushListeners();

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  setTimeout(() => {
    initPushForSignedInUser().catch((err) => console.warn(LOG, "init failed", err));
  }, 2500);
});

document.addEventListener("ff-staff-cloud-updated", () => {
  const PushNotifications = getPushPlugin();
  if (!auth.currentUser || !PushNotifications || !isNativeApp()) return;
  PushNotifications.register().catch((err) => console.warn(LOG, "re-register failed", err));
});
