/**
 * media-thumbs.js — memory-safe image painting for the Media module.
 *
 * Uploads are full-resolution phone photos (~5 MB, 4032x3024). Decoded, a single
 * one of those costs ~48 MB of RAM regardless of how small it is displayed, so a
 * grid of 26 cards asks the browser for well over 1 GB and Safari discards the tab
 * ("This webpage was reloaded because it was using significant memory"). That is
 * what looked like the app "refreshing by itself".
 *
 * So no Storage URL is ever left attached to a live element. Each image is loaded
 * into a detached <img>, immediately drawn down into a small canvas, and the <img>
 * is dropped. Steady-state cost is ~0.3 MB per card instead of ~48 MB.
 *
 * The bucket has no CORS policy, so fetch()/createImageBitmap() are not usable
 * here (cross-origin reads throw); drawImage() of a plain <img> needs no CORS.
 * Only one decode runs at a time, which keeps the transient peak to one image.
 */

export const MEDIA_THUMB_PX = 240;
export const MEDIA_LARGE_PX = 1280;
export const MEDIA_STORED_THUMB_PX = 480;

/** Below this the original is already cheap enough to display, so no thumbnail is stored. */
const THUMB_WORTH_IT_BYTES = 400 * 1024;

/**
 * Build a small JPEG thumbnail for an image File at upload time, so viewers never
 * have to download the multi-megabyte original just to draw a card.
 * Returns null when a thumbnail is not applicable (video, tiny file, no support).
 */
export async function makeThumbnailBlob(file, px) {
  if (!file || !/^image\//i.test(String(file.type || ""))) return null;
  if (Number(file.size || 0) <= THUMB_WORTH_IT_BYTES) return null;
  if (typeof createImageBitmap !== "function") return null;

  let bmp = null;
  try {
    bmp = await createImageBitmap(file, {
      resizeWidth: px || MEDIA_STORED_THUMB_PX,
      resizeQuality: "high",
      imageOrientation: "from-image",
    });
  } catch (e) {
    console.warn("[MediaThumbs] thumbnail decode failed", e && e.message ? e.message : e);
    return null;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext("2d").drawImage(bmp, 0, 0);
    return await new Promise((resolve) => {
      try {
        canvas.toBlob((b) => resolve(b || null), "image/jpeg", 0.82);
      } catch (_) {
        resolve(null);
      }
    });
  } finally {
    try { bmp.close(); } catch (_) {}
  }
}

const LOAD_TIMEOUT_MS = 25000;
let active = 0;
const queue = [];

export function safeHttpUrl(value) {
  const u = value != null ? String(value).trim() : "";
  return /^https?:\/\//i.test(u) ? u : "";
}

export function isVideoMedia(media) {
  const t = String((media && (media.mediaType || media.contentType)) || "").toLowerCase();
  if (t.includes("video")) return true;
  const u = String((media && (media.mediaUrl || media.storagePath)) || "");
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(u);
}

function pump() {
  // Deliberately serial: one full-resolution decode in flight at a time.
  if (active || !queue.length) return;
  const job = queue.shift();
  if (!job) return;
  if (job.el && !job.el.isConnected) {
    pump();
    return;
  }
  active = 1;
  job
    .run()
    .catch((e) => console.warn("[MediaThumbs]", e && e.message ? e.message : e))
    .finally(() => {
      active = 0;
      pump();
    });
}

function loadDetachedImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    let settled = false;
    // Never reassign src on failure: on iOS WebView that itself triggers a reload.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("image timeout"));
    }, LOAD_TIMEOUT_MS);
    img.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("image load failed"));
    };
    img.src = url;
  });
}

/** Draw `url` down to a canvas whose longest edge is at most `px`. */
async function decodeToCanvas(url, px) {
  const img = await loadDetachedImage(url);
  const w0 = Number(img.naturalWidth) || 1;
  const h0 = Number(img.naturalHeight) || 1;
  const scale = Math.min(1, px / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  try { ctx.imageSmoothingQuality = "medium"; } catch (_) {}
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

/**
 * Replace the contents of `el` with a downscaled canvas of `url`.
 * @param {HTMLElement} el
 * @param {string} url https media URL
 * @param {{px?: number, fit?: "cover"|"contain", onFail?: () => void}} [opts]
 */
export function paintMediaInto(el, url, opts) {
  const safe = safeHttpUrl(url);
  if (!el || !safe) return;
  const px = (opts && opts.px) || MEDIA_THUMB_PX;
  const fit = (opts && opts.fit) === "contain" ? "contain" : "cover";
  if (el.getAttribute("data-ff-thumb") === "1") return;
  el.setAttribute("data-ff-thumb", "1");

  queue.push({
    el,
    run: async () => {
      if (!el.isConnected) return;
      try {
        const canvas = await decodeToCanvas(safe, px);
        if (!el.isConnected) return;
        canvas.style.cssText = fit === "contain"
          ? "max-width:100%;max-height:100%;width:auto;height:auto;display:block;border-radius:8px;"
          : "width:100%;height:100%;object-fit:cover;display:block;";
        el.textContent = "";
        el.appendChild(canvas);
      } catch (e) {
        el.removeAttribute("data-ff-thumb");
        if (opts && typeof opts.onFail === "function") opts.onFail();
        throw e;
      }
    },
  });
  pump();
}
