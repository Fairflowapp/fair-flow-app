import {
  doc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import { db, auth } from "/app.js?v=20260610_force_lp_ios";

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

function looksLikeApnsRawToken(value) {
  const str = String(value || "").trim();
  return str.length === 64 && /^[0-9a-fA-F]+$/.test(str);
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
  if (!user || !tokenValue) return false;
  const value = String(tokenValue || "").trim();
  if (!value) return false;
  if (getPlatform() === "ios" && looksLikeApnsRawToken(value)) {
    console.warn(LOG, "ignored raw APNs token; waiting for FCM token", { tokenLength: value.length });
    return false;
  }
  const ctx = await waitForPushContext();
  if (!ctx.salonId || !ctx.staffId) {
    console.warn(LOG, "token not saved, missing salon/staff context", ctx);
    return false;
  }

  const deviceId = getDeviceId();
  const tokenDocId = `${cleanDocPart(ctx.staffId)}_${cleanDocPart(deviceId)}`;
  await setDoc(doc(db, `salons/${ctx.salonId}/staffDeviceTokens`, tokenDocId), {
    token: value,
    uid: user.uid,
    staffId: ctx.staffId,
    staffName: ctx.staffName,
    deviceId,
    platform: getPlatform(),
    enabled: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  console.log(LOG, "registered device token", { salonId: ctx.salonId, staffId: ctx.staffId, platform: getPlatform() });
  return true;
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
    const value = String(token?.value || "").trim();
    if (getPlatform() === "ios" && looksLikeApnsRawToken(value)) {
      console.log(LOG, "iOS registration returned APNs token; waiting for native FCM bridge");
      return;
    }
    saveToken(value).catch((err) => console.warn(LOG, "save token failed", err));
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
      if (data.type === "writeup_sent" && data.writeupId) {
        // Reuse the ?ff_writeup deep-link path: my-writeups.js consumes the
        // pending id and opens the specific document once its docs are loaded.
        window.__ffPendingWriteupDeepLinkId = String(data.writeupId);
        if (typeof window.ffConsumeWriteupDeepLink === "function") {
          window.ffConsumeWriteupDeepLink();
        }
      } else if (data.type === "chat_message") {
        document.getElementById("chatBtn")?.click();
      } else if (data.type === "inbox_item") {
        document.getElementById("inboxBtn")?.click();
      } else if (data.type === "schedule_updated" || data.type === "schedule_published") {
        document.getElementById("scheduleBtn")?.click();
      } else if (
        data.type === "time_clock_late_clock_out" ||
        data.type === "time_clock_photo_failed"
      ) {
        try {
          window.__ffTCState = window.__ffTCState || {};
          window.__ffTCState.view = "manage";
        } catch (_) {}
        if (typeof window.goToTimeClock === "function") {
          window.goToTimeClock();
        } else {
          document.getElementById("timeClockBtn")?.click();
        }
      } else {
        document.getElementById("queueBtn")?.click();
      }
    } catch (_) {}
  });
}

function bindIosFcmBridge() {
  if (!isNativeApp() || getPlatform() !== "ios" || window.__ffIosFcmBridgeBound) return;
  window.__ffIosFcmBridgeBound = true;

  let pendingToken = String(window.__ff_fcm_token || "").trim();
  let retryTimer = null;

  function persist(token) {
    pendingToken = String(token || pendingToken || window.__ff_fcm_token || "").trim();
    if (!pendingToken) return;
    saveToken(pendingToken)
      .then((saved) => {
        if (saved) {
          pendingToken = "";
          if (retryTimer) clearInterval(retryTimer);
          retryTimer = null;
        }
      })
      .catch((err) => console.warn(LOG, "save iOS FCM token failed", err));
  }

  window.addEventListener("ff-fcm-token-received", (event) => {
    const token = event?.detail?.token || window.__ff_fcm_token;
    if (token) persist(token);
  });

  let attempts = 0;
  retryTimer = setInterval(() => {
    attempts += 1;
    if (window.__ff_fcm_token || pendingToken) {
      persist(window.__ff_fcm_token || pendingToken);
    }
    if (attempts >= 240) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  }, 500);
}

bindPushListeners();
bindIosFcmBridge();

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  setTimeout(() => {
    initPushForSignedInUser().catch((err) => console.warn(LOG, "init failed", err));
    if (getPlatform() === "ios" && window.__ff_fcm_token) {
      saveToken(window.__ff_fcm_token).catch((err) => console.warn(LOG, "save iOS FCM token after auth failed", err));
    }
  }, 2500);
});

document.addEventListener("ff-staff-cloud-updated", () => {
  const PushNotifications = getPushPlugin();
  if (!auth.currentUser || !PushNotifications || !isNativeApp()) return;
  PushNotifications.register().catch((err) => console.warn(LOG, "re-register failed", err));
});
