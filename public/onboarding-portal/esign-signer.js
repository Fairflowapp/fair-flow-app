/**
 * Portal E-sign Phase E4 — employee signing UI.
 * Uses only onboardingPortalGetSignaturePacket / onboardingPortalSubmitSignature.
 * No Firestore / Storage SDK. Never logs tokens or IP.
 */

const PDFJS_VERSION = "4.8.69";
const PDFJS_MOD = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

let _pdfjs = null;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  _pdfjs = await import(PDFJS_MOD);
  if (_pdfjs.GlobalWorkerOptions) {
    _pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return _pdfjs;
}

function classifyEsignError(e) {
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

/**
 * Mount e-sign experience into hostEl.
 * @returns {{ destroy: function }}
 */
export function mountEsignSigner(hostEl, opts) {
  const {
    task,
    sessionToken,
    portalHttp,
    getPacketName = "onboardingPortalGetSignaturePacket",
    submitName = "onboardingPortalSubmitSignature",
    onCompleted,
    onFatalError,
  } = opts || {};

  let destroyed = false;
  let packet = null;
  let pdfDoc = null;
  let pageNum = 1;
  let zoom = 1;
  const ZOOM_MIN = 0.75;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 0.25;
  let busy = false;
  let values = {}; // fieldId -> value
  let consentOk = false;
  let drawnPng = null; // data URL
  let typedName = "";
  let signatureMethod = null; // drawn | typed
  let renderToken = 0;
  let paintTimer = null;

  function schedulePaint() {
    if (paintTimer) clearTimeout(paintTimer);
    paintTimer = setTimeout(() => {
      paintTimer = null;
      paintCurrentPage();
    }, 120);
  }

  const done =
    task &&
    (task.status === "completed" ||
      (task.resultPublic && task.resultPublic.signedPdfSha256));

  hostEl.innerHTML = `
    <div class="esign-root" id="ffEsignRoot">
      <div class="esign-loading" id="ffEsignLoading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="sub">Loading document…</p>
      </div>
    </div>`;

  const root = hostEl.querySelector("#ffEsignRoot");

  function completedSummaryHtml(pkt) {
    const cfg = (task && task.config) || {};
    const res = Object.assign(
      {},
      (task && task.resultPublic) || {},
      (pkt && pkt.resultPublic) || {}
    );
    const title =
      (pkt && pkt.documentTitle) ||
      cfg.documentTitle ||
      (task && task.templateNameSnapshot) ||
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

  function setBanner(kind, title, body, retryable) {
    root.innerHTML = `
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
    const retry = root.querySelector("#ffEsignRetry");
    if (retry) retry.addEventListener("click", () => loadPacket());
  }

  async function loadPacket() {
    if (destroyed) return;
    root.innerHTML = `
      <div class="esign-loading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="sub">Loading document…</p>
      </div>`;
    try {
      packet = await portalHttp(getPacketName, {
        sessionToken,
        taskId: task.id,
      });
      if (destroyed) return;
      if (packet.status === "completed" || packet.readOnly) {
        root.innerHTML = completedSummaryHtml(packet);
        return;
      }
      await renderSigner();
    } catch (e) {
      const info = classifyEsignError(e);
      if (info.kind === "cancelled" || info.kind === "invalid") {
        if (typeof onFatalError === "function") onFatalError(e, info);
        else setBanner("danger", info.title, info.body, false);
        return;
      }
      setBanner("danger", info.title, info.body, true);
    }
  }

  function schema() {
    return Array.isArray(packet && packet.fieldSchema) ? packet.fieldSchema : [];
  }

  function missingRequired() {
    const miss = [];
    for (const f of schema()) {
      if (!f.required) continue;
      if (f.type === "checkbox") {
        if (values[f.id] !== true) miss.push(f);
        continue;
      }
      if (f.type === "signature") {
        if (!drawnPng && !(signatureMethod === "typed" && typedName.trim().length >= 2)) {
          miss.push(f);
        }
        continue;
      }
      if (f.type === "typed_name") {
        const v = String(values[f.id] || typedName || "").trim();
        if (v.length < 2) miss.push(f);
        continue;
      }
      if (!String(values[f.id] || "").trim()) miss.push(f);
    }
    if (!consentOk) miss.push({ id: "__consent__", label: "Consent", type: "consent" });
    return miss;
  }

  function uiValidate() {
    const miss = missingRequired();
    if (!miss.length) return null;
    const labels = miss.map((f) => f.label || f.id).slice(0, 6);
    return `Please complete: ${labels.join(", ")}`;
  }

  async function renderSigner() {
    const cfgRequireDrawn = packet.requireDrawnSignature !== false;
    const cfgRequireTyped = packet.requireTypedName === true;
    // When drawn is required, keep pad as the signature; typed name is still collected.
    // Typed-as-signature only when drawn is not required.
    if (!signatureMethod) {
      signatureMethod = cfgRequireDrawn ? "drawn" : "typed";
    } else if (cfgRequireDrawn) {
      signatureMethod = "drawn";
    }

    const showMethodToggle = !cfgRequireDrawn;

    root.innerHTML = `
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
              <button type="button" class="esign-chip ${signatureMethod === "drawn" ? "active" : ""}" data-esign-method="drawn">Draw</button>
              <button type="button" class="esign-chip ${signatureMethod === "typed" ? "active" : ""}" data-esign-method="typed">Type name</button>
            </div>
          </div>`
              : `<div class="field" style="margin-top:12px;"><label>Your signature</label></div>`
          }
          <div id="ffEsignSigBlock"></div>
          <div class="field">
            <label class="esign-consent">
              <input type="checkbox" id="ffEsignConsent" />
              <span>${esc(packet.consentText || "I agree to sign electronically.")}</span>
            </label>
          </div>
          <div class="error-msg" id="ffEsignErr"></div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="ffEsignSubmit">Sign &amp; submit</button>
          </div>
          <p class="sub" style="margin-top:8px;text-align:center;">Your signature is sealed securely. You can’t change it after submit.</p>
        </div>
      </div>`;

    wireChrome(cfgRequireDrawn, cfgRequireTyped);
    await loadAndPaintPdf();
    refreshMissing();
    renderSigBlock();
  }

  function setZoom(next, opts) {
    const z = Math.min(
      ZOOM_MAX,
      Math.max(ZOOM_MIN, Number(Number(next).toFixed(3)))
    );
    if (Math.abs(z - zoom) < 0.001) {
      updateZoomInd();
      return false;
    }
    zoom = z;
    updateZoomInd();
    if (opts && opts.immediate) paintCurrentPage();
    else schedulePaint();
    return true;
  }

  function wirePinchAndWheelZoom() {
    const viewportEl = root.querySelector("#ffEsignViewport");
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
          startZoom: zoom,
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
            startZoom: zoom,
          };
          viewportEl.classList.add("is-pinching");
        }
        ev.preventDefault();
        const dist = touchDistance(ev.touches[0], ev.touches[1]);
        const ratio = dist / pinch.startDist;
        setZoom(pinch.startZoom * ratio);
      },
      { passive: false }
    );

    const endPinch = (ev) => {
      if (!pinch) return;
      if (ev.touches && ev.touches.length >= 2) return;
      pinch = null;
      viewportEl.classList.remove("is-pinching");
      schedulePaint();
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
        setZoom(zoom * factor);
      },
      { passive: false }
    );
  }

  function wireChrome(cfgRequireDrawn, cfgRequireTyped) {
    root.querySelector("#ffEsignPrev")?.addEventListener("click", () => {
      pageNum = Math.max(1, pageNum - 1);
      paintCurrentPage();
    });
    root.querySelector("#ffEsignNext")?.addEventListener("click", () => {
      const max = pdfDoc ? pdfDoc.numPages : 1;
      pageNum = Math.min(max, pageNum + 1);
      paintCurrentPage();
    });
    root.querySelector("#ffEsignZoomIn")?.addEventListener("click", () => {
      setZoom(zoom + ZOOM_STEP);
    });
    root.querySelector("#ffEsignZoomOut")?.addEventListener("click", () => {
      setZoom(zoom - ZOOM_STEP);
    });
    wirePinchAndWheelZoom();
    root.querySelector("#ffEsignNextReq")?.addEventListener("click", () => {
      focusNextRequired();
    });
    root.querySelector("#ffEsignJumpSig")?.addEventListener("click", () => {
      const sig = schema().find((f) => f.type === "signature");
      if (sig) {
        pageNum = Number(sig.page) || 1;
        paintCurrentPage().then(() => highlightField(sig.id));
      }
      root.querySelector("#ffEsignSigBlock")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    root.querySelectorAll("[data-esign-method]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.getAttribute("data-esign-method");
        if (m === "drawn" && cfgRequireDrawn === false && !cfgRequireTyped) {
          /* allow */
        }
        signatureMethod = m;
        root.querySelectorAll("[data-esign-method]").forEach((b) => {
          b.classList.toggle("active", b.getAttribute("data-esign-method") === m);
        });
        renderSigBlock();
        refreshMissing();
        paintCurrentPage();
      });
    });
    const consent = root.querySelector("#ffEsignConsent");
    if (consent) {
      consent.addEventListener("change", () => {
        consentOk = !!consent.checked;
        refreshMissing();
      });
    }
    root.querySelector("#ffEsignSubmit")?.addEventListener("click", () => submit());
  }

  function renderSigBlock() {
    const block = root.querySelector("#ffEsignSigBlock");
    if (!block) return;
    if (signatureMethod === "typed") {
      block.innerHTML = `
        <div class="field">
          <label for="ffEsignTyped">Typed full name</label>
          <input id="ffEsignTyped" type="text" autocomplete="name" placeholder="Your full legal name" value="${esc(typedName)}" />
          <div class="esign-typed-preview" id="ffEsignTypedPreview">${esc(typedName || "Your name will appear here")}</div>
        </div>`;
      const inp = block.querySelector("#ffEsignTyped");
      const prev = block.querySelector("#ffEsignTypedPreview");
      inp?.addEventListener("input", () => {
        typedName = String(inp.value || "");
        if (prev) prev.textContent = typedName || "Your name will appear here";
        // sync typed_name fields
        schema()
          .filter((f) => f.type === "typed_name")
          .forEach((f) => {
            values[f.id] = typedName;
          });
        refreshMissing();
        schedulePaint();
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
            drawnPng
              ? `<div class="esign-sig-thumb"><img src="${drawnPng}" alt="Signature preview"></div>`
              : `<p class="sub" style="margin-top:8px;">Draw with your finger, then tap Use signature.</p>`
          }
          <div class="field" style="margin-top:10px;">
            <label for="ffEsignTypedDraw">Full name (required)</label>
            <input id="ffEsignTypedDraw" type="text" autocomplete="name" placeholder="Your full legal name" value="${esc(typedName)}" />
          </div>
        </div>`;
      wirePad();
      const nameInp = block.querySelector("#ffEsignTypedDraw");
      nameInp?.addEventListener("input", () => {
        typedName = String(nameInp.value || "");
        schema()
          .filter((f) => f.type === "typed_name")
          .forEach((f) => {
            values[f.id] = typedName;
          });
        refreshMissing();
      });
    }
  }

  function wirePad() {
    const canvas = root.querySelector("#ffEsignPad");
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

    root.querySelector("#ffEsignPadClear")?.addEventListener("click", () => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, cssW, cssH);
      drawnPng = null;
      refreshMissing();
      paintCurrentPage();
      renderSigBlock();
    });
    root.querySelector("#ffEsignPadUse")?.addEventListener("click", () => {
      // Detect empty pad (mostly white)
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let ink = 0;
      for (let i = 0; i < sample.length; i += 16) {
        if (sample[i] < 250 || sample[i + 1] < 250 || sample[i + 2] < 250) ink++;
      }
      if (ink < 8) {
        const err = root.querySelector("#ffEsignErr");
        if (err) err.textContent = "Please draw your signature first.";
        return;
      }
      drawnPng = canvas.toDataURL("image/png");
      signatureMethod = "drawn";
      refreshMissing();
      paintCurrentPage();
      renderSigBlock();
    });
  }

  async function loadAndPaintPdf() {
    const pdfjs = await loadPdfJs();
    pdfDoc = await pdfjs.getDocument({ url: packet.pdfReadUrl }).promise;
    pageNum = 1;
    await paintCurrentPage();
  }

  function updateZoomInd() {
    const el = root.querySelector("#ffEsignZoomInd");
    if (el) el.textContent = `${Math.round(zoom * 100)}%`;
    const zin = root.querySelector("#ffEsignZoomIn");
    const zout = root.querySelector("#ffEsignZoomOut");
    if (zin) zin.disabled = zoom >= ZOOM_MAX - 0.001;
    if (zout) zout.disabled = zoom <= ZOOM_MIN + 0.001;
  }

  async function paintCurrentPage() {
    if (!pdfDoc || destroyed) return;
    const my = ++renderToken;
    const pagesEl = root.querySelector("#ffEsignPages");
    const ind = root.querySelector("#ffEsignPageInd");
    if (!pagesEl) return;
    if (ind) ind.textContent = `Page ${pageNum} / ${pdfDoc.numPages}`;
    updateZoomInd();

    const page = await pdfDoc.getPage(pageNum);
    if (my !== renderToken) return;
    const viewportEl = root.querySelector("#ffEsignViewport");
    const baseWidth = Math.max(
      280,
      (viewportEl ? viewportEl.clientWidth : 320) - 8
    );
    const unscaled = page.getViewport({ scale: 1 });
    const fit = baseWidth / unscaled.width;
    // CSS size = fit-to-width * user zoom. Bitmap size also multiplies by DPR
    // so Retina/mobile screens stay sharp (zoom re-renders, not CSS stretch).
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const cssScale = fit * zoom;
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
    if (my !== renderToken) return;

    schema()
      .filter((f) => Number(f.page) === pageNum)
      .forEach((f) => {
        const el = document.createElement("div");
        el.className =
          "esign-field" +
          (f.required && isFieldMissing(f) ? " missing" : "") +
          (f.type === "checkbox" && values[f.id] === true ? " checked" : "");
        el.dataset.fieldId = f.id;
        el.style.left = f.x * 100 + "%";
        el.style.top = f.y * 100 + "%";
        el.style.width = f.width * 100 + "%";
        el.style.height = f.height * 100 + "%";
        el.innerHTML = fieldInnerHtml(f);
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          activateField(f);
        });
        layer.appendChild(el);
      });
  }

  function isFieldMissing(f) {
    if (!f.required) return false;
    if (f.type === "checkbox") return values[f.id] !== true;
    if (f.type === "signature") {
      return !drawnPng && !(signatureMethod === "typed" && typedName.trim().length >= 2);
    }
    if (f.type === "typed_name") {
      return String(values[f.id] || typedName || "").trim().length < 2;
    }
    return !String(values[f.id] || "").trim();
  }

  function fieldInnerHtml(f) {
    if (f.type === "checkbox") {
      return `<span class="esign-check">${values[f.id] === true ? "✓" : ""}</span>`;
    }
    if (f.type === "signature") {
      if (drawnPng && signatureMethod === "drawn") {
        return `<img class="esign-sig-img" src="${drawnPng}" alt="">`;
      }
      if (signatureMethod === "typed" && typedName) {
        return `<span class="esign-sig-typed">${esc(typedName)}</span>`;
      }
      return `<span class="esign-ph">${esc(f.label || "Sign")}</span>`;
    }
    const v = String(
      f.type === "typed_name" ? values[f.id] || typedName || "" : values[f.id] || ""
    );
    if (v) return `<span class="esign-val">${esc(v)}</span>`;
    return `<span class="esign-ph">${esc(f.label || f.type)}${f.required ? " *" : ""}</span>`;
  }

  function closeFieldEditor() {
    const ed = root.querySelector("#ffEsignFieldEditor");
    if (ed) {
      ed.hidden = true;
      ed.innerHTML = "";
    }
  }

  function activateField(f) {
    if (f.type === "checkbox") {
      values[f.id] = values[f.id] !== true;
      refreshMissing();
      paintCurrentPage();
      return;
    }
    if (f.type === "signature") {
      root.querySelector("#ffEsignSigBlock")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }

    const ed = root.querySelector("#ffEsignFieldEditor");
    if (!ed) return;
    const current =
      f.type === "typed_name"
        ? String(values[f.id] || typedName || "")
        : String(values[f.id] || "");
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
        const err = root.querySelector("#ffEsignErr");
        if (err) err.textContent = "Use a valid date.";
        return;
      }
      if (f.type === "initials") next = next.slice(0, 8);
      values[f.id] = next;
      if (f.type === "typed_name") {
        typedName = next;
        const nameInp =
          root.querySelector("#ffEsignTyped") ||
          root.querySelector("#ffEsignTypedDraw");
        if (nameInp) nameInp.value = next;
      }
      closeFieldEditor();
      refreshMissing();
      paintCurrentPage();
    };
    ed.querySelector("#ffEsignFieldSave")?.addEventListener("click", apply);
    ed.querySelector("#ffEsignFieldCancel")?.addEventListener("click", closeFieldEditor);
    inp?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        apply();
      }
    });
  }

  function highlightField(id) {
    const el = root.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 1200);
  }

  function focusNextRequired() {
    const miss = missingRequired().filter((f) => f.id !== "__consent__");
    if (!miss.length) {
      if (!consentOk) {
        root.querySelector("#ffEsignConsent")?.focus();
        root.querySelector(".esign-consent")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      return;
    }
    const f = miss[0];
    if (f.type === "signature") {
      root.querySelector("#ffEsignJumpSig")?.click();
      return;
    }
    pageNum = Number(f.page) || 1;
    paintCurrentPage().then(() => {
      highlightField(f.id);
      activateField(f);
    });
  }

  function refreshMissing() {
    const el = root.querySelector("#ffEsignMissing");
    if (!el) return;
    const miss = missingRequired();
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

  async function submit() {
    if (busy || destroyed) return;
    const errEl = root.querySelector("#ffEsignErr");
    const btn = root.querySelector("#ffEsignSubmit");
    const v = uiValidate();
    if (v) {
      if (errEl) errEl.textContent = v;
      focusNextRequired();
      return;
    }
    const cfgRequireDrawn = packet.requireDrawnSignature !== false;
    if (cfgRequireDrawn && !drawnPng && signatureMethod === "drawn") {
      if (errEl) errEl.textContent = "Please draw and use your signature.";
      return;
    }
    if ((packet.requireTypedName === true || signatureMethod === "typed") && typedName.trim().length < 2) {
      if (errEl) errEl.textContent = "Please enter your full name.";
      return;
    }

    busy = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Signing…";
    }
    if (errEl) errEl.textContent = "";

    // Build field values for server
    const fieldValues = { ...values };
    schema().forEach((f) => {
      if (f.type === "typed_name" && !fieldValues[f.id]) {
        fieldValues[f.id] = typedName;
      }
      if (f.type === "checkbox") {
        fieldValues[f.id] = fieldValues[f.id] === true;
      }
    });

    const method =
      packet.requireDrawnSignature !== false ||
      (drawnPng && signatureMethod === "drawn")
        ? "drawn"
        : "typed";
    const signature = {
      method,
      typedName: typedName.trim(),
    };
    if (method === "drawn" && drawnPng) {
      signature.pngBase64 = drawnPng;
    }

    let succeeded = false;
    try {
      const result = await portalHttp(submitName, {
        sessionToken,
        taskId: task.id,
        consentAccepted: true,
        consentText: packet.consentText,
        fieldValues,
        signature,
      });
      succeeded = true;
      if (btn) btn.textContent = "Signed";
      if (typeof onCompleted === "function") {
        onCompleted(result);
      } else {
        setBanner("ok", "Signed", "Your signature was submitted successfully.", false);
      }
    } catch (e) {
      const info = classifyEsignError(e);
      if (info.kind === "cancelled" || info.kind === "invalid") {
        if (typeof onFatalError === "function") onFatalError(e, info);
        else if (errEl) errEl.textContent = info.body;
      } else if (info.kind === "completed") {
        succeeded = true;
        if (typeof onCompleted === "function") onCompleted({ ok: true, alreadyCompleted: true });
        else setBanner("ok", info.title, info.body, false);
      } else {
        if (errEl) errEl.textContent = info.body;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Sign & submit";
        }
      }
    } finally {
      // Keep busy after success so a double-tap cannot re-submit.
      if (!succeeded) busy = false;
    }
  }

  if (done) {
    root.innerHTML = completedSummaryHtml(null);
  } else {
    loadPacket();
  }

  return {
    destroy() {
      destroyed = true;
      if (paintTimer) {
        clearTimeout(paintTimer);
        paintTimer = null;
      }
      try {
        root.innerHTML = "";
      } catch (_) {}
    },
  };
}
