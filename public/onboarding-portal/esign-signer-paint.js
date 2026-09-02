/**
 * Portal e-sign — PDF paint, field overlays, missing-field UI.
 */

import { esc, loadPdfJs, pdfJsSourceFromPacket } from "./esign-signer-helpers.js?v=20260816_od_pdfb64";

export function attachEsignPaint(s) {
  s.schedulePaint = function schedulePaint() {
    if (s.paintTimer) clearTimeout(s.paintTimer);
    s.paintTimer = setTimeout(() => {
      s.paintTimer = null;
      s.paintCurrentPage();
    }, 120);
  }

  s.loadAndPaintPdf = async function loadAndPaintPdf() {
    const pdfjs = await loadPdfJs();
    s.pdfDoc = await pdfjs.getDocument(pdfJsSourceFromPacket(s.packet)).promise;
    s.pageNum = 1;
    await s.paintCurrentPage();
  }

  s.updateZoomInd = function updateZoomInd() {
    const el = s.root.querySelector("#ffEsignZoomInd");
    if (el) el.textContent = `${Math.round(s.zoom * 100)}%`;
    const zin = s.root.querySelector("#ffEsignZoomIn");
    const zout = s.root.querySelector("#ffEsignZoomOut");
    if (zin) zin.disabled = s.zoom >= s.ZOOM_MAX - 0.001;
    if (zout) zout.disabled = s.zoom <= s.ZOOM_MIN + 0.001;
  }

  s.paintCurrentPage = async function paintCurrentPage() {
    if (!s.pdfDoc || s.destroyed) return;
    const my = ++s.renderToken;
    const pagesEl = s.root.querySelector("#ffEsignPages");
    const ind = s.root.querySelector("#ffEsignPageInd");
    if (!pagesEl) return;
    if (ind) ind.textContent = `Page ${s.pageNum} / ${s.pdfDoc.numPages}`;
    s.updateZoomInd();

    const page = await s.pdfDoc.getPage(s.pageNum);
    if (my !== s.renderToken) return;
    const viewportEl = s.root.querySelector("#ffEsignViewport");
    const baseWidth = Math.max(
      280,
      (viewportEl ? viewportEl.clientWidth : 320) - 8
    );
    const unscaled = page.getViewport({ scale: 1 });
    const fit = baseWidth / unscaled.width;
    // CSS size = fit-to-width * user s.zoom. Bitmap size also multiplies by DPR
    // so Retina/mobile screens stay sharp (s.zoom re-renders, not CSS stretch).
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const cssScale = fit * s.zoom;
    const cssViewport = page.getViewport({ scale: cssScale });
    const renderViewport = page.getViewport({ scale: cssScale * dpr });

    pagesEl.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "esign-page";
    wrap.style.width = cssViewport.width + "px";
    wrap.style.height = cssViewport.height + "px";

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(renderViewport.width);
    canvas.height = Math.floor(renderViewport.height);
    canvas.style.width = cssViewport.width + "px";
    canvas.style.height = cssViewport.height + "px";
    canvas.className = "esign-page-canvas";
    const layer = document.createElement("div");
    layer.className = "esign-field-layer";

    wrap.appendChild(canvas);
    wrap.appendChild(layer);
    pagesEl.appendChild(wrap);

    const ctx = canvas.getContext("2d", { alpha: false });
    if (ctx) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }
    await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
    if (my !== s.renderToken) return;

    s.schema()
      .filter((f) => Number(f.page) === s.pageNum)
      .forEach((f) => {
        const el = document.createElement("div");
        el.className =
          "esign-field" +
          (f.required && s.isFieldMissing(f) ? " missing" : "") +
          (f.type === "checkbox" && s.values[f.id] === true ? " checked" : "");
        el.dataset.fieldId = f.id;
        el.style.left = f.x * 100 + "%";
        el.style.top = f.y * 100 + "%";
        el.style.width = f.width * 100 + "%";
        el.style.height = f.height * 100 + "%";
        el.innerHTML = s.fieldInnerHtml(f);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          s.activateField(f);
        });
        layer.appendChild(el);
      });
  }

  s.isFieldMissing = function isFieldMissing(f) {
    if (!f.required) return false;
    if (f.type === "checkbox") return s.values[f.id] !== true;
    if (f.type === "signature") {
      return !s.drawnPng && !(s.signatureMethod === "typed" && s.typedName.trim().length >= 2);
    }
    if (f.type === "typed_name") {
      return String(s.values[f.id] || s.typedName || "").trim().length < 2;
    }
    return !String(s.values[f.id] || "").trim();
  }

  s.fieldInnerHtml = function fieldInnerHtml(f) {
    if (f.type === "checkbox") {
      return `<span class="esign-check">${s.values[f.id] === true ? "✓" : ""}</span>`;
    }
    if (f.type === "signature") {
      if (s.drawnPng && s.signatureMethod === "drawn") {
        return `<img class="esign-sig-img" src="${s.drawnPng}" alt="">`;
      }
      if (s.signatureMethod === "typed" && s.typedName) {
        return `<span class="esign-sig-typed">${esc(s.typedName)}</span>`;
      }
      return `<span class="esign-ph">${esc(f.label || "Sign")}</span>`;
    }
    const v = String(
      f.type === "typed_name" ? s.values[f.id] || s.typedName || "" : s.values[f.id] || ""
    );
    if (v) return `<span class="esign-val">${esc(v)}</span>`;
    return `<span class="esign-ph">${esc(f.label || f.type)}${f.required ? " *" : ""}</span>`;
  }

  s.closeFieldEditor = function closeFieldEditor() {
    const ed = s.root.querySelector("#ffEsignFieldEditor");
    if (ed) {
      ed.hidden = true;
      ed.innerHTML = "";
    }
  }

  s.activateField = function activateField(f) {
    if (f.type === "checkbox") {
      s.values[f.id] = s.values[f.id] !== true;
      s.refreshMissing();
      s.paintCurrentPage();
      return;
    }
    if (f.type === "signature") {
      s.root.querySelector("#ffEsignSigBlock")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    const ed = s.root.querySelector("#ffEsignFieldEditor");
    if (!ed) return;
    const current =
      f.type === "typed_name"
        ? String(s.values[f.id] || s.typedName || "")
        : String(s.values[f.id] || "");
    const label = f.label || f.type;
    const today = new Date().toISOString().slice(0, 10);
    const inputType =
      f.type === "date" ? "date" : f.type === "initials" ? "text" : "text";
    const placeholder =
      f.type === "initials"
        ? "e.g. JD"
        : f.type === "typed_name"
          ? "Full legal name"
          : "Enter value";
    const maxlen =
      f.type === "initials" ? ' maxlength="8"' : f.type === "text" ? ' maxlength="200"' : "";

    ed.hidden = false;
    ed.innerHTML = `
      <div class="esign-editor-card">
        <label for="ffEsignFieldInp">${esc(label)}${f.required ? " *" : ""}</label>
        <input id="ffEsignFieldInp" type="${inputType}" value="${esc(
          f.type === "date" ? current || today : current
        )}" placeholder="${esc(placeholder)}"${maxlen} autocomplete="${
          f.type === "typed_name" ? "name" : "off"
        }" />
        <div class="btn-row row-2" style="margin-top:8px;">
          <button type="button" class="btn btn-secondary" id="ffEsignFieldCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="ffEsignFieldSave">Save</button>
        </div>
      </div>`;
    ed.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const inp = ed.querySelector("#ffEsignFieldInp");
    setTimeout(() => inp?.focus(), 50);

    const apply = () => {
      let next = String((inp && inp.value) || "").trim();
      if (f.type === "date" && next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
        const err = s.root.querySelector("#ffEsignErr");
        if (err) err.textContent = "Use a valid date.";
        return;
      }
      if (f.type === "initials") next = next.slice(0, 8);
      s.values[f.id] = next;
      if (f.type === "typed_name") {
        s.typedName = next;
        const nameInp =
          s.root.querySelector("#ffEsignTyped") ||
          s.root.querySelector("#ffEsignTypedDraw");
        if (nameInp) nameInp.value = next;
      }
      s.closeFieldEditor();
      s.refreshMissing();
      s.paintCurrentPage();
    };
    ed.querySelector("#ffEsignFieldSave")?.addEventListener("click", apply);
    ed.querySelector("#ffEsignFieldCancel")?.addEventListener("click", s.closeFieldEditor);
    inp?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        apply();
      }
    });
  }

  s.highlightField = function highlightField(id) {
    const el = s.root.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 1200);
  }

  s.focusNextRequired = function focusNextRequired() {
    const miss = s.missingRequired().filter((f) => f.id !== "__consent__");
    if (!miss.length) {
      if (!s.consentOk) {
        s.root.querySelector("#ffEsignConsent")?.focus();
        s.root.querySelector(".esign-consent")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      return;
    }
    const f = miss[0];
    if (f.type === "signature") {
      s.root.querySelector("#ffEsignJumpSig")?.click();
      return;
    }
    s.pageNum = Number(f.page) || 1;
    s.paintCurrentPage().then(() => {
      s.highlightField(f.id);
      s.activateField(f);
    });
  }

  s.refreshMissing = function refreshMissing() {
    const el = s.root.querySelector("#ffEsignMissing");
    if (!el) return;
    const miss = s.missingRequired();
    if (!miss.length) {
      el.innerHTML = `<div class="alert alert-ok" style="margin:0;">Ready to sign.</div>`;
      return;
    }
    el.innerHTML = `<div class="alert alert-warn" style="margin:0;">Still needed: ${esc(
      miss
        .map((f) => f.label || f.id)
        .slice(0, 5)
        .join(", ")
    )}</div>`;
  }
}
