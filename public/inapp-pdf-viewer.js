/**
 * In-app document viewer for phones.
 * iOS Safari / WKWebView cannot display blob: PDFs in an iframe or new tab.
 * Render pages with PDF.js onto canvas instead.
 */

const PDFJS_VERSION = "4.8.69";
const PDFJS_MOD = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
const MAX_PAGES = 40;

let _pdfjs = null;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function ffIsPhoneDocViewer() {
  try {
    const html = document.documentElement;
    if (html.classList.contains("ff-ios-capacitor-safe")) return true;
    if (html.classList.contains("ff-android-native")) return true;
    if (typeof window.ffIsNativeApp === "function" && window.ffIsNativeApp()) {
      return true;
    }
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    return (
      /iPhone|iPad|iPod/i.test(ua) ||
      /Android/i.test(ua) ||
      (platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
  } catch (_) {
    return false;
  }
}

export function ffIsBlobOrDataUrl(url) {
  return /^(blob:|data:)/i.test(String(url || "").trim());
}

export function ffIsImageDocument(url, fileName, contentType) {
  if (contentType && /^image\//i.test(contentType)) return true;
  const source = `${fileName || ""} ${url || ""}`.toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|heic|heif)(\?|#|$)/i.test(source);
}

export function ffIsPdfDocument(url, fileName, contentType) {
  if (contentType && /pdf/i.test(contentType)) return true;
  const source = `${fileName || ""} ${url || ""}`.toLowerCase();
  return /\.pdf(\?|#|$)/i.test(source);
}

export function ffShouldUseInAppPdf(url, fileName, contentType) {
  if (!url) return false;
  if (ffIsImageDocument(url, fileName, contentType)) return ffIsPhoneDocViewer();
  if (ffIsBlobOrDataUrl(url)) return ffIsPhoneDocViewer();
  if (ffIsPdfDocument(url, fileName, contentType)) return ffIsPhoneDocViewer();
  return false;
}

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(PDFJS_MOD);
  if (_pdfjs.GlobalWorkerOptions) {
    _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return _pdfjs;
}

function mountOverlay(title) {
  const rid = `ffInappDoc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const overlay = document.createElement("div");
  overlay.id = rid;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.style.cssText =
    "position:fixed;left:0;top:0;right:0;bottom:0;width:100%;height:100vh;height:100dvh;background:#0f172a;z-index:2147483647;display:flex;flex-direction:column;box-sizing:border-box;padding:calc(10px + env(safe-area-inset-top,0px)) 10px calc(10px + env(safe-area-inset-bottom,0px));";
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 4px 12px;color:#fff;flex:0 0 auto;">
      <div data-ff-inapp-title style="min-width:0;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(title || "Document")}</div>
      <button type="button" data-ff-inapp-close style="border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.12);color:#fff;border-radius:999px;padding:7px 12px;font-size:13px;font-weight:700;cursor:pointer;">Close</button>
    </div>
    <div data-ff-inapp-body style="flex:1 1 auto;min-height:0;background:#fff;border-radius:14px;overflow:auto;-webkit-overflow-scrolling:touch;display:flex;flex-direction:column;align-items:center;"></div>`;
  const close = () => {
    try {
      overlay.remove();
    } catch (_) {}
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") close();
  };
  overlay.querySelector("[data-ff-inapp-close]").addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
  return { overlay, body: overlay.querySelector("[data-ff-inapp-body]"), close };
}

function showStatus(body, text) {
  body.innerHTML = `<div style="margin:auto;padding:24px 18px;color:#64748b;font-size:14px;font-weight:600;text-align:center;line-height:1.45;">${esc(text)}</div>`;
}

async function paintPdfPages(body, url) {
  const pdfjs = await loadPdfJs();
  const resp = await fetch(url);
  if (!resp.ok) throw new Error("Could not load the file.");
  const buf = await resp.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const count = Math.min(pdf.numPages, MAX_PAGES);
  body.innerHTML = "";
  body.style.background = "#e5e7eb";
  const width = Math.max(280, (body.clientWidth || window.innerWidth || 320) - 16);
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2.5);

  for (let i = 1; i <= count; i += 1) {
    const page = await pdf.getPage(i);
    const unscaled = page.getViewport({ scale: 1 });
    const fit = width / unscaled.width;
    const cssViewport = page.getViewport({ scale: fit });
    const renderViewport = page.getViewport({ scale: fit * dpr });
    const wrap = document.createElement("div");
    wrap.style.cssText = `margin:8px auto;background:#fff;box-shadow:0 1px 4px rgba(15,23,42,.12);width:${Math.floor(cssViewport.width)}px;height:${Math.floor(cssViewport.height)}px;`;
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = `${Math.floor(cssViewport.width)}px`;
    canvas.style.height = `${Math.floor(cssViewport.height)}px`;
    canvas.style.display = "block";
    wrap.appendChild(canvas);
    body.appendChild(wrap);
    const ctx = canvas.getContext("2d", { alpha: false });
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
  }
  if (pdf.numPages > MAX_PAGES) {
    const more = document.createElement("div");
    more.style.cssText =
      "padding:12px 16px 20px;color:#64748b;font-size:12px;font-weight:600;text-align:center;";
    more.textContent = `Showing first ${MAX_PAGES} of ${pdf.numPages} pages.`;
    body.appendChild(more);
  }
}

export function ffOpenInAppImageOverlay(url, title) {
  if (!url) return false;
  const { body } = mountOverlay(title || "Document");
  body.style.justifyContent = "center";
  body.innerHTML = `<img src="${esc(url)}" alt="${esc(title || "Document")}" style="display:block;max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;" />`;
  return true;
}

export function ffOpenInAppPdfOverlay(url, title) {
  if (!url) return false;
  const { body } = mountOverlay(title || "PDF");
  showStatus(body, "Opening document…");
  void paintPdfPages(body, url).catch((err) => {
    console.warn("[inapp-pdf] render", err);
    showStatus(
      body,
      (err && err.message) || "Couldn’t display this document on the phone."
    );
  });
  return true;
}

export function ffOpenInAppDocumentOverlay(url, title, opts) {
  if (!url) return false;
  const contentType = opts && opts.contentType;
  if (ffIsImageDocument(url, title, contentType)) {
    return ffOpenInAppImageOverlay(url, title);
  }
  return ffOpenInAppPdfOverlay(url, title);
}

if (typeof window !== "undefined") {
  window.ffOpenInAppDocumentOverlay = ffOpenInAppDocumentOverlay;
  window.ffShouldUseInAppPdf = ffShouldUseInAppPdf;
  window.ffIsPhoneDocViewer = ffIsPhoneDocViewer;
}
