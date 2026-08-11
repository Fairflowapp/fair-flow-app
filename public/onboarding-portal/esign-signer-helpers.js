/**
 * Portal e-sign — shared helpers (PDF.js load, error classify).
 */

const PDFJS_VERSION = "4.8.69";
const PDFJS_MOD = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let _pdfjs = null;

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(PDFJS_MOD);
  if (_pdfjs.GlobalWorkerOptions) {
    _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return _pdfjs;
}

export function classifyEsignError(e) {
  const msg = String((e && e.message) || "Something went wrong.");
  const status = e && e.status;
  if (/cancel/i.test(msg)) {
    return {
      kind: "cancelled",
      title: "Onboarding cancelled",
      body: "This onboarding was cancelled. Ask your manager for help.",
      msg,
    };
  }
  if (/invalid|expired|link|unauthenticated/i.test(msg) || status === 401) {
    return {
      kind: "invalid",
      title: "Link unavailable",
      body: "This link is invalid, expired, or no longer active. Ask your manager for a new link.",
      msg,
    };
  }
  if (/hash|mismatch|version_mismatch/i.test(msg)) {
    return {
      kind: "hash",
      title: "Document changed",
      body: "The document no longer matches what was assigned. Ask your manager to send a new task.",
      msg,
    };
  }
  if (/already completed|complete\. Viewing/i.test(msg)) {
    return {
      kind: "completed",
      title: "Already signed",
      body: "This document was already signed.",
      msg,
    };
  }
  if (/Failed to fetch|NetworkError|network|offline|Load failed/i.test(msg) || status === 0) {
    return {
      kind: "network",
      title: "Connection lost",
      body: "Check your connection and try again. If you already signed, you won’t create a duplicate.",
      msg,
    };
  }
  return {
    kind: "generic",
    title: "Couldn’t submit signature",
    body: msg,
    msg,
  };
}
