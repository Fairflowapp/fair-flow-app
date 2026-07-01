/**
 * media-work-details.js — Work Details modal (preview, share/download, manager actions)
 * and Mark as Posted flow for the Media module. Extracted verbatim from media-upload.js (M6).
 */
import { auth } from "/app.js?v=20260610_force_lp_ios";
import { mediaState } from "./media-state.js?v=20260701_media_state_split";
import { canHandleMediaWork, isAdmin } from "./media-profile.js?v=20260701_media_profile_split";
import {
  getContentWork,
  getMediaItems,
  getPostedHistory,
  resolveMediaItemsForDisplay,
  addPostedHistory,
  updateContentWork,
  archiveContentWork,
  deleteContentWork,
  deleteMediaItem,
  selfDeleteContentWork,
} from "./media-cloud.js?v=20260623_mediafix";
import {
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
} from "./media-native-share.js?v=20260701_media_native_split";

// Injected from media-upload.js (main UI slab) to avoid import cycles.
let showMediaMessage = () => {};
let showMediaConfirm = () => {};
let renderMediaList = () => {};
let enrichWorkWithPreview = async (_work) => {};
let formatDate = (_ts) => "";
let getStatusLabels = (_work) => "";
let isSelfDeleteEligible = (_work) => false;
let canShowSelfDeleteButton = () => false;
export function initMediaWorkDetails(deps) {
  if (deps && typeof deps.showMediaMessage === "function") showMediaMessage = deps.showMediaMessage;
  if (deps && typeof deps.showMediaConfirm === "function") showMediaConfirm = deps.showMediaConfirm;
  if (deps && typeof deps.renderMediaList === "function") renderMediaList = deps.renderMediaList;
  if (deps && typeof deps.enrichWorkWithPreview === "function") enrichWorkWithPreview = deps.enrichWorkWithPreview;
  if (deps && typeof deps.formatDate === "function") formatDate = deps.formatDate;
  if (deps && typeof deps.getStatusLabels === "function") getStatusLabels = deps.getStatusLabels;
  if (deps && typeof deps.isSelfDeleteEligible === "function") isSelfDeleteEligible = deps.isSelfDeleteEligible;
  if (deps && typeof deps.canShowSelfDeleteButton === "function") canShowSelfDeleteButton = deps.canShowSelfDeleteButton;
}

// =====================
// Work Details Modal
// =====================

/** Firebase Storage download URLs use /o/ENCODED_PATH? — extract path for storageRef. */
function extractStoragePathFromMediaUrl(mediaUrl) {
  if (!mediaUrl || typeof mediaUrl !== "string") return null;
  const m = mediaUrl.match(/\/o\/([^?]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return null;
  }
}

/** Firestore sometimes stores gs://bucket/object — storageRef() needs object path only. */
function normalizeStoragePath(p) {
  if (!p || typeof p !== "string") return null;
  let s = p.trim();
  if (s.startsWith("gs://")) {
    const rest = s.slice(5);
    const i = rest.indexOf("/");
    if (i === -1) return null;
    s = rest.slice(i + 1);
  }
  return s.replace(/^\/+/, "") || null;
}


async function openWorkDetails(workId) {
  mediaState.selectedWorkId = workId;
  const modal = document.getElementById("workDetailsModal");
  const content = document.getElementById("workDetailsContent");
  const actions = document.getElementById("workDetailsActions");
  if (!modal || !content || !actions) return;

  const work = await getContentWork(workId);
  if (!work) return;

  const sid = work.salonId != null && String(work.salonId).trim() !== "" ? String(work.salonId).trim() : null;
  let items = await getMediaItems(workId, sid);
  items = await resolveMediaItemsForDisplay(items);
  const history = await getPostedHistory(workId, sid);
  await enrichWorkWithPreview(work);
  const canHandleMedia = canHandleMediaWork();
  const isAdminUser = isAdmin();
  const inToHandleView = mediaState.currentMediaTab === "to_handle";
  const showManagerRow = inToHandleView && canHandleMedia;
  const showAdminRow = inToHandleView && isAdminUser;

  /** Crowded toolbar: collapse into one "Actions" menu on narrow screens, only on To handle with manager/admin controls. */
  const useMobileActionMenu =
    typeof window !== "undefined" &&
    window.matchMedia &&
    window.matchMedia("(max-width: 640px)").matches &&
    inToHandleView &&
    (showManagerRow || showAdminRow);

  const pendingButtons = [];
  const pendingExtras = [];
  const addActionBtn = (btn) => {
    pendingButtons.push(btn);
  };
  const addActionExtra = (el) => {
    pendingExtras.push(el);
  };

  const btnStyle = "font-size:11px;padding:5px 10px;border-radius:6px;border:1px solid #d1d5db;background:#fff;color:#374151;cursor:pointer;";

  const flushWorkDetailActions = () => {
    if (useMobileActionMenu && pendingButtons.length > 0) {
      const wrap = document.createElement("div");
      wrap.className = "media-work-detail-actions-menu";
      wrap.style.cssText = "width:100%;";
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "btn-pill media-action-btn";
      toggle.textContent = "Actions \u25BE";
      toggle.setAttribute("aria-expanded", "false");
      toggle.style.cssText = btnStyle + "width:100%;box-sizing:border-box;font-weight:600;";
      const panel = document.createElement("div");
      panel.className = "media-work-detail-actions-panel";
      panel.style.cssText = "display:none;flex-direction:column;gap:8px;width:100%;margin-top:8px;";
      toggle.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const open = panel.style.display !== "flex";
        panel.style.display = open ? "flex" : "none";
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      };
      pendingButtons.forEach((btn) => {
        btn.style.width = "100%";
        btn.style.boxSizing = "border-box";
        panel.appendChild(btn);
      });
      pendingExtras.forEach((el) => {
        panel.appendChild(el);
      });
      wrap.appendChild(toggle);
      wrap.appendChild(panel);
      actions.appendChild(wrap);
    } else {
      pendingButtons.forEach((btn) => actions.appendChild(btn));
      pendingExtras.forEach((el) => actions.appendChild(el));
    }
  };

  const previewsHtml = items
    .map((m) => {
      const isVideo = (m.mediaType || "").includes("video");
      const delBtn = showAdminRow
        ? `<button type="button" style="position:absolute;top:4px;right:4px;font-size:12px;padding:2px 6px;background:rgba(0,0,0,0.5);color:#fff;border:none;border-radius:4px;cursor:pointer;" data-media-id="${m.id}">×</button>`
        : "";
      if (isVideo) {
        return `<div style="flex:0 0 120px;aspect-ratio:1;background:#f3f4f6;border-radius:8px;overflow:hidden;position:relative;"><video src="${m.mediaUrl}" style="width:100%;height:100%;object-fit:cover;" muted playsinline></video>${delBtn}</div>`;
      }
      return `<div style="flex:0 0 120px;aspect-ratio:1;background:#f3f4f6;border-radius:8px;overflow:hidden;position:relative;"><img src="${m.mediaUrl}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.parentElement.innerHTML='<div style=width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#9ca3af>📷</div>'">${delBtn}</div>`;
    })
    .join("");

  const statusLabels = getStatusLabels(work);
  const statusBadges = statusLabels.map((l) => `<span style="font-size:10px;padding:2px 6px;background:#f3f4f6;border-radius:4px;color:#6b7280;">${l}</span>`).join(" ");

  content.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;">${statusBadges}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">${previewsHtml || `<div style="aspect-ratio:1;width:120px;background:#f3f4f6;border-radius:8px;"></div>`}</div>
    <div style="display:grid;gap:6px;font-size:11px;">
      <div><span style="color:#6b7280;">Categories</span> <span style="color:#111827;">${Array.isArray(work.categoryNames) ? work.categoryNames.join(", ") : work.categoryName || work.serviceType || "—"}</span></div>
      ${work.caption ? `<div><span style="color:#6b7280;">Caption</span> <span style="color:#111827;">${work.caption}</span></div>` : ""}
      <div><span style="color:#6b7280;">By</span> <span style="color:#111827;">${work.staffName || "—"}</span></div>
      <div><span style="color:#6b7280;">Created</span> <span style="color:#111827;">${formatDate(work.createdAt)}</span></div>
      ${history.length ? `<div style="margin-top:6px;"><span style="color:#6b7280;">Posted history</span><ul style="margin:4px 0 0 14px;font-size:11px;color:#374151;">${history.map((h) => `<li>${h.platform} ${h.format} – ${h.postedDate || ""}</li>`).join("")}</ul></div>` : ""}
    </div>
  `;

  actions.innerHTML = "";

  const firstMedia = items[0];

  // Pre-compute share metadata + start prefetching the media blob right away.
  // Android Chrome/WebView times out the user-activation that authorizes
  // navigator.share() after a few seconds — if we wait to fetch the blob only
  // AFTER the user taps Share, the activation has expired by the time share()
  // is called and the OS share sheet refuses to open the file. By prefetching
  // here, the blob is usually ready by the time the user taps the button, and
  // share() is invoked synchronously within the same gesture.
  const shareMeta = (() => {
    const sp =
      normalizeStoragePath(firstMedia?.storagePath || "")
      || extractStoragePathFromMediaUrl(firstMedia?.mediaUrl || "");
    const ext = (
      (sp || "").match(/\.(jpe?g|png|gif|webp|mp4|webm|mov|pdf|heic|heif)$/i)?.[1]
      || (firstMedia?.mediaUrl || "").match(/\.(jpe?g|png|gif|webp|mp4|webm|mov|pdf)(?:\?|$)/i)?.[1]
      || "jpg"
    ).toLowerCase();
    const mime =
      ext === "jpg" || ext === "jpeg" ? "image/jpeg"
      : ext === "png" ? "image/png"
      : ext === "gif" ? "image/gif"
      : ext === "webp" ? "image/webp"
      : ext === "heic" || ext === "heif" ? "image/heic"
      : ext === "mp4" ? "video/mp4"
      : ext === "webm" ? "video/webm"
      : ext === "mov" ? "video/quicktime"
      : ext === "pdf" ? "application/pdf"
      : "image/jpeg";
    const safeExt = ext === "jpeg" ? "jpg" : ext;
    return { storagePath: sp, ext: safeExt, mime, fileName: `work-${workId}.${safeExt}` };
  })();

  let shareBlobPromise = null;
  const startShareBlobPrefetch = (preferDirect = false) => {
    if (shareBlobPromise) return shareBlobPromise;
    const { storagePath } = shareMeta;
    const mediaUrl = firstMedia?.mediaUrl || "";
    shareBlobPromise = (async () => {
      let blob = null;
      if (preferDirect && mediaUrl) {
        let timer = null;
        try {
          const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
          timer = ctrl ? setTimeout(() => ctrl.abort(), 4500) : null;
          const r = await fetch(mediaUrl, {
            credentials: "omit",
            mode: "cors",
            ...(ctrl ? { signal: ctrl.signal } : {}),
          });
          if (r.ok) blob = await r.blob();
        } catch (e) {
          console.warn("[Media] share prefetch: fast direct fetch failed", e);
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (blob && blob.size > 0) return blob;
      }
      try {
        if (storagePath && auth.currentUser) {
          blob = await fetchBlobViaHttpProxy(storagePath);
        }
      } catch (e) {
        console.warn("[Media] share prefetch: proxy failed, trying direct", e);
      }
      if ((!blob || blob.size === 0) && mediaUrl) {
        let timer = null;
        try {
          const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
          timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
          const r = await fetch(mediaUrl, {
            credentials: "omit",
            mode: "cors",
            ...(ctrl ? { signal: ctrl.signal } : {}),
          });
          if (r.ok) blob = await r.blob();
        } catch (e) {
          console.warn("[Media] share prefetch: direct fetch failed", e);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
      return blob;
    })();
    return shareBlobPromise;
  };

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.className = "btn-pill media-action-btn";
  downloadBtn.textContent = "Download";
  downloadBtn.style.cssText = btnStyle + "min-width:96px;white-space:nowrap;box-sizing:border-box;";
  // Warm the share-blob prefetch so the file is ready by tap time on native too.
  const warmDownload = () => { try { if (!ffMediaFastUrlMode()) startShareBlobPrefetch(true); } catch (_) {} };
  downloadBtn.addEventListener("pointerdown", warmDownload, { passive: true });
  downloadBtn.addEventListener("touchstart", warmDownload, { passive: true });
  downloadBtn.addEventListener("mouseenter", warmDownload);

  downloadBtn.onclick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!firstMedia?.mediaUrl && !firstMedia?.storagePath) {
      alert("No media to download");
      return;
    }

    const isNative = ffIsNativeCapacitor();
    const isIOSDevice =
      /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    /** Web/iOS Safari: must open before any await — iOS blocks async window.open (lost user activation). */
    let iosDownloadTab = null;
    if (!isNative && isIOSDevice) {
      try {
        iosDownloadTab = window.open("about:blank", "_blank");
      } catch (_) {}
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Loading…";

    const { fileName, mime: mimeFromExt } = shareMeta;
    const dlOpts = { iosTab: iosDownloadTab };

    try {
      if (ffMediaFastUrlMode() && firstMedia?.mediaUrl) {
        try {
          downloadBtn.textContent = "Opening…";
          await ffShareMediaUrlFast(firstMedia.mediaUrl, fileName, "", "Download image");
          return;
        } catch (fastErr) {
          if (ffIsShareCancel(fastErr)) return;
          console.warn("[Media] download: fast URL share failed, falling back to file", fastErr);
        }
      }

      // Get the blob (reuses the share prefetch if it's already in flight / done).
      let blob = null;
      try {
        blob = await ffWithTimeout(startShareBlobPrefetch(true), "media download prefetch", 8000);
      } catch (e2) {
        console.warn("[Media] download: prefetch promise rejected", e2);
      }

      // Last-chance direct proxy fetch if prefetch returned nothing.
      if ((!blob || blob.size === 0) && shareMeta.storagePath && auth.currentUser) {
        try {
          blob = await fetchBlobViaHttpProxy(shareMeta.storagePath);
        } catch (e3) {
          console.warn("[Media] download: proxy fetch failed", e3);
        }
      }

      if (!blob || blob.size === 0) {
        if (firstMedia?.mediaUrl) {
          showMediaMessage("Could not prepare file download. Use Share or try again.");
        } else {
          showMediaMessage("Download failed");
        }
        return;
      }

      const fixedBlob = blob.type === mimeFromExt ? blob : new Blob([blob], { type: mimeFromExt });

      // ---- Native (Capacitor iOS / Android): open the system share sheet so the
      // user can save the image to Photos / Files / Downloads. This is the
      // expected native UX in lieu of a hidden browser "download".
      if (isNative && ffGetCapShare() && ffNativeBridge()) {
        try {
          await ffWithTimeout(ffSaveBlobToDeviceViaShare(fixedBlob, fileName), "native media download share", 12000);
          return;
        } catch (e4) {
          if (ffIsShareCancel(e4)) return;
          console.warn("[Media] download: native share failed, falling back to web", e4);
        }
      }

      // ---- Web / browser fallback: existing <a download> or iOS-tab blob URL.
      await triggerMediaFileDownload(fixedBlob, fileName, undefined, dlOpts);
    } catch (err) {
      console.warn("[Media] download", err);
      showMediaMessage("Download failed");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = "Download";
      try {
        if (iosDownloadTab && !iosDownloadTab.closed) {
          const h = iosDownloadTab.location.href;
          if (h === "about:blank" || h === "") iosDownloadTab.close();
        }
      } catch (_) {
        try {
          if (iosDownloadTab && !iosDownloadTab.closed) iosDownloadTab.close();
        } catch (__) {}
      }
    }
  };
  addActionBtn(downloadBtn);

  const shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className = "btn-pill";
  shareBtn.textContent = "Share";
  shareBtn.style.cssText = btnStyle;

  // Warm the prefetch the moment the user just touches/hovers the button — gives
  // us even more head-start before the actual click that triggers the share.
  const warmShare = () => { try { if (!ffMediaFastUrlMode()) startShareBlobPrefetch(true); } catch (_) {} };
  shareBtn.addEventListener("pointerdown", warmShare, { passive: true });
  shareBtn.addEventListener("touchstart", warmShare, { passive: true });
  shareBtn.addEventListener("mouseenter", warmShare);

  shareBtn.onclick = async () => {
    if (!firstMedia?.mediaUrl && !firstMedia?.storagePath) {
      alert("No media to share");
      return;
    }

    const shareTitle = Array.isArray(work.categoryNames)
      ? work.categoryNames.join(", ")
      : work.categoryName || work.serviceType || "Work";
    const shareText = work.caption || "";
    const mediaUrl = firstMedia?.mediaUrl || "";
    const { mime: mimeFromExt, fileName } = shareMeta;

    shareBtn.disabled = true;
    const origText = shareBtn.textContent;
    shareBtn.textContent = ffMediaFastUrlMode() ? "Opening…" : "Preparing…";

    try {
      if (ffMediaFastUrlMode() && mediaUrl) {
        try {
          await ffShareMediaUrlFast(mediaUrl, shareTitle, shareText, "Share media");
          return;
        } catch (fastErr) {
          if (ffIsShareCancel(fastErr)) return;
          console.warn("[Media] share: fast URL share failed, falling back to file", fastErr);
          shareBtn.textContent = "Preparing…";
        }
      }

      // Get the pre-fetched blob. If it's already resolved by the time we await
      // here, the await completes in a microtask and preserves user-activation
      // — critical for navigator.share() to be allowed by Android Chrome.
      let blob = null;
      try {
        blob = await ffWithTimeout(startShareBlobPrefetch(true), "media share prefetch", 8000);
      } catch (e) {
        console.warn("[Media] share: prefetch promise rejected", e);
      }

      const fixedBlob = (blob && blob.size > 0)
        ? (blob.type === mimeFromExt ? blob : new Blob([blob], { type: mimeFromExt }))
        : null;

      // ---- Native (Capacitor iOS / Android): use the native Share plugin with
      // a real file URI written to the app's cache. This bypasses Web Share API
      // entirely, so it works on every Android device regardless of WebView age.
      const isNative = ffIsNativeCapacitor();
      const capShare = ffGetCapShare();
      const hasBridge = !!ffNativeBridge();
      console.log("[Media] share: native detection", {
        hasCapacitor: !!ffGetCapacitor(),
        isNative,
        hasShare: !!capShare,
        hasBridge,
        hasBlob: !!fixedBlob,
        blobSize: fixedBlob?.size || 0,
      });
      if (fixedBlob && isNative && capShare && hasBridge) {
        try {
          await ffWithTimeout(ffShareBlobNative(fixedBlob, fileName, shareTitle, shareText), "native media share", 12000);
          return;
        } catch (eNative) {
          if (ffIsShareCancel(eNative)) return;
          console.warn("[Media] share: Capacitor native share failed, falling back to web", eNative);
          // Surface the actual failure to help diagnose on real devices where
          // we can't attach chrome://inspect easily.
          try {
            alert("Native share failed: " + (eNative && (eNative.message || eNative.code || eNative)));
          } catch (_) {}
        }
      } else if (isNative && !capShare) {
        try {
          alert(
            "Native share plugin missing.\n" +
            "Please reinstall the latest APK so the plugin is bundled in the native binary."
          );
        } catch (_) {}
      }

      const canDoFileShare =
        typeof navigator !== "undefined"
        && typeof navigator.share === "function";

      if (canDoFileShare && fixedBlob) {
        const file = new File([fixedBlob], fileName, { type: mimeFromExt });

        let canShareFiles = true;
        if (typeof navigator.canShare === "function") {
          try { canShareFiles = !!navigator.canShare({ files: [file] }); }
          catch (_) { canShareFiles = false; }
        }
        console.log("[Media] share: trying web file share", {
          fileName, size: fixedBlob.size, mime: mimeFromExt, canShareFiles,
        });

        // First try with title+text+files; some Android targets reject the
        // combination, so retry with files only.
        try {
          await navigator.share({ files: [file], title: shareTitle, text: shareText });
          return;
        } catch (e1) {
          if (e1 && (e1.name === "AbortError" || e1.name === "NotAllowedError")) return;
          console.warn("[Media] share: files+text rejected, retrying files-only", e1);
          try {
            await navigator.share({ files: [file] });
            return;
          } catch (e2) {
            if (e2 && (e2.name === "AbortError" || e2.name === "NotAllowedError")) return;
            console.warn("[Media] share: file share failed, falling back to URL", e2);
          }
        }
      } else if (!fixedBlob) {
        console.warn("[Media] share: no blob available, falling back to URL");
      }

      // Fallback: share as URL via Web Share API (older devices / browsers without file support).
      if (mediaUrl && typeof navigator !== "undefined" && typeof navigator.share === "function") {
        try {
          await navigator.share({ title: shareTitle, text: shareText, url: mediaUrl });
          return;
        } catch (e) {
          if (e && (e.name === "AbortError" || e.name === "NotAllowedError")) return;
          console.warn("[Media] share: URL share failed, will copy instead", e);
        }
      }

      // Last fallback: copy link to clipboard.
      if (mediaUrl && navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(mediaUrl);
          alert("Link copied");
          return;
        } catch (_) {}
      }

      alert("Share not supported on this device");
    } finally {
      shareBtn.disabled = false;
      shareBtn.textContent = origText;
    }
  };
  addActionBtn(shareBtn);

  const role = (mediaState.currentUserProfile?.createdByRole || "").toLowerCase();
  const uid = auth.currentUser?.uid;
  const createdDate = work?.createdAt?.toDate ? work.createdAt.toDate() : (work?.createdAt ? new Date(work.createdAt) : null);
  const hoursSinceCreated = createdDate ? (Date.now() - createdDate.getTime()) / (1000 * 60 * 60) : null;
  const isOwner = work?.createdByUid === uid || work?.staffId === mediaState.currentUserProfile?.staffId;
  const within24h = hoursSinceCreated !== null && hoursSinceCreated < 24;
  const canShowBtn = canShowSelfDeleteButton();
  const isEligible = isSelfDeleteEligible(work);
  const canSelfDelete = canShowBtn && isEligible;

  if (canShowBtn && isOwner) {
    const selfDeleteBtn = document.createElement("button");
    selfDeleteBtn.type = "button";
    selfDeleteBtn.className = "btn-pill btn-danger";
    selfDeleteBtn.textContent = "Delete My Work";
    selfDeleteBtn.style.cssText = btnStyle + "background:#dc2626;color:#fff;cursor:pointer;pointer-events:auto;";
    if (!isEligible) {
      selfDeleteBtn.style.opacity = "0.7";
      selfDeleteBtn.title = "You can only delete your own active work within 24 hours, before it is posted or featured.";
    }
    selfDeleteBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isEligible) {
        let reason = "";
        if ((work?.postedCount || 0) > 0) {
          reason = "This work has been posted. You can only delete before it is posted.";
        } else if (work?.featured === true) {
          reason = "This work is featured. You can only delete before it is featured.";
        } else if (!within24h && hoursSinceCreated !== null) {
          const hrs = Math.round(hoursSinceCreated * 10) / 10;
          reason = `This work was uploaded ${hrs} hours ago. You can only delete within 24 hours of upload.`;
        } else if (work?.status !== "active") {
          reason = "This work is no longer active.";
        } else {
          reason = "You can only delete your own active work within 24 hours, before it is posted or featured.";
        }
        showMediaMessage(reason);
        return;
      }
      showMediaConfirm("This will delete your uploaded work and remove its media files. Continue?", async () => {
        try {
          selfDeleteBtn.disabled = true;
          selfDeleteBtn.textContent = "…";
          await selfDeleteContentWork(workId);
          closeWorkDetails();
          renderMediaList();
        } catch (err) {
          selfDeleteBtn.disabled = false;
          selfDeleteBtn.textContent = "Delete My Work";
          showMediaMessage("Failed: " + (err?.message || "Unknown error"));
        }
      });
    };
    addActionBtn(selfDeleteBtn);
    if (!isEligible) {
      let hintText = "";
      if ((work?.postedCount || 0) > 0) hintText = "Posted – you can only delete before posting.";
      else if (work?.featured === true) hintText = "Featured – you can only delete before featuring.";
      else if (!within24h && hoursSinceCreated !== null) hintText = `Uploaded ${Math.round(hoursSinceCreated * 10) / 10}h ago – delete within 24h only.`;
      else hintText = "You can only delete your own active work within 24 hours, before it is posted or featured.";
      const hint = document.createElement("div");
      hint.className = "action-hint";
      hint.style.cssText = "font-size:10px;color:#9ca3af;margin-top:4px;";
      hint.textContent = hintText;
      addActionExtra(hint);
    }
  }

  if (showManagerRow) {
    const markPostedBtn = document.createElement("button");
    markPostedBtn.className = "btn-pill media-action-btn";
    markPostedBtn.textContent = "Mark as Posted";
    markPostedBtn.style.cssText = btnStyle;
    markPostedBtn.onclick = () => openMarkPostedModal(workId);
    addActionBtn(markPostedBtn);

    const featuredBtn = document.createElement("button");
    featuredBtn.className = "btn-pill media-action-btn";
    featuredBtn.textContent = work.featured ? "Remove Featured" : "Mark as Featured";
    featuredBtn.style.cssText = btnStyle;
    featuredBtn.onclick = async () => {
      await updateContentWork(workId, { featured: !work.featured });
      openWorkDetails(workId);
      renderMediaList();
    };
    addActionBtn(featuredBtn);
  }

  if (showAdminRow) {
    const archiveBtn = document.createElement("button");
    archiveBtn.className = "btn-pill";
    archiveBtn.textContent = "Archive Work";
    archiveBtn.onclick = async () => {
      await archiveContentWork(workId);
      closeWorkDetails();
      renderMediaList();
    };
    addActionBtn(archiveBtn);

    const duplicateBtn = document.createElement("button");
    duplicateBtn.className = "btn-pill media-action-btn";
    duplicateBtn.textContent = work.duplicate ? "Remove Duplicate" : "Mark Duplicate";
    duplicateBtn.style.cssText = btnStyle;
    duplicateBtn.onclick = async () => {
      await updateContentWork(workId, { duplicate: !work.duplicate });
      openWorkDetails(workId);
      renderMediaList();
    };
    addActionBtn(duplicateBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-pill btn-danger media-action-btn";
    deleteBtn.style.cssText = btnStyle + "color:#dc2626;border-color:#fecaca;";
    deleteBtn.textContent = "Delete Work";
    deleteBtn.onclick = async () => {
      if (confirm("This will remove this work from active use. Continue?")) {
        await deleteContentWork(workId);
        closeWorkDetails();
        renderMediaList();
      }
    };
    addActionBtn(deleteBtn);
  }

  flushWorkDetailActions();

  content.onclick = async (e) => {
    const mediaId = e.target?.closest?.("[data-media-id]")?.dataset?.mediaId;
    if (mediaId && showAdminRow && confirm("Delete this media item?")) {
      try {
        await deleteMediaItem(workId, mediaId);
        openWorkDetails(workId);
        renderMediaList();
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    }
  };

  modal.style.display = "flex";
}

function closeWorkDetails() {
  const modal = document.getElementById("workDetailsModal");
  if (modal) modal.style.display = "none";
  mediaState.selectedWorkId = null;
}
// =====================
// Mark as Posted Modal
// =====================

const MARK_POSTED_PLATFORM_OPTIONS = [
  { value: "Instagram", label: "Instagram" },
  { value: "Facebook", label: "Facebook" },
  { value: "Pinterest", label: "Pinterest" },
  { value: "TikTok", label: "TikTok" },
  { value: "Google Business", label: "Google Business" },
  { value: "Website", label: "Website" },
  { value: "Other", label: "Other" },
];

const MARK_POSTED_FORMAT_OPTIONS = [
  { value: "Post", label: "Post" },
  { value: "Reel", label: "Reel" },
  { value: "Story", label: "Story" },
  { value: "Pin", label: "Pin" },
  { value: "Video", label: "Video" },
  { value: "Other", label: "Other" },
];

function renderMarkPostedPlatformCheckboxes(selectedValues = ["Instagram"]) {
  const wrap = document.getElementById("markPostedPlatformCheckboxes");
  if (!wrap) return;
  wrap.innerHTML = "";
  const selected = new Set(selectedValues);
  MARK_POSTED_PLATFORM_OPTIONS.forEach((opt) => {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;align-items:center;gap:10px;cursor:pointer;font-size:10px;color:#374151;";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.name = "markPostedPlatform";
    cb.value = opt.value;
    cb.checked = selected.has(opt.value);
    cb.style.cssText = "width:18px;height:18px;accent-color:#7c3aed;cursor:pointer;";
    label.appendChild(cb);
    label.appendChild(document.createTextNode(opt.label));
    wrap.appendChild(label);
  });
}

function getMarkPostedSelectedPlatforms() {
  return Array.from(document.querySelectorAll('input[name="markPostedPlatform"]:checked')).map((el) => el.value);
}

function renderMarkPostedFormatDropdown(selectedValue) {
  const dropdown = document.getElementById("markPostedFormatDropdown");
  const hidden = document.getElementById("markPostedFormat");
  const label = document.getElementById("markPostedFormatLabel");
  if (!dropdown || !hidden || !label) return;
  dropdown.innerHTML = "";
  MARK_POSTED_FORMAT_OPTIONS.forEach((opt) => {
    const row = document.createElement("div");
    const isSelected = (hidden.value || selectedValue) === opt.value;
    row.style.cssText = `padding:10px 12px;font-size:10px;cursor:pointer;display:flex;align-items:center;gap:10px;border-bottom:1px solid #f3f4f6;${isSelected ? "background:#ede9fe;color:#7c3aed;font-weight:500;" : ""}`;
    row.innerHTML = (isSelected ? "✓ " : "<span style='opacity:0'>✓ </span>") + opt.label;
    row.onclick = () => {
      hidden.value = opt.value;
      label.textContent = opt.label;
      dropdown.style.display = "none";
    };
    dropdown.appendChild(row);
  });
}

function openMarkPostedModal(workId) {
  const modal = document.getElementById("markPostedModal");
  if (!modal) return;
  modal.dataset.workId = workId;
  renderMarkPostedPlatformCheckboxes(["Instagram"]);
  const formatHidden = document.getElementById("markPostedFormat");
  const formatLabel = document.getElementById("markPostedFormatLabel");
  if (formatHidden) formatHidden.value = "Post";
  if (formatLabel) formatLabel.textContent = "Post";
  document.getElementById("markPostedNotes").value = "";
  renderMarkPostedFormatDropdown("Post");
  modal.style.display = "flex";
}

function closeMarkPostedModal() {
  const modal = document.getElementById("markPostedModal");
  const formatDropdown = document.getElementById("markPostedFormatDropdown");
  if (formatDropdown) formatDropdown.style.display = "none";
  if (modal) {
    modal.style.display = "none";
    delete modal.dataset.workId;
  }
}

async function saveMarkPosted() {
  const modal = document.getElementById("markPostedModal");
  const workId = modal?.dataset?.workId;
  if (!workId || !mediaState.currentUserProfile) return;

  const platforms = getMarkPostedSelectedPlatforms();
  if (platforms.length === 0) {
    alert("Please select at least one platform.");
    return;
  }
  const format = document.getElementById("markPostedFormat")?.value || "Post";
  const notes = document.getElementById("markPostedNotes")?.value || "";
  const postedDate = new Date().toISOString().slice(0, 10);

  try {
    for (const platform of platforms) {
      await addPostedHistory(workId, {
        platform,
        format,
        postedDate,
        markedByStaffId: mediaState.currentUserProfile.staffId,
        markedByName: mediaState.currentUserProfile.staffName,
        notes,
      });
    }
    closeMarkPostedModal();
    if (mediaState.selectedWorkId === workId) openWorkDetails(workId);
    renderMediaList();
  } catch (e) {
    console.error("[Media] addPostedHistory failed", e);
    alert("Failed to save: " + (e.message || "Unknown error"));
  }
}
function setupWorkDetailsListeners() {
  document.getElementById("workDetailsModalClose")?.addEventListener("click", closeWorkDetails);
}

function setupMarkPostedListeners() {
  document.getElementById("markPostedModalClose")?.addEventListener("click", closeMarkPostedModal);
  document.getElementById("markPostedCancel")?.addEventListener("click", closeMarkPostedModal);
  document.getElementById("markPostedSave")?.addEventListener("click", saveMarkPosted);

  const formatTrigger = document.getElementById("markPostedFormatTrigger");
  const formatDropdown = document.getElementById("markPostedFormatDropdown");
  if (formatTrigger && formatDropdown) {
    formatTrigger.onclick = (e) => {
      e.stopPropagation();
      const open = formatDropdown.style.display === "block";
      formatDropdown.style.display = open ? "none" : "block";
      if (!open) renderMarkPostedFormatDropdown(document.getElementById("markPostedFormat")?.value || "Post");
    };
    formatDropdown.onclick = (e) => e.stopPropagation();
  }

  document.getElementById("markPostedModal")?.addEventListener("click", (e) => {
    const formatTrig = document.getElementById("markPostedFormatTrigger");
    const formatDd = document.getElementById("markPostedFormatDropdown");
    const inFormat = formatTrig?.contains(e.target) || formatDd?.contains(e.target);
    if (e.target.id === "markPostedModal" || !inFormat) {
      if (formatDd) formatDd.style.display = "none";
    }
  });
}

export {
  openWorkDetails,
  closeWorkDetails,
  closeMarkPostedModal,
  setupWorkDetailsListeners,
  setupMarkPostedListeners,
};
