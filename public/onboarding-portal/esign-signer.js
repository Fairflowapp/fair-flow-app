/**
 * Portal E-sign Phase E4 — employee signing UI.
 * Uses only onboardingPortalGetSignaturePacket / onboardingPortalSubmitSignature.
 * No Firestore / Storage SDK. Never logs tokens or IP.
 */

import {
  esc,
  classifyEsignError,
} from "./esign-signer-helpers.js?v=20260810_od_split_v1";
import { attachEsignPaint } from "./esign-signer-paint.js?v=20260810_od_split_v1";
import { attachEsignChrome } from "./esign-signer-chrome.js?v=20260810_od_split_v1";

/**
 * Mount e-sign experience into hostEl.
 * @returns { destroy: function }
 */
export function mountEsignSigner(hostEl, opts) {
  const s = {
    hostEl,
    opts: opts || {},
    task: (opts || {}).task,
    sessionToken: (opts || {}).sessionToken,
    portalHttp: (opts || {}).portalHttp,
    getPacketName:
      (opts || {}).getPacketName || "onboardingPortalGetSignaturePacket",
    submitName:
      (opts || {}).submitName || "onboardingPortalSubmitSignature",
    onCompleted: (opts || {}).onCompleted,
    onFatalError: (opts || {}).onFatalError,
    destroyed: false,
    packet: null,
    pdfDoc: null,
    pageNum: 1,
    zoom: 1,
    ZOOM_MIN: 0.75,
    ZOOM_MAX: 4,
    ZOOM_STEP: 0.25,
    busy: false,
    values: {},
    consentOk: false,
    drawnPng: null,
    typedName: "",
    signatureMethod: null,
    renderToken: 0,
    paintTimer: null,
    root: null,
    done: false,
  };

  s.done =
    s.task &&
    (s.task.status === "completed" ||
      (s.task.resultPublic && s.task.resultPublic.signedPdfSha256));

  s.hostEl.innerHTML = `
    <div class="esign-root" id="ffEsignRoot">
      <div class="esign-loading" id="ffEsignLoading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="sub">Loading document…</p>
      </div>
    </div>`;

  s.root = s.hostEl.querySelector("#ffEsignRoot");

  attachEsignPaint(s);
  attachEsignChrome(s);

  s.completedSummaryHtml = function completedSummaryHtml(pkt) {
    const cfg = (s.task && s.task.config) || {};
    const res = Object.assign(
      {},
      (s.task && s.task.resultPublic) || {},
      (pkt && pkt.resultPublic) || {}
    );
    const title =
      (pkt && pkt.documentTitle) ||
      cfg.documentTitle ||
      (s.task && s.task.templateNameSnapshot) ||
      "Document";
    let when = "";
    if (res.signedAt) {
      try {
        when = new Date(res.signedAt).toLocaleString();
      } catch (_) {
        when = String(res.signedAt);
      }
    }
    const signer = res.signerName || "";
    const versionRaw =
      pkt && pkt.documentVersion != null
        ? pkt.documentVersion
        : cfg.documentVersion != null
          ? cfg.documentVersion
          : "";
    const version = versionRaw === "" || versionRaw == null ? "" : String(versionRaw);
    return `
      <div class="alert alert-ok">
        <strong>Signed &amp; complete</strong>
        <div style="margin-top:8px;font-size:13px;line-height:1.45;">
          ${esc(title)} is sealed. You can’t change it.
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;">
          ${when ? `<span style="opacity:.75;">Signed</span><span>${esc(when)}</span>` : ""}
          ${signer ? `<span style="opacity:.75;">Signer</span><span>${esc(signer)}</span>` : ""}
          ${version ? `<span style="opacity:.75;">Version</span><span>${esc(version)}</span>` : ""}
        </div>
      </div>
      <p class="sub" style="margin-top:12px;text-align:center;">Use Back to list to continue onboarding.</p>`;
  }

  s.setBanner = function setBanner(kind, title, body, retryable) {
    s.root.innerHTML = `
      <div class="alert alert-${kind === "ok" ? "ok" : kind === "warn" ? "warn" : "danger"}">
        <strong>${esc(title)}</strong>
        <div style="margin-top:6px;">${esc(body)}</div>
      </div>
      ${
        retryable
          ? `<div class="btn-row" style="margin-top:12px;">
              <button type="button" class="btn btn-primary" id="ffEsignRetry">Try again</button>
            </div>`
          : ""
      }`;
    const retry = s.root.querySelector("#ffEsignRetry");
    if (retry) retry.addEventListener("click", () => s.loadPacket());
  }

  s.loadPacket = async function loadPacket() {
    if (s.destroyed) return;
    s.root.innerHTML = `
      <div class="esign-loading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="sub">Loading document…</p>
      </div>`;
    try {
      s.packet = await s.portalHttp(s.getPacketName, {
        s.sessionToken,
        taskId: s.task.id,
      });
      if (s.destroyed) return;
      if (s.packet.status === "completed" || s.packet.readOnly) {
        s.root.innerHTML = s.completedSummaryHtml(s.packet);
        return;
      }
      await s.renderSigner();
    } catch (e) {
      const info = classifyEsignError(e);
      if (info.kind === "cancelled" || info.kind === "invalid") {
        if (typeof s.onFatalError === "function") s.onFatalError(e, info);
        else s.setBanner("danger", info.title, info.body, false);
        return;
      }
      s.setBanner("danger", info.title, info.body, true);
    }
  }

  s.schema = function schema() {
    return Array.isArray(s.packet && s.packet.fieldSchema) ? s.packet.fieldSchema : [];
  }

  s.missingRequired = function missingRequired() {
    const miss = [];
    for (const f of s.schema()) {
      if (!f.required) continue;
      if (f.type === "checkbox") {
        if (s.values[f.id] !== true) miss.push(f);
        continue;
      }
      if (f.type === "signature") {
        if (!s.drawnPng && !(s.signatureMethod === "typed" && s.typedName.trim().length >= 2)) {
          miss.push(f);
        }
        continue;
      }
      if (f.type === "typed_name") {
        const v = String(s.values[f.id] || s.typedName || "").trim();
        if (v.length < 2) miss.push(f);
        continue;
      }
      if (!String(s.values[f.id] || "").trim()) miss.push(f);
    }
    if (!s.consentOk) miss.push({ id: "__consent__", label: "Consent", type: "consent" });
    return miss;
  }

  s.uiValidate = function uiValidate() {
    const miss = s.missingRequired();
    if (!miss.length) return null;
    const labels = miss.map((f) => f.label || f.id).slice(0, 6);
    return `Please complete: ${labels.join(", ")}`;
  }

  s.submit = async function submit() {
    if (s.busy || s.destroyed) return;
    const errEl = s.root.querySelector("#ffEsignErr");
    const btn = s.root.querySelector("#ffEsignSubmit");
    const v = s.uiValidate();
    if (v) {
      if (errEl) errEl.textContent = v;
      s.focusNextRequired();
      return;
    }
    const cfgRequireDrawn = s.packet.requireDrawnSignature !== false;
    if (cfgRequireDrawn && !s.drawnPng && s.signatureMethod === "drawn") {
      if (errEl) errEl.textContent = "Please draw and use your signature.";
      return;
    }
    if ((s.packet.requireTypedName === true || s.signatureMethod === "typed") && s.typedName.trim().length < 2) {
      if (errEl) errEl.textContent = "Please enter your full name.";
      return;
    }

    s.busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing…";
    }
    if (errEl) errEl.textContent = "";

    // Build field s.values for server
    const fieldValues = { ...values };
    s.schema().forEach((f) => {
      if (f.type === "typed_name" && !fieldValues[f.id]) {
        fieldValues[f.id] = s.typedName;
      }
      if (f.type === "checkbox") {
        fieldValues[f.id] = fieldValues[f.id] === true;
      }
    });

    const method =
      s.packet.requireDrawnSignature !== false ||
      (s.drawnPng && s.signatureMethod === "drawn")
        ? "drawn"
        : "typed";
    const signature = {
      method,
      s.typedName: s.typedName.trim(),
    };
    if (method === "drawn" && s.drawnPng) {
      signature.pngBase64 = s.drawnPng;
    }

    let succeeded = false;
    try {
      const result = await s.portalHttp(s.submitName, {
        s.sessionToken,
        taskId: s.task.id,
        consentAccepted: true,
        consentText: s.packet.consentText,
        fieldValues,
        signature,
      });
      succeeded = true;
      if (btn) btn.textContent = "Signed";
      if (typeof s.onCompleted === "function") {
        s.onCompleted(result);
      } else {
        s.setBanner("ok", "Signed", "Your signature was submitted successfully.", false);
      }
    } catch (e) {
      const info = classifyEsignError(e);
      if (info.kind === "cancelled" || info.kind === "invalid") {
        if (typeof s.onFatalError === "function") s.onFatalError(e, info);
        else if (errEl) errEl.textContent = info.body;
      } else if (info.kind === "completed") {
        succeeded = true;
        if (typeof s.onCompleted === "function") s.onCompleted({ ok: true, alreadyCompleted: true });
        else s.setBanner("ok", info.title, info.body, false);
      } else {
        if (errEl) errEl.textContent = info.body;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Sign & submit";
        }
      }
    } finally {
      // Keep s.busy after success so a double-tap cannot re-s.submit.
      if (!succeeded) s.busy = false;
    }
  }

  if (s.done) {
    s.root.innerHTML = s.completedSummaryHtml(null);
  } else {
    s.loadPacket();
  }

  return {
    destroy() {
      s.destroyed = true;
      if (s.paintTimer) {
        clearTimeout(s.paintTimer);
        s.paintTimer = null;
      }
      try {
        s.root.innerHTML = "";
      } catch (_) {}
    },
  };
}
