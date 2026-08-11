/**
 * Portal e-sign — signer chrome, zoom gestures, signature pad.
 */

import { esc } from "./esign-signer-helpers.js?v=20260810_od_split_v1";

export function attachEsignChrome(s) {
  s.renderSigner = async function renderSigner() {
    const cfgRequireDrawn = s.packet.requireDrawnSignature !== false;
    const cfgRequireTyped = s.packet.requireTypedName === true;
    // When drawn is required, keep pad as the signature; typed name is still collected.
    // Typed-as-signature only when drawn is not required.
    if (!s.signatureMethod) {
      s.signatureMethod = cfgRequireDrawn ? "drawn" : "typed";
    } else if (cfgRequireDrawn) {
      s.signatureMethod = "drawn";
    }

    const showMethodToggle = !cfgRequireDrawn;

    s.root.innerHTML = `
      <div class="esign-shell">
        <div class="esign-toolbar">
          <button type="button" class="esign-icon-btn" id="ffEsignPrev" aria-label="Previous page">‹</button>
          <span class="esign-page-ind" id="ffEsignPageInd">Page 1</span>
          <button type="button" class="esign-icon-btn" id="ffEsignNext" aria-label="Next page">›</button>
          <span class="esign-toolbar-spacer"></span>
          <button type="button" class="esign-icon-btn" id="ffEsignZoomOut" aria-label="Zoom out">−</button>
          <span class="esign-page-ind" id="ffEsignZoomInd" aria-live="polite">100%</span>
          <button type="button" class="esign-icon-btn" id="ffEsignZoomIn" aria-label="Zoom in">+</button>
        </div>
        <div class="esign-viewport" id="ffEsignViewport">
          <div class="esign-pages" id="ffEsignPages"></div>
        </div>
        <div class="esign-panel">
          <div class="esign-missing" id="ffEsignMissing"></div>
          <div class="btn-row row-2" style="margin-top:0;">
            <button type="button" class="btn btn-secondary" id="ffEsignNextReq">Next required</button>
            <button type="button" class="btn btn-secondary" id="ffEsignJumpSig">Signature</button>
          </div>
          <div id="ffEsignFieldEditor" class="esign-field-editor" hidden></div>
          ${
            showMethodToggle
              ? `<div class="field" style="margin-top:12px;">
            <label>Signature method</label>
            <div class="esign-method">
              <button type="button" class="esign-chip ${s.signatureMethod === "drawn" ? "active" : ""}" data-esign-method="drawn">Draw</button>
              <button type="button" class="esign-chip ${s.signatureMethod === "typed" ? "active" : ""}" data-esign-method="typed">Type name</button>
            </div>
          </div>`
              : `<div class="field" style="margin-top:12px;"><label>Your signature</label></div>`
          }
          <div id="ffEsignSigBlock"></div>
          <div class="field">
            <label class="esign-consent">
              <input type="checkbox" id="ffEsignConsent" />
              <span>${esc(s.packet.consentText || "I agree to sign electronically.")}</span>
            </label>
          </div>
          <div class="error-msg" id="ffEsignErr"></div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="ffEsignSubmit">Sign &amp; submit</button>
          </div>
          <p class="sub" style="margin-top:8px;text-align:center;">Your signature is sealed securely. You can’t change it after submit.</p>
        </div>
      </div>`;

    s.wireChrome(cfgRequireDrawn, cfgRequireTyped);
    await s.loadAndPaintPdf();
    s.refreshMissing();
    s.renderSigBlock();
  }

  s.setZoom = function setZoom(next, opts) {
    const z = Math.min(
      s.ZOOM_MAX,
      Math.max(s.ZOOM_MIN, Number(Number(next).toFixed(3)))
    );
    if (Math.abs(z - s.zoom) < 0.001) {
      s.updateZoomInd();
      return false;
    }
    s.zoom = z;
    s.updateZoomInd();
    if (opts && opts.immediate) s.paintCurrentPage();
    else s.schedulePaint();
    return true;
  }

  s.wirePinchAndWheelZoom = function wirePinchAndWheelZoom() {
    const viewportEl = s.root.querySelector("#ffEsignViewport");
    if (!viewportEl || viewportEl.dataset.ffZoomGestures === "1") return;
    viewportEl.dataset.ffZoomGestures = "1";

    let pinch = null; // { startDist, startZoom }

    function touchDistance(t0, t1) {
      const dx = t0.clientX - t1.clientX;
      const dy = t0.clientY - t1.clientY;
      return Math.hypot(dx, dy) || 1;
    }

    viewportEl.addEventListener(
      "touchstart",
      (ev) => {
        if (!ev.touches || ev.touches.length !== 2) {
          if (pinch) {
            pinch = null;
            viewportEl.classList.remove("is-pinching");
          }
          return;
        }
        pinch = {
          startDist: touchDistance(ev.touches[0], ev.touches[1]),
          startZoom: s.zoom,
        };
        viewportEl.classList.add("is-pinching");
      },
      { passive: true }
    );

    viewportEl.addEventListener(
      "touchmove",
      (ev) => {
        if (!ev.touches || ev.touches.length !== 2) return;
        if (!pinch) {
          pinch = {
            startDist: touchDistance(ev.touches[0], ev.touches[1]),
            startZoom: s.zoom,
          };
          viewportEl.classList.add("is-pinching");
        }
        ev.preventDefault();
        const dist = touchDistance(ev.touches[0], ev.touches[1]);
        const ratio = dist / pinch.startDist;
        s.setZoom(pinch.startZoom * ratio);
      },
      { passive: false }
    );

    const endPinch = (ev) => {
      if (!pinch) return;
      if (ev.touches && ev.touches.length >= 2) return;
      pinch = null;
      viewportEl.classList.remove("is-pinching");
      s.schedulePaint();
    };
    viewportEl.addEventListener("touchend", endPinch, { passive: true });
    viewportEl.addEventListener("touchcancel", endPinch, { passive: true });

    // Trackpad pinch (Chrome/Safari often emit wheel + ctrlKey).
    viewportEl.addEventListener(
      "wheel",
      (ev) => {
        if (!(ev.ctrlKey || ev.metaKey)) return;
        ev.preventDefault();
        const factor = ev.deltaY > 0 ? 0.92 : 1.08;
        s.setZoom(s.zoom * factor);
      },
      { passive: false }
    );
  }

  s.wireChrome = function wireChrome(cfgRequireDrawn, cfgRequireTyped) {
    s.root.querySelector("#ffEsignPrev")?.addEventListener("click", () => {
      s.pageNum = Math.max(1, s.pageNum - 1);
      s.paintCurrentPage();
    });
    s.root.querySelector("#ffEsignNext")?.addEventListener("click", () => {
      const max = s.pdfDoc ? s.pdfDoc.numPages : 1;
      s.pageNum = Math.min(max, s.pageNum + 1);
      s.paintCurrentPage();
    });
    s.root.querySelector("#ffEsignZoomIn")?.addEventListener("click", () => {
      s.setZoom(s.zoom + s.ZOOM_STEP);
    });
    s.root.querySelector("#ffEsignZoomOut")?.addEventListener("click", () => {
      s.setZoom(s.zoom - s.ZOOM_STEP);
    });
    s.wirePinchAndWheelZoom();
    s.root.querySelector("#ffEsignNextReq")?.addEventListener("click", () => {
      s.focusNextRequired();
    });
    s.root.querySelector("#ffEsignJumpSig")?.addEventListener("click", () => {
      const sig = s.schema().find((f) => f.type === "signature");
      if (sig) {
        s.pageNum = Number(sig.page) || 1;
        s.paintCurrentPage().then(() => s.highlightField(sig.id));
      }
      s.root.querySelector("#ffEsignSigBlock")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    s.root.querySelectorAll("[data-esign-method]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.getAttribute("data-esign-method");
        if (m === "drawn" && cfgRequireDrawn === false && !cfgRequireTyped) {
          /* allow */
        }
        s.signatureMethod = m;
        s.root.querySelectorAll("[data-esign-method]").forEach((b) => {
          b.classList.toggle("active", b.getAttribute("data-esign-method") === m);
        });
        s.renderSigBlock();
        s.refreshMissing();
        s.paintCurrentPage();
      });
    });
    const consent = s.root.querySelector("#ffEsignConsent");
    if (consent) {
      consent.addEventListener("change", () => {
        s.consentOk = !!consent.checked;
        s.refreshMissing();
      });
    }
    s.root.querySelector("#ffEsignSubmit")?.addEventListener("click", () => s.submit());
  }

  s.renderSigBlock = function renderSigBlock() {
    const block = s.root.querySelector("#ffEsignSigBlock");
    if (!block) return;
    if (s.signatureMethod === "typed") {
      block.innerHTML = `
        <div class="field">
          <label for="ffEsignTyped">Typed full name</label>
          <input id="ffEsignTyped" type="text" autocomplete="name" placeholder="Your full legal name" value="${esc(s.typedName)}" />
          <div class="esign-typed-preview" id="ffEsignTypedPreview">${esc(s.typedName || "Your name will appear here")}</div>
        </div>`;
      const inp = block.querySelector("#ffEsignTyped");
      const prev = block.querySelector("#ffEsignTypedPreview");
      inp?.addEventListener("input", () => {
        s.typedName = String(inp.value || "");
        if (prev) prev.textContent = s.typedName || "Your name will appear here";
        // sync typed_name fields
        s.schema()
          .filter((f) => f.type === "typed_name")
          .forEach((f) => {
            s.values[f.id] = s.typedName;
          });
        s.refreshMissing();
        s.schedulePaint();
      });
    } else {
      block.innerHTML = `
        <div class="field">
          <label>Drawn signature</label>
          <div class="esign-pad-wrap">
            <canvas id="ffEsignPad" width="640" height="220"></canvas>
          </div>
          <div class="btn-row row-2" style="margin-top:8px;">
            <button type="button" class="btn btn-secondary" id="ffEsignPadClear">Clear</button>
            <button type="button" class="btn btn-secondary" id="ffEsignPadUse">Use signature</button>
          </div>
          ${
            s.drawnPng
              ? `<div class="esign-sig-thumb"><img src="${s.drawnPng}" alt="Signature preview"></div>`
              : `<p class="sub" style="margin-top:8px;">Draw with your finger, then tap Use signature.</p>`
          }
          <div class="field" style="margin-top:10px;">
            <label for="ffEsignTypedDraw">Full name (required)</label>
            <input id="ffEsignTypedDraw" type="text" autocomplete="name" placeholder="Your full legal name" value="${esc(s.typedName)}" />
          </div>
        </div>`;
      s.wirePad();
      const nameInp = block.querySelector("#ffEsignTypedDraw");
      nameInp?.addEventListener("input", () => {
        s.typedName = String(nameInp.value || "");
        s.schema()
          .filter((f) => f.type === "typed_name")
          .forEach((f) => {
            s.values[f.id] = s.typedName;
          });
        s.refreshMissing();
      });
    }
  }

  s.wirePad = function wirePad() {
    const canvas = s.root.querySelector("#ffEsignPad");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 320;
    const cssH = Math.round(cssW * 0.34);
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let drawing = false;
    let last = null;
    const pos = (ev) => {
      const r = canvas.getBoundingClientRect();
      const t = ev.touches && ev.touches[0];
      const x = (t ? t.clientX : ev.clientX) - r.left;
      const y = (t ? t.clientY : ev.clientY) - r.top;
      return { x, y };
    };
    const start = (ev) => {
      ev.preventDefault();
      drawing = true;
      last = pos(ev);
    };
    const move = (ev) => {
      if (!drawing) return;
      ev.preventDefault();
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    };
    const end = (ev) => {
      if (!drawing) return;
      ev.preventDefault();
      drawing = false;
    };
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    canvas.addEventListener("mouseup", end);
    canvas.addEventListener("mouseleave", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end, { passive: false });

    s.root.querySelector("#ffEsignPadClear")?.addEventListener("click", () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cssW, cssH);
      s.drawnPng = null;
      s.refreshMissing();
      s.paintCurrentPage();
      s.renderSigBlock();
    });
    s.root.querySelector("#ffEsignPadUse")?.addEventListener("click", () => {
      // Detect empty pad (mostly white)
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < sample.length; i += 16) {
        if (sample[i] < 250 || sample[i + 1] < 250 || sample[i + 2] < 250) ink++;
      }
      if (ink < 8) {
        const err = s.root.querySelector("#ffEsignErr");
        if (err) err.textContent = "Please draw your signature first.";
        return;
      }
      s.drawnPng = canvas.toDataURL("image/png");
      s.signatureMethod = "drawn";
      s.refreshMissing();
      s.paintCurrentPage();
      s.renderSigBlock();
    });
  }
}
