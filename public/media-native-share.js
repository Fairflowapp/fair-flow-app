/**
 * media-native-share.js — Capacitor (iOS/Android) native bridge plus media share / download
 * helpers for the Media module: native share sheets, saving blobs to the device, the HTTP
 * proxy fetch fallback, and the browser download fallback. Extracted verbatim from
 * media-upload.js (M5).
 */
import { auth } from "/app.js?v=20260610_force_lp_ios";
import { canHandleMediaWork } from "./media-profile.js?v=20260901_media_iso";

// Injected from media-upload.js to avoid an import cycle: showMediaMessage lives in the main UI slab.
let showMediaMessage = () => {};
export function initMediaNativeShare(deps) {
  if (deps && typeof deps.showMediaMessage === "function") showMediaMessage = deps.showMediaMessage;
}

/**
 * ===== Capacitor helpers (iOS/Android native) =====
 * Access the Capacitor runtime + plugins that the native shell injects into the
 * WebView. When running in a regular browser (or in Capacitor without the
 * plugin installed in the native binary) these all return null and the code
 * falls back to standard web APIs.
 */
function ffGetCapacitor() {
  return (typeof window !== "undefined" && window.Capacitor) ? window.Capacitor : null;
}
function ffTimeoutPromise(label, ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
}
function ffWithTimeout(promise, label, ms) {
  return Promise.race([promise, ffTimeoutPromise(label, ms)]);
}
function ffIsNativeCapacitor() {
  const Cap = ffGetCapacitor();
  if (!Cap) return false;
  try {
    if (typeof Cap.isNativePlatform === "function") return !!Cap.isNativePlatform();
    if (typeof Cap.getPlatform === "function") {
      const p = Cap.getPlatform();
      return p === "ios" || p === "android";
    }
  } catch (_) {}
  return false;
}
/** Low-level Capacitor bridge handle — works regardless of whether plugin JS packages were imported. */
function ffNativeBridge() {
  const Cap = ffGetCapacitor();
  if (!Cap) return null;
  if (typeof Cap.nativePromise !== "function") return null;
  return Cap;
}
/**
 * Call a native Capacitor plugin method by name via the low-level bridge.
 * This works without `import { Foo } from '@capacitor/foo'` (we can't bundle
 * in this app — the JS is served as-is from Firebase hosting). The plugin
 * just needs to be installed natively (gradle/podspec), which `npx cap sync`
 * handles after `npm install @capacitor/<plugin>`.
 */
async function ffCallNative(pluginName, methodName, options) {
  const Cap = ffNativeBridge();
  if (!Cap) throw new Error("Capacitor native bridge unavailable");
  return ffWithTimeout(
    Cap.nativePromise(pluginName, methodName, options || {}),
    `${pluginName}.${methodName}`,
    8000
  );
}
function ffGetCapShare() {
  const Cap = ffGetCapacitor();
  if (Cap && Cap.Plugins && Cap.Plugins.Share) return Cap.Plugins.Share;
  // Fallback: if we have the native bridge, expose a tiny stub that forwards to nativePromise.
  if (ffNativeBridge()) return { share: (opts) => ffCallNative("Share", "share", opts) };
  return null;
}
function ffGetCapFs() {
  const Cap = ffGetCapacitor();
  if (Cap && Cap.Plugins && Cap.Plugins.Filesystem) return Cap.Plugins.Filesystem;
  if (ffNativeBridge()) {
    return {
      writeFile: (opts) => ffCallNative("Filesystem", "writeFile", opts),
      getUri: (opts) => ffCallNative("Filesystem", "getUri", opts),
    };
  }
  return null;
}
function ffCapDir() {
  return "CACHE";
}
function ffBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const comma = typeof result === "string" ? result.indexOf(",") : -1;
      if (comma >= 0) resolve(result.slice(comma + 1));
      else reject(new Error("blob → base64 failed"));
    };
    reader.onerror = () => reject(reader.error || new Error("blob read failed"));
    reader.readAsDataURL(blob);
  });
}
/** Write blob → native file → return URI ("file://..."). Tries custom Android
 * plugin first (pure Java, ships in this app's APK), then falls back to the
 * standard @capacitor/filesystem plugin. The custom plugin is more reliable
 * because @capacitor/filesystem is implemented in Kotlin and requires the
 * Android project to have the Kotlin Gradle plugin configured to compile. */
async function ffWriteBlobToCapCache(blob, fileName) {
  const base64 = await ffBlobToBase64(blob);

  // Try our custom Java plugin first (Android only; iOS doesn't ship it).
  if (ffNativeBridge()) {
    try {
      const res = await ffCallNative("FfFileShare", "writeAndGetUri", {
        fileName,
        data: base64,
      });
      if (res && res.uri) return res.uri;
    } catch (e) {
      console.warn("[Media] FfFileShare unavailable, falling back to @capacitor/filesystem", e);
    }
  }

  // Fallback: standard @capacitor/filesystem (works on iOS, and on Android if
  // Kotlin gradle plugin is configured).
  const Filesystem = ffGetCapFs();
  if (!Filesystem) throw new Error("No native file-write plugin available");
  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: ffCapDir(),
    recursive: true,
  });
  const res = await Filesystem.getUri({ path: fileName, directory: ffCapDir() });
  return res && res.uri ? res.uri : null;
}
/** True if the error message looks like a user cancellation from Capacitor Share. */
function ffIsShareCancel(err) {
  if (!err) return false;
  const msg = String(err.message || err.code || err || "").toLowerCase();
  return msg.includes("cancel") || msg.includes("dismiss") || msg.includes("user denied");
}
function ffMediaFastUrlMode() {
  try {
    // Technicians need the action sheet to open immediately. Managers/admins keep
    // the heavier "share actual file" path because their flow already performs well.
    return ffIsNativeCapacitor() && !canHandleMediaWork();
  } catch (_) {
    return false;
  }
}
async function ffShareMediaUrlFast(mediaUrl, title, text, dialogTitle) {
  if (!mediaUrl) throw new Error("No media URL");
  const Share = ffGetCapShare();
  if (ffIsNativeCapacitor() && Share) {
    await ffWithTimeout(Share.share({
      title: title || "Media",
      text: text || "",
      url: mediaUrl,
      dialogTitle: dialogTitle || "Share"
    }), "native media url share", 2500);
    return true;
  }
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    await ffWithTimeout(navigator.share({
      title: title || "Media",
      text: text || "",
      url: mediaUrl
    }), "web media url share", 2500);
    return true;
  }
  return false;
}
/** Persist a blob to the user's device (Photos sheet on iOS, Save sheet on Android). */
async function ffSaveBlobToDeviceViaShare(blob, fileName) {
  const Share = ffGetCapShare();
  if (!ffIsNativeCapacitor() || !Share) throw new Error("Capacitor Share not available");
  const uri = await ffWriteBlobToCapCache(blob, fileName);
  if (!uri) throw new Error("Failed to write file to cache");
  await Share.share({
    title: fileName,
    files: [uri],
    dialogTitle: "Save image",
  });
}
/** Share a blob as an actual image file via the native share sheet. */
async function ffShareBlobNative(blob, fileName, title, text) {
  const Share = ffGetCapShare();
  if (!ffIsNativeCapacitor() || !Share) throw new Error("Capacitor Share not available");
  const uri = await ffWriteBlobToCapCache(blob, fileName);
  if (!uri) throw new Error("Failed to write file to cache");
  const payload = { files: [uri], dialogTitle: title || "Share" };
  if (title) payload.title = title;
  if (text) payload.text = text;
  await Share.share(payload);
}

/** Cloud Function `mediaDownloadFile` via Hosting rewrite — no direct Storage URL fetch. */
async function fetchBlobViaHttpProxy(storagePath) {
  if (!storagePath || !auth.currentUser) {
    throw new Error("Download failed");
  }
  const idToken = await auth.currentUser.getIdToken();
  const url = `/api/mediaDownloadFile?path=${encodeURIComponent(storagePath)}&token=${encodeURIComponent(idToken)}`;
  const urlForLog = `/api/mediaDownloadFile?path=${encodeURIComponent(storagePath)}&token=<redacted>`;
  console.log("[MediaDownload] fetch url", urlForLog);
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 10000) : null;
  let res;
  try {
    res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
  } finally {
    if (timer) clearTimeout(timer);
  }
  console.log("[MediaDownload] res.status", res.status);
  if (!res.ok) {
    const errText = await res.text();
    console.log("[MediaDownload] error response text", errText);
    throw new Error("Download failed");
  }
  const blob = await res.blob();
  console.log("[MediaDownload] blob size", blob.size);
  return blob;
}

/* Capacitor Android helpers — present since b7681a7, dropped from the M5 extract into this file. */
function _isCapacitorAndroid() {
  return !!(
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform() &&
    /Android/i.test(navigator.userAgent)
  );
}

async function _capDownloadToDevice(blob, fileName) {
  const Cap = ffGetCapacitor();
  const Filesystem = Cap && Cap.Plugins && Cap.Plugins.Filesystem;
  if (!Filesystem) throw new Error("Filesystem plugin not available");
  const base64 = await ffBlobToBase64(blob);
  try {
    await Filesystem.writeFile({
      path: "Download/" + fileName,
      data: base64,
      directory: "EXTERNAL_STORAGE",
      recursive: true,
    });
    return true;
  } catch (_) {
    await Filesystem.writeFile({
      path: fileName,
      data: base64,
      directory: "DOCUMENTS",
    });
    return true;
  }
}

/**
 * Saves a blob as a file. iOS Safari often ignores <a download>; uses Share sheet or assigns blob URL to a tab
 * opened synchronously on click (async window.open is usually blocked).
 * @param {{ iosTab?: Window | null }} [opts] — Tab from sync window.open("about:blank") on same click (iOS).
 */
async function triggerMediaFileDownload(blob, fileName, mediaUrlFallback, opts = {}) {
  const iosTab = opts.iosTab;

  const closeIosTabIfUnused = () => {
    try {
      if (iosTab && !iosTab.closed) iosTab.close();
    } catch (_) {}
  };

  if (!blob || blob.size === 0) {
    closeIosTabIfUnused();
    if (mediaUrlFallback && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(mediaUrlFallback).catch(() => {});
    }
    return;
  }
  const isIOS =
    /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    const url = URL.createObjectURL(blob);
    if (iosTab && !iosTab.closed) {
      try {
        iosTab.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 120000);
        showMediaMessage("Long-press the image → Save to Photos, or tap Share.");
        return;
      } catch (e) {
        console.warn("[Media] ios tab location failed", e);
      }
    }
    const w = window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 2500);
    }
    closeIosTabIfUnused();
    showMediaMessage("If it didn’t save: long-press the image → Save to Photos, or use Share.");
    return;
  }

  closeIosTabIfUnused();

  if (_isCapacitorAndroid()) {
    try {
      await _capDownloadToDevice(blob, fileName);
      showMediaMessage("Image saved to your device.");
      return;
    } catch (e) {
      console.warn("[Media] Capacitor download failed, trying fallback", e);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 2500);
}

export {
  ffGetCapacitor,
  ffWithTimeout,
  ffIsNativeCapacitor,
  ffNativeBridge,
  ffGetCapShare,
  ffIsShareCancel,
  ffMediaFastUrlMode,
  ffShareMediaUrlFast,
  ffSaveBlobToDeviceViaShare,
  ffShareBlobNative,
  fetchBlobViaHttpProxy,
  triggerMediaFileDownload,
};
