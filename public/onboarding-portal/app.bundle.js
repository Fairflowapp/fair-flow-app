(() => {
  // ../../../private/tmp/od-portal-bundle/app-shared.js
  var CF_NAMES = {
    bootstrap: "onboardingPortalBootstrap",
    getState: "onboardingPortalGetState",
    ack: "onboardingPortalAckPolicy",
    createUpload: "onboardingPortalCreateUpload",
    finalize: "onboardingPortalFinalizeUpload",
    getSignaturePacket: "onboardingPortalGetSignaturePacket",
    submitSignature: "onboardingPortalSubmitSignature"
  };
  var STATUS_LABELS = {
    pending: "Pending",
    in_progress: "In Progress",
    waiting_approval: "Waiting Approval",
    sealing: "Signing\u2026",
    completed: "Completed",
    rejected: "Rejected",
    skipped: "Skipped"
  };
  var state = {
    sessionToken: null,
    dto: null,
    screen: "loading",
    taskId: null,
    busy: false,
    error: "",
    errorKind: "",
    uploadPct: 0,
    scrollOk: false,
    esignCtl: null
  };
  var _requestRender = () => {
  };
  function bindRequestRender(fn) {
    _requestRender = typeof fn === "function" ? fn : () => {
    };
  }
  function requestRender() {
    _requestRender();
  }
  function projectId() {
    try {
      if (window.__ff_firebase_project_id) return String(window.__ff_firebase_project_id);
      if (/fair-flow-staging/.test(location.host)) return "fair-flow-staging";
      if (/fairflowapp\.com/.test(location.host)) return "fairflowapp-db841";
    } catch (_) {
    }
    return "fair-flow-staging";
  }
  function parseTokenFromPath() {
    const parts = String(location.pathname || "").split("/").filter(Boolean);
    if (parts[0] === "onboarding" && parts[1]) {
      let tok = parts[1];
      try {
        tok = decodeURIComponent(tok);
      } catch (_) {
      }
      tok = String(tok || "").split("?")[0].split("#")[0].replace(/[^A-Za-z0-9_-]/g, "");
      return tok;
    }
    try {
      const q = new URLSearchParams(location.search || "");
      const t = q.get("token") || q.get("t") || "";
      return String(t).replace(/[^A-Za-z0-9_-]/g, "");
    } catch (_) {
      return "";
    }
  }
  function parseHashTaskId() {
    const h = String(location.hash || "").replace(/^#/, "");
    const m = h.match(/^\/?tasks?\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]) : null;
  }
  async function _fetchPortal(url, data, timeoutMs) {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctrl && timeoutMs ? setTimeout(() => {
      try {
        ctrl.abort();
      } catch (_) {
      }
    }, timeoutMs) : null;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: data || {} }),
        signal: ctrl ? ctrl.signal : void 0
      });
      const json = await res.json().catch(() => ({}));
      return { res, json };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async function portalHttp(name, data, opts) {
    const fn = String(name || "").trim();
    const isSubmit = /SubmitSignature$/i.test(fn);
    const isUpload = /CreateUpload$/i.test(fn);
    const timeoutMs = opts && Number(opts.timeoutMs) || (isSubmit ? 12e4 : isUpload ? 9e4 : 25e3);
    const urls = [
      `/api/${fn}`,
      `https://us-central1-${projectId()}.cloudfunctions.net/${fn}`
    ];
    let lastErr = null;
    for (let i = 0; i < urls.length; i++) {
      try {
        const { res, json } = await _fetchPortal(urls[i], data, timeoutMs);
        if (!res.ok) {
          const msg = json && json.error && json.error.message || `Request failed (${res.status})`;
          const err = new Error(msg);
          err.status = res.status;
          err.code = json && json.error && json.error.status;
          if (res.status >= 400 && res.status < 500 && res.status !== 404) {
            throw err;
          }
          lastErr = err;
          continue;
        }
        return json.result;
      } catch (e) {
        lastErr = e;
        const aborted = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
        const network = aborted || e && /Failed to fetch|NetworkError|Load failed|abort/i.test(String(e.message || e));
        if (!network && e && e.status && e.status < 500) throw e;
      }
    }
    if (lastErr && lastErr.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw lastErr || new Error("Request failed.");
  }
  var SESS_TTL_MS = 2 * 60 * 60 * 1e3 - 30 * 1e3;
  function persistSession(sessionToken) {
    try {
      const token = parseTokenFromPath();
      if (!token || !sessionToken) return;
      sessionStorage.setItem(
        "ff_od_sess_v1_" + String(token).slice(-20),
        JSON.stringify({
          sessionToken: String(sessionToken),
          exp: Date.now() + SESS_TTL_MS
        })
      );
    } catch (_) {
    }
  }
  function applyDto(dto) {
    if (!dto) return;
    if (dto.sessionToken) {
      state.sessionToken = dto.sessionToken;
      persistSession(dto.sessionToken);
    }
    state.dto = dto;
    if (dto.readOnly || dto.run && dto.run.status === "completed") {
      if (state.screen === "home" || state.screen === "done" || state.screen === "loading") {
        state.screen = "done";
      }
    }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function formatDue(due) {
    if (!due) return "";
    try {
      if (typeof due === "string") {
        const d = new Date(due);
        if (!Number.isNaN(d.getTime())) {
          return d.toLocaleDateString(void 0, {
            year: "numeric",
            month: "short",
            day: "numeric"
          });
        }
        return due;
      }
      if (due.seconds) {
        return new Date(due.seconds * 1e3).toLocaleDateString(void 0, {
          year: "numeric",
          month: "short",
          day: "numeric"
        });
      }
    } catch (_) {
    }
    return "";
  }
  function progressPct(run) {
    const p = run && run.progress || {};
    const total = Number(p.requiredTotal || 0);
    const done = Number(p.requiredCompleted || 0);
    if (!total) return 0;
    return Math.max(0, Math.min(100, Math.round(done / total * 100)));
  }
  function statusBadge(status) {
    const st = String(status || "pending");
    const label = STATUS_LABELS[st] || st;
    const cls = `badge badge-${st in STATUS_LABELS ? st : "pending"}`;
    return `<span class="${cls}">${esc(label)}</span>`;
  }
  function taskIcon(task) {
    if (task.taskType === "policy_acknowledgement") return "\u{1F4CB}";
    if (task.taskType === "document" || task.taskType === "file_upload") return "\u{1F4CE}";
    if (task.taskType === "electronic_signature") return "\u270D\uFE0F";
    return "\u2713";
  }
  function destroyEsign() {
    if (state.esignCtl && typeof state.esignCtl.destroy === "function") {
      try {
        state.esignCtl.destroy();
      } catch (_) {
      }
    }
    state.esignCtl = null;
    try {
      document.getElementById("app")?.classList.remove("esign-mode");
    } catch (_) {
    }
  }
  function root() {
    return document.getElementById("root");
  }
  function setErrorFromException(e) {
    const msg = String(e && e.message || "Something went wrong.");
    state.error = msg;
    if (/already used/i.test(msg)) state.errorKind = "used";
    else if (/cancel/i.test(msg)) state.errorKind = "cancelled";
    else if (/too many|try again later/i.test(msg) || e.status === 429) state.errorKind = "rate";
    else if (/invalid|expired|link/i.test(msg) || e.status === 401) state.errorKind = "invalid";
    else state.errorKind = "generic";
    state.screen = "error";
  }

  // ../../../private/tmp/od-portal-bundle/app-home.js
  function renderHome(dto, { completedView }) {
    const salon = dto.salon && dto.salon.name || "Your salon";
    const staff = dto.staff && dto.staff.displayName || "Team member";
    const pkg = dto.run && dto.run.packageNameSnapshot || "Onboarding";
    const due = formatDue(dto.run && dto.run.dueDate);
    const pct = progressPct(dto.run);
    const p = dto.run && dto.run.progress || {};
    const tasks = Array.isArray(dto.tasks) ? dto.tasks : [];
    const banner = completedView ? `<div class="readonly-banner">Onboarding complete \u2014 viewing only. Signed documents can\u2019t be changed.</div>` : "";
    const taskList = tasks.map((t) => {
      const openable = !completedView || true;
      let meta = t.categoryNameSnapshot || "";
      if (t.taskType === "electronic_signature") {
        meta = t.config && t.config.documentTitle || meta || "Electronic signature";
        if (t.status === "completed") meta += " \xB7 Signed";
      }
      meta += t.required === false ? " \xB7 Optional" : " \xB7 Required";
      return `
        <button type="button" class="task" data-task-id="${esc(t.id)}" ${openable ? "" : "disabled"}>
          <div class="task-icon" aria-hidden="true">${taskIcon(t)}</div>
          <div class="task-body">
            <p class="task-name">${esc(t.templateNameSnapshot || "Task")}</p>
            <p class="task-meta">${esc(meta)}</p>
          </div>
          ${statusBadge(t.status)}
        </button>`;
    }).join("");
    return `
    ${banner}
    <div class="card">
      <p class="sub" style="font-weight:700;color:var(--brand1);margin-bottom:6px;">${esc(salon)}</p>
      <h1 class="hero-title">${completedView ? "You're all set" : `Welcome, ${esc(staff)}`}</h1>
      <p class="sub">${completedView ? `${esc(pkg)} is complete. You can review tasks below.` : `${esc(pkg)} \u2014 complete the items below.`}</p>
      <div class="meta-row">
        <span class="chip">${esc(staff)}</span>
        ${due ? `<span class="chip">Due ${esc(due)}</span>` : ""}
        ${dto.expiresAt ? `<span class="chip">Link expires ${esc(formatDue(dto.expiresAt))}</span>` : ""}
      </div>
      <div class="progress-block">
        <div class="progress-label">
          <span>Progress</span>
          <span>${Number(p.requiredCompleted || 0)}/${Number(p.requiredTotal || 0)} required \xB7 ${pct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>
    <div class="section-title">Tasks</div>
    <div>${taskList || `<div class="card"><p class="sub">No tasks in this onboarding.</p></div>`}</div>
  `;
  }
  function wireHome() {
    root().querySelectorAll("[data-task-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-task-id");
        openTask(id);
      });
    });
  }
  function openTask(taskId) {
    state.taskId = taskId;
    state.screen = "task";
    state.error = "";
    state.scrollOk = false;
    state.uploadPct = 0;
    try {
      history.replaceState(null, "", `#/task/${encodeURIComponent(taskId)}`);
    } catch (_) {
    }
    requestRender();
  }
  function goHome() {
    destroyEsign();
    state.taskId = null;
    state.error = "";
    const dto = state.dto;
    state.screen = dto && (dto.readOnly || dto.run && dto.run.status === "completed") ? "done" : "home";
    try {
      history.replaceState(null, "", location.pathname);
    } catch (_) {
    }
    requestRender();
  }

  // ../../../private/tmp/od-portal-bundle/esign-signer-helpers.js
  var PDFJS_VERSION = "4.8.69";
  var PDFJS_MOD = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
  var PDFJS_WORKER = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;
  var _pdfjs = null;
  function esc2(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
    const msg = String(e && e.message || "Something went wrong.");
    const status = e && e.status;
    if (/cancel/i.test(msg)) {
      return {
        kind: "cancelled",
        title: "Onboarding cancelled",
        body: "This onboarding was cancelled. Ask your manager for help.",
        msg
      };
    }
    if (/invalid|expired|link|unauthenticated/i.test(msg) || status === 401) {
      return {
        kind: "invalid",
        title: "Link unavailable",
        body: "This link is invalid, expired, or no longer active. Ask your manager for a new link.",
        msg
      };
    }
    if (/hash|mismatch|version_mismatch/i.test(msg)) {
      return {
        kind: "hash",
        title: "Document changed",
        body: "The document no longer matches what was assigned. Ask your manager to send a new task.",
        msg
      };
    }
    if (/already completed|complete\. Viewing/i.test(msg)) {
      return {
        kind: "completed",
        title: "Already signed",
        body: "This document was already signed.",
        msg
      };
    }
    if (/Failed to fetch|NetworkError|network|offline|Load failed/i.test(msg) || status === 0) {
      return {
        kind: "network",
        title: "Connection lost",
        body: "Check your connection and try again. If you already signed, you won\u2019t create a duplicate.",
        msg
      };
    }
    if (/signBlob|iam\.serviceAccounts|Permission ['"]?iam\./i.test(msg)) {
      return {
        kind: "generic",
        title: "Couldn\u2019t open the document",
        body: "Please try again. If it still fails, ask your manager to send the form again.",
        msg
      };
    }
    return {
      kind: "generic",
      title: "Couldn\u2019t open the form",
      body: msg,
      msg
    };
  }
  function pdfJsSourceFromPacket(packet) {
    if (packet && packet.pdfBase64) {
      const bin = atob(String(packet.pdfBase64));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return { data: bytes };
    }
    if (packet && packet.pdfReadUrl) {
      return { url: packet.pdfReadUrl };
    }
    throw new Error("Document is missing. Ask your manager to send the form again.");
  }

  // ../../../private/tmp/od-portal-bundle/esign-signer-paint.js
  function attachEsignPaint(s) {
    s.schedulePaint = function schedulePaint() {
      if (s.paintTimer) clearTimeout(s.paintTimer);
      s.paintTimer = setTimeout(() => {
        s.paintTimer = null;
        s.paintCurrentPage();
      }, 120);
    };
    s.loadAndPaintPdf = async function loadAndPaintPdf() {
      const pdfjs = await loadPdfJs();
      s.pdfDoc = await pdfjs.getDocument(pdfJsSourceFromPacket(s.packet)).promise;
      s.pageNum = 1;
      await s.paintCurrentPage();
    };
    s.updateZoomInd = function updateZoomInd() {
      const el = s.root.querySelector("#ffEsignZoomInd");
      if (el) el.textContent = `${Math.round(s.zoom * 100)}%`;
      const zin = s.root.querySelector("#ffEsignZoomIn");
      const zout = s.root.querySelector("#ffEsignZoomOut");
      if (zin) zin.disabled = s.zoom >= s.ZOOM_MAX - 1e-3;
      if (zout) zout.disabled = s.zoom <= s.ZOOM_MIN + 1e-3;
    };
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
      s.schema().filter((f) => Number(f.page) === s.pageNum).forEach((f) => {
        const el = document.createElement("div");
        el.className = "esign-field" + (f.required && s.isFieldMissing(f) ? " missing" : "") + (f.type === "checkbox" && s.values[f.id] === true ? " checked" : "");
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
    };
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
    };
    s.fieldInnerHtml = function fieldInnerHtml(f) {
      if (f.type === "checkbox") {
        return `<span class="esign-check">${s.values[f.id] === true ? "\u2713" : ""}</span>`;
      }
      if (f.type === "signature") {
        if (s.drawnPng && s.signatureMethod === "drawn") {
          return `<img class="esign-sig-img" src="${s.drawnPng}" alt="">`;
        }
        if (s.signatureMethod === "typed" && s.typedName) {
          return `<span class="esign-sig-typed">${esc2(s.typedName)}</span>`;
        }
        return `<span class="esign-ph">${esc2(f.label || "Sign")}</span>`;
      }
      const v = String(
        f.type === "typed_name" ? s.values[f.id] || s.typedName || "" : s.values[f.id] || ""
      );
      if (v) return `<span class="esign-val">${esc2(v)}</span>`;
      return `<span class="esign-ph">${esc2(f.label || f.type)}${f.required ? " *" : ""}</span>`;
    };
    s.closeFieldEditor = function closeFieldEditor() {
      const ed = s.root.querySelector("#ffEsignFieldEditor");
      if (ed) {
        ed.hidden = true;
        ed.innerHTML = "";
      }
    };
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
          block: "center"
        });
        return;
      }
      const ed = s.root.querySelector("#ffEsignFieldEditor");
      if (!ed) return;
      const current = f.type === "typed_name" ? String(s.values[f.id] || s.typedName || "") : String(s.values[f.id] || "");
      const label = f.label || f.type;
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const inputType = f.type === "date" ? "date" : f.type === "initials" ? "text" : "text";
      const placeholder = f.type === "initials" ? "e.g. JD" : f.type === "typed_name" ? "Full legal name" : "Enter value";
      const maxlen = f.type === "initials" ? ' maxlength="8"' : f.type === "text" ? ' maxlength="200"' : "";
      ed.hidden = false;
      ed.innerHTML = `
      <div class="esign-editor-card">
        <label for="ffEsignFieldInp">${esc2(label)}${f.required ? " *" : ""}</label>
        <input id="ffEsignFieldInp" type="${inputType}" value="${esc2(
        f.type === "date" ? current || today : current
      )}" placeholder="${esc2(placeholder)}"${maxlen} autocomplete="${f.type === "typed_name" ? "name" : "off"}" />
        <div class="btn-row row-2" style="margin-top:8px;">
          <button type="button" class="btn btn-secondary" id="ffEsignFieldCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="ffEsignFieldSave">Save</button>
        </div>
      </div>`;
      ed.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const inp = ed.querySelector("#ffEsignFieldInp");
      setTimeout(() => inp?.focus(), 50);
      const apply = () => {
        let next = String(inp && inp.value || "").trim();
        if (f.type === "date" && next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) {
          const err = s.root.querySelector("#ffEsignErr");
          if (err) err.textContent = "Use a valid date.";
          return;
        }
        if (f.type === "initials") next = next.slice(0, 8);
        s.values[f.id] = next;
        if (f.type === "typed_name") {
          s.typedName = next;
          const nameInp = s.root.querySelector("#ffEsignTyped") || s.root.querySelector("#ffEsignTypedDraw");
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
    };
    s.highlightField = function highlightField(id) {
      const el = s.root.querySelector(`[data-field-id="${CSS.escape(id)}"]`);
      if (!el) return;
      el.classList.add("pulse");
      setTimeout(() => el.classList.remove("pulse"), 1200);
    };
    s.focusNextRequired = function focusNextRequired() {
      const miss = s.missingRequired().filter((f2) => f2.id !== "__consent__");
      if (!miss.length) {
        if (!s.consentOk) {
          s.root.querySelector("#ffEsignConsent")?.focus();
          s.root.querySelector(".esign-consent")?.scrollIntoView({
            behavior: "smooth",
            block: "center"
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
    };
    s.refreshMissing = function refreshMissing() {
      const el = s.root.querySelector("#ffEsignMissing");
      if (!el) return;
      const miss = s.missingRequired();
      if (!miss.length) {
        el.innerHTML = `<div class="alert alert-ok" style="margin:0;">Ready to sign.</div>`;
        return;
      }
      el.innerHTML = `<div class="alert alert-warn" style="margin:0;">Still needed: ${esc2(
        miss.map((f) => f.label || f.id).slice(0, 5).join(", ")
      )}</div>`;
    };
  }

  // ../../../private/tmp/od-portal-bundle/esign-signer-chrome.js
  function attachEsignChrome(s) {
    s.renderSigner = async function renderSigner() {
      const cfgRequireDrawn = s.packet.requireDrawnSignature !== false;
      const cfgRequireTyped = s.packet.requireTypedName === true;
      if (!s.signatureMethod) {
        s.signatureMethod = cfgRequireDrawn ? "drawn" : "typed";
      } else if (cfgRequireDrawn) {
        s.signatureMethod = "drawn";
      }
      const showMethodToggle = !cfgRequireDrawn;
      s.root.innerHTML = `
      <div class="esign-shell">
        <div class="esign-toolbar">
          <button type="button" class="esign-icon-btn" id="ffEsignPrev" aria-label="Previous page">\u2039</button>
          <span class="esign-page-ind" id="ffEsignPageInd">Page 1</span>
          <button type="button" class="esign-icon-btn" id="ffEsignNext" aria-label="Next page">\u203A</button>
          <span class="esign-toolbar-spacer"></span>
          <button type="button" class="esign-icon-btn" id="ffEsignZoomOut" aria-label="Zoom out">\u2212</button>
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
          ${showMethodToggle ? `<div class="field" style="margin-top:12px;">
            <label>Signature method</label>
            <div class="esign-method">
              <button type="button" class="esign-chip ${s.signatureMethod === "drawn" ? "active" : ""}" data-esign-method="drawn">Draw</button>
              <button type="button" class="esign-chip ${s.signatureMethod === "typed" ? "active" : ""}" data-esign-method="typed">Type name</button>
            </div>
          </div>` : `<div class="field" style="margin-top:12px;"><label>Your signature</label></div>`}
          <div id="ffEsignSigBlock"></div>
          <div class="field">
            <label class="esign-consent">
              <input type="checkbox" id="ffEsignConsent" />
              <span>${esc2(s.packet.consentText || "I agree to sign electronically.")}</span>
            </label>
          </div>
          <div class="error-msg" id="ffEsignErr"></div>
          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="ffEsignSubmit">Sign &amp; submit</button>
          </div>
          <p class="sub" style="margin-top:8px;text-align:center;">Your signature is sealed securely. You can\u2019t change it after submit.</p>
        </div>
      </div>`;
      s.wireChrome(cfgRequireDrawn, cfgRequireTyped);
      await s.loadAndPaintPdf();
      s.refreshMissing();
      s.renderSigBlock();
    };
    s.setZoom = function setZoom(next, opts) {
      const z = Math.min(
        s.ZOOM_MAX,
        Math.max(s.ZOOM_MIN, Number(Number(next).toFixed(3)))
      );
      if (Math.abs(z - s.zoom) < 1e-3) {
        s.updateZoomInd();
        return false;
      }
      s.zoom = z;
      s.updateZoomInd();
      if (opts && opts.immediate) s.paintCurrentPage();
      else s.schedulePaint();
      return true;
    };
    s.wirePinchAndWheelZoom = function wirePinchAndWheelZoom() {
      const viewportEl = s.root.querySelector("#ffEsignViewport");
      if (!viewportEl || viewportEl.dataset.ffZoomGestures === "1") return;
      viewportEl.dataset.ffZoomGestures = "1";
      let pinch = null;
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
            startZoom: s.zoom
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
              startZoom: s.zoom
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
    };
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
          block: "center"
        });
      });
      s.root.querySelectorAll("[data-esign-method]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const m = btn.getAttribute("data-esign-method");
          if (m === "drawn" && cfgRequireDrawn === false && !cfgRequireTyped) {
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
    };
    s.renderSigBlock = function renderSigBlock() {
      const block = s.root.querySelector("#ffEsignSigBlock");
      if (!block) return;
      if (s.signatureMethod === "typed") {
        block.innerHTML = `
        <div class="field">
          <label for="ffEsignTyped">Typed full name</label>
          <input id="ffEsignTyped" type="text" autocomplete="name" placeholder="Your full legal name" value="${esc2(s.typedName)}" />
          <div class="esign-typed-preview" id="ffEsignTypedPreview">${esc2(s.typedName || "Your name will appear here")}</div>
        </div>`;
        const inp = block.querySelector("#ffEsignTyped");
        const prev = block.querySelector("#ffEsignTypedPreview");
        inp?.addEventListener("input", () => {
          s.typedName = String(inp.value || "");
          if (prev) prev.textContent = s.typedName || "Your name will appear here";
          s.schema().filter((f) => f.type === "typed_name").forEach((f) => {
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
          ${s.drawnPng ? `<div class="esign-sig-thumb"><img src="${s.drawnPng}" alt="Signature preview"></div>` : `<p class="sub" style="margin-top:8px;">Draw with your finger, then tap Use signature.</p>`}
          <div class="field" style="margin-top:10px;">
            <label for="ffEsignTypedDraw">Full name (required)</label>
            <input id="ffEsignTypedDraw" type="text" autocomplete="name" placeholder="Your full legal name" value="${esc2(s.typedName)}" />
          </div>
        </div>`;
        s.wirePad();
        const nameInp = block.querySelector("#ffEsignTypedDraw");
        nameInp?.addEventListener("input", () => {
          s.typedName = String(nameInp.value || "");
          s.schema().filter((f) => f.type === "typed_name").forEach((f) => {
            s.values[f.id] = s.typedName;
          });
          s.refreshMissing();
        });
      }
    };
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
    };
  }

  // ../../../private/tmp/od-portal-bundle/esign-signer.js
  function mountEsignSigner(hostEl, opts) {
    const s = {
      hostEl,
      opts: opts || {},
      task: (opts || {}).task,
      sessionToken: (opts || {}).sessionToken,
      portalHttp: (opts || {}).portalHttp,
      getPacketName: (opts || {}).getPacketName || "onboardingPortalGetSignaturePacket",
      submitName: (opts || {}).submitName || "onboardingPortalSubmitSignature",
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
      done: false
    };
    s.done = s.task && (s.task.status === "completed" || s.task.resultPublic && s.task.resultPublic.signedPdfSha256);
    s.hostEl.innerHTML = `
    <div class="esign-root" id="ffEsignRoot">
      <div class="esign-loading" id="ffEsignLoading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="sub">Loading document\u2026</p>
      </div>
    </div>`;
    s.root = s.hostEl.querySelector("#ffEsignRoot");
    attachEsignPaint(s);
    attachEsignChrome(s);
    s.completedSummaryHtml = function completedSummaryHtml(pkt) {
      const cfg = s.task && s.task.config || {};
      const res = Object.assign(
        {},
        s.task && s.task.resultPublic || {},
        pkt && pkt.resultPublic || {}
      );
      const title = pkt && pkt.documentTitle || cfg.documentTitle || s.task && s.task.templateNameSnapshot || "Document";
      let when = "";
      if (res.signedAt) {
        try {
          when = new Date(res.signedAt).toLocaleString();
        } catch (_) {
          when = String(res.signedAt);
        }
      }
      const signer = res.signerName || "";
      const versionRaw = pkt && pkt.documentVersion != null ? pkt.documentVersion : cfg.documentVersion != null ? cfg.documentVersion : "";
      const version = versionRaw === "" || versionRaw == null ? "" : String(versionRaw);
      return `
      <div class="alert alert-ok">
        <strong>Signed &amp; complete</strong>
        <div style="margin-top:8px;font-size:13px;line-height:1.45;">
          ${esc2(title)} is sealed. You can\u2019t change it.
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:12px;">
          ${when ? `<span style="opacity:.75;">Signed</span><span>${esc2(when)}</span>` : ""}
          ${signer ? `<span style="opacity:.75;">Signer</span><span>${esc2(signer)}</span>` : ""}
          ${version ? `<span style="opacity:.75;">Version</span><span>${esc2(version)}</span>` : ""}
        </div>
      </div>
      <p class="sub" style="margin-top:12px;text-align:center;">Use Back to list to continue onboarding.</p>`;
    };
    s.setBanner = function setBanner(kind, title, body, retryable) {
      s.root.innerHTML = `
      <div class="alert alert-${kind === "ok" ? "ok" : kind === "warn" ? "warn" : "danger"}">
        <strong>${esc2(title)}</strong>
        <div style="margin-top:6px;">${esc2(body)}</div>
      </div>
      ${retryable ? `<div class="btn-row" style="margin-top:12px;">
              <button type="button" class="btn btn-primary" id="ffEsignRetry">Try again</button>
            </div>` : ""}`;
      const retry = s.root.querySelector("#ffEsignRetry");
      if (retry) retry.addEventListener("click", () => s.loadPacket());
    };
    s.loadPacket = async function loadPacket() {
      if (s.destroyed) return;
      s.root.innerHTML = `
      <div class="esign-loading">
        <div class="spinner" aria-hidden="true"></div>
        <p class="sub">Loading document\u2026</p>
      </div>`;
      try {
        s.packet = await s.portalHttp(s.getPacketName, {
          sessionToken: s.sessionToken,
          taskId: s.task.id
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
    };
    s.schema = function schema() {
      return Array.isArray(s.packet && s.packet.fieldSchema) ? s.packet.fieldSchema : [];
    };
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
    };
    s.uiValidate = function uiValidate() {
      const miss = s.missingRequired();
      if (!miss.length) return null;
      const labels = miss.map((f) => f.label || f.id).slice(0, 6);
      return `Please complete: ${labels.join(", ")}`;
    };
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
        btn.textContent = "Signing\u2026";
      }
      if (errEl) errEl.textContent = "";
      const fieldValues = { ...s.values || {} };
      s.schema().forEach((f) => {
        if (f.type === "typed_name" && !fieldValues[f.id]) {
          fieldValues[f.id] = s.typedName;
        }
        if (f.type === "checkbox") {
          fieldValues[f.id] = fieldValues[f.id] === true;
        }
      });
      const method = s.packet.requireDrawnSignature !== false || s.drawnPng && s.signatureMethod === "drawn" ? "drawn" : "typed";
      const signature = {
        method,
        typedName: String(s.typedName || "").trim()
      };
      if (method === "drawn" && s.drawnPng) {
        signature.pngBase64 = s.drawnPng;
      }
      let succeeded = false;
      try {
        const result = await s.portalHttp(s.submitName, {
          sessionToken: s.sessionToken,
          taskId: s.task.id,
          consentAccepted: true,
          consentText: s.packet.consentText,
          fieldValues,
          signature
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
          else if (errEl) errEl.textContent = info.body || String(e && e.message || e);
        } else if (info.kind === "completed") {
          succeeded = true;
          if (typeof s.onCompleted === "function") s.onCompleted({ ok: true, alreadyCompleted: true });
          else s.setBanner("ok", info.title, info.body, false);
        } else {
          if (errEl) {
            errEl.textContent = info && info.body || String(e && e.message || e || "Submit failed");
          }
        }
        if (!succeeded && btn) {
          btn.disabled = false;
          btn.textContent = "Sign & submit";
        }
      } finally {
        if (!succeeded) s.busy = false;
      }
    };
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
        } catch (_) {
        }
      }
    };
  }

  // ../../../private/tmp/od-portal-bundle/app-task.js
  function renderTaskDetail(dto, task) {
    const readOnly = !!(dto.readOnly || dto.run.status === "completed");
    const st = String(task.status || "pending");
    let body = "";
    if (task.taskType === "policy_acknowledgement") {
      body = renderPolicy(task, readOnly);
    } else if (task.taskType === "document" || task.taskType === "file_upload") {
      body = renderUpload(task, readOnly);
    } else if (task.taskType === "electronic_signature") {
      body = `<div id="ffEsignMount" class="esign-mount"></div>`;
    } else {
      body = `<div class="alert alert-info">This task type isn\u2019t supported in the portal yet. Please contact your manager.</div>`;
    }
    const isEsign = task.taskType === "electronic_signature";
    return `
    <button type="button" class="back-link" id="ffPortalBack">\u2190 Back to list</button>
    <div class="card ${isEsign ? "card-esign" : ""}">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
        <div>
          <h1 class="hero-title" style="font-size:20px;">${esc(task.templateNameSnapshot || "Task")}</h1>
          <p class="sub">${esc(
      isEsign ? task.config && task.config.documentTitle || task.categoryNameSnapshot || "Electronic signature" : task.categoryNameSnapshot || ""
    )}</p>
        </div>
        ${statusBadge(st)}
      </div>
      ${body}
      <div class="error-msg" id="ffPortalTaskErr">${esc(state.error)}</div>
    </div>`;
  }
  function sanitizePolicyHtmlClient(html) {
    let s = String(html == null ? "" : html);
    s = s.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
    s = s.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");
    s = s.replace(/<iframe[\s\S]*?>[\s\S]*?<\/iframe>/gi, "");
    s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    s = s.replace(/javascript:/gi, "");
    s = s.replace(/data:/gi, "");
    s = s.replace(
      /<\/?(?!\/?(p|br|ul|ol|li|strong|em|b|i|a|h1|h2|h3)\b)[^>]*>/gi,
      ""
    );
    return s.slice(0, 1e5);
  }
  function renderPolicy(task, readOnly) {
    const cfg = task.config || {};
    const done = task.status === "completed";
    const html = sanitizePolicyHtmlClient(
      cfg.bodyHtml || "<p>No policy text provided.</p>"
    );
    const needName = cfg.requireTypedName === true;
    const needScroll = cfg.requireScrollToEnd === true && !done && !readOnly;
    return `
    ${done ? `<div class="alert alert-ok">Policy acknowledged. Thank you.</div>` : ""}
    ${readOnly && !done ? `<div class="alert alert-info">Viewing only.</div>` : ""}
    <div class="field">
      <label>Policy${cfg.version ? ` \xB7 v${esc(cfg.version)}` : ""}</label>
      <div class="policy-box" id="ffPolicyBox">${html}</div>
      ${needScroll ? `<p class="sub" style="margin-top:8px;" id="ffScrollHint">Scroll to the end to enable acknowledge.</p>` : ""}
    </div>
    ${needName && !done && !readOnly ? `<div class="field">
            <label for="ffTypedName">Type your full name</label>
            <input id="ffTypedName" type="text" autocomplete="name" placeholder="Full name">
          </div>` : ""}
    ${!done && !readOnly ? `<div class="btn-row">
            <button type="button" class="btn btn-primary" id="ffAckBtn" ${needScroll ? "disabled" : ""}>I acknowledge</button>
          </div>` : ""}
  `;
  }
  function renderUpload(task, readOnly) {
    const cfg = task.config || {};
    const st = String(task.status || "pending");
    const rejected = st === "rejected";
    const waiting = st === "waiting_approval";
    const done = st === "completed";
    const canUpload = !readOnly && !done && !waiting;
    const accept = Array.isArray(cfg.acceptedMime) ? cfg.acceptedMime.join(",") : "";
    const maxMb = Number(cfg.maxSizeMb) || 10;
    const reason = task.resultPublic && task.resultPublic.rejectionReason ? task.resultPublic.rejectionReason : "";
    let statusBlock = "";
    if (done) statusBlock = `<div class="alert alert-ok">Document received.</div>`;
    else if (waiting)
      statusBlock = `<div class="alert alert-ok">Document received.</div>`;
    else if (rejected)
      statusBlock = `<div class="alert alert-danger">Rejected${reason ? ": " + esc(reason) : ""}. Please upload again.</div>`;
    return `
    ${statusBlock}
    <p class="sub" style="margin-top:10px;">Accepted: ${esc(accept || "common documents/images")} \xB7 Max ${esc(String(maxMb))} MB</p>
    ${canUpload ? `
      <div class="file-drop" style="margin-top:14px;">
        <strong>${rejected ? "Upload a new file" : "Choose a file"}</strong>
        <span class="sub">Tap to browse</span>
        <input type="file" id="ffFileInput" ${accept ? `accept="${esc(accept)}"` : ""}>
      </div>
      <p class="sub" id="ffFileName" style="margin-top:8px;"></p>
      <div class="upload-bar" id="ffUploadBar"><i id="ffUploadFill"></i></div>
      ${cfg.requiresExpiration ? `<div class="field">
              <label for="ffExpDate">Expiration date</label>
              <input id="ffExpDate" type="date">
            </div>` : ""}
      <div class="field">
        <label for="ffNotes">Notes (optional)</label>
        <textarea id="ffNotes" rows="2" placeholder="Anything your manager should know"></textarea>
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary" id="ffUploadBtn" disabled>Upload</button>
      </div>` : ""}
    ${waiting && !readOnly ? `<div class="alert alert-info" style="margin-top:12px;">You can close this page. We\u2019ll keep your submission for review.</div>` : ""}
  `;
  }
  function wireTaskDetail(task) {
    const back = document.getElementById("ffPortalBack");
    if (back) back.addEventListener("click", goHome);
    if (task.taskType === "electronic_signature") {
      destroyEsign();
      try {
        document.getElementById("app")?.classList.add("esign-mode");
      } catch (_) {
      }
      const mount = document.getElementById("ffEsignMount");
      if (mount) {
        state.esignCtl = mountEsignSigner(mount, {
          task,
          sessionToken: state.sessionToken,
          portalHttp,
          getPacketName: CF_NAMES.getSignaturePacket,
          submitName: CF_NAMES.submitSignature,
          onCompleted: async (result) => {
            try {
              if (result && result.state) {
                applyDto(result.state);
              } else {
                const fresh = await portalHttp(CF_NAMES.getState, {
                  sessionToken: state.sessionToken
                });
                applyDto(fresh);
              }
            } catch (_) {
            }
            state.error = "";
            destroyEsign();
            if (state.dto && (state.dto.readOnly || state.dto.run && state.dto.run.status === "completed")) {
              state.screen = "done";
              state.taskId = null;
              try {
                history.replaceState(null, "", location.pathname);
              } catch (_) {
              }
            } else {
              state.screen = "home";
              state.taskId = null;
              try {
                history.replaceState(null, "", location.pathname);
              } catch (_) {
              }
            }
            requestRender();
          },
          onFatalError: (e) => {
            destroyEsign();
            setErrorFromException(e);
            requestRender();
          }
        });
      }
      return;
    }
    if (task.taskType === "policy_acknowledgement") {
      const box = document.getElementById("ffPolicyBox");
      const btn = document.getElementById("ffAckBtn");
      const cfg = task.config || {};
      if (box && btn && cfg.requireScrollToEnd) {
        const check = () => {
          const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
          state.scrollOk = atEnd || box.scrollHeight <= box.clientHeight + 4;
          btn.disabled = !state.scrollOk || state.busy;
          const hint = document.getElementById("ffScrollHint");
          if (hint && state.scrollOk) hint.textContent = "Ready to acknowledge.";
        };
        box.addEventListener("scroll", check, { passive: true });
        setTimeout(check, 50);
      }
      if (btn) {
        btn.addEventListener("click", () => submitAck(task));
      }
    }
    if (task.taskType === "document" || task.taskType === "file_upload") {
      const input = document.getElementById("ffFileInput");
      const uploadBtn = document.getElementById("ffUploadBtn");
      const nameEl = document.getElementById("ffFileName");
      let file = null;
      if (input) {
        input.addEventListener("change", () => {
          file = input.files && input.files[0] ? input.files[0] : null;
          if (nameEl) nameEl.textContent = file ? file.name : "";
          if (uploadBtn) uploadBtn.disabled = !file || state.busy;
          state.error = "";
          const err = document.getElementById("ffPortalTaskErr");
          if (err) err.textContent = "";
        });
      }
      if (uploadBtn) {
        uploadBtn.addEventListener("click", () => {
          if (!file) return;
          submitUpload(task, file);
        });
      }
    }
  }
  async function submitAck(task) {
    if (state.busy) return;
    const cfg = task.config || {};
    const typedEl = document.getElementById("ffTypedName");
    const typedName = typedEl ? String(typedEl.value || "").trim() : "";
    if (cfg.requireTypedName && !typedName) {
      state.error = "Please type your full name.";
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      return;
    }
    if (cfg.requireScrollToEnd && !state.scrollOk) {
      state.error = "Please scroll to the end of the policy.";
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      return;
    }
    state.busy = true;
    const btn = document.getElementById("ffAckBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving\u2026";
    }
    try {
      const dto = await portalHttp(CF_NAMES.ack, {
        sessionToken: state.sessionToken,
        taskId: task.id,
        typedName: typedName || void 0
      });
      applyDto(dto);
      state.error = "";
      if (dto.readOnly || dto.run && dto.run.status === "completed") {
        state.screen = "done";
        state.taskId = null;
        try {
          history.replaceState(null, "", location.pathname);
        } catch (_) {
        }
      }
      requestRender();
    } catch (e) {
      state.error = e && e.message || "Could not save acknowledgement.";
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "I acknowledge";
      }
    } finally {
      state.busy = false;
    }
  }
  function extMimeGuess(name) {
    const n = String(name || "").toLowerCase();
    if (n.endsWith(".png")) return "image/png";
    if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
    if (n.endsWith(".gif")) return "image/gif";
    if (n.endsWith(".webp")) return "image/webp";
    if (n.endsWith(".pdf")) return "application/pdf";
    if (n.endsWith(".heic")) return "image/heic";
    return "";
  }
  function mimeAllowed(file, acceptedMime) {
    if (!Array.isArray(acceptedMime) || !acceptedMime.length) return true;
    const name = String(file.name || "").toLowerCase();
    const type = String(file.type || extMimeGuess(name) || "").toLowerCase();
    return acceptedMime.some((rule) => {
      const r = String(rule || "").trim().toLowerCase();
      if (!r) return false;
      if (r.endsWith("/*")) {
        const prefix = r.slice(0, -1);
        return type.startsWith(prefix);
      }
      if (r.startsWith(".")) return name.endsWith(r);
      return type === r;
    });
  }
  function fileToBase64(file, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (ev) => {
        if (!ev.lengthComputable || typeof onProgress !== "function") return;
        onProgress(Math.round(ev.loaded / ev.total * 30));
      };
      reader.onload = () => {
        const result = String(reader.result || "");
        const comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsDataURL(file);
    });
  }
  function friendlyUploadError(e) {
    const msg = String(e && e.message || "Upload failed.");
    if (/signBlob|iam\.serviceAccounts|Permission ['"]?iam\./i.test(msg)) {
      return "Could not upload the file. Please try again.";
    }
    return msg;
  }
  function putWithProgress(uploadUrl, file, contentType, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", contentType || file.type || "application/octet-stream");
      xhr.upload.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        onProgress(Math.round(ev.loaded / ev.total * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("Upload network error"));
      xhr.send(file);
    });
  }
  async function submitUpload(task, file) {
    if (state.busy || !file) return;
    const cfg = task.config || {};
    const maxMb = Number(cfg.maxSizeMb) || 10;
    if (file.size > maxMb * 1024 * 1024) {
      state.error = `File must be under ${maxMb} MB.`;
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      return;
    }
    if (!mimeAllowed(file, cfg.acceptedMime)) {
      state.error = "This file type is not accepted.";
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      return;
    }
    const expEl = document.getElementById("ffExpDate");
    const notesEl = document.getElementById("ffNotes");
    const expirationDate = expEl ? String(expEl.value || "").trim() : "";
    if (cfg.requiresExpiration && !expirationDate) {
      state.error = "Expiration date is required.";
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      return;
    }
    state.busy = true;
    const btn = document.getElementById("ffUploadBtn");
    const bar = document.getElementById("ffUploadBar");
    const fill = document.getElementById("ffUploadFill");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Uploading\u2026";
    }
    if (bar) bar.style.display = "block";
    if (fill) fill.style.width = "0%";
    try {
      const contentType = file.type || extMimeGuess(file.name) || "application/octet-stream";
      const fileBase64 = await fileToBase64(file, (pct) => {
        state.uploadPct = pct;
        if (fill) fill.style.width = `${pct}%`;
      });
      if (fill) fill.style.width = "40%";
      const created = await portalHttp(CF_NAMES.createUpload, {
        sessionToken: state.sessionToken,
        taskId: task.id,
        fileName: file.name,
        contentType,
        size: file.size,
        fileBase64
      });
      if (created && created.uploadUrl && !created.uploaded) {
        await putWithProgress(created.uploadUrl, file, contentType, (pct) => {
          state.uploadPct = pct;
          if (fill) fill.style.width = `${pct}%`;
        });
      }
      if (fill) fill.style.width = "100%";
      if (btn) btn.textContent = "Finalizing\u2026";
      const fin = await portalHttp(CF_NAMES.finalize, {
        sessionToken: state.sessionToken,
        uploadId: created.uploadId,
        expirationDate: expirationDate || void 0,
        notes: notesEl ? String(notesEl.value || "").trim() || void 0 : void 0
      });
      if (fin && fin.state) applyDto(fin.state);
      else if (state.sessionToken) {
        const fresh = await portalHttp(CF_NAMES.getState, {
          sessionToken: state.sessionToken
        });
        applyDto(fresh);
      }
      state.error = "";
      requestRender();
    } catch (e) {
      state.error = friendlyUploadError(e);
      const err = document.getElementById("ffPortalTaskErr");
      if (err) err.textContent = state.error;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Upload";
      }
    } finally {
      state.busy = false;
    }
  }

  // ../../../private/tmp/od-portal-bundle/app.js
  function render() {
    const el = root();
    if (!el) return;
    if (state.screen !== "task") destroyEsign();
    if (state.screen === "loading") {
      el.innerHTML = `
      <div class="state">
        <div class="spinner" aria-hidden="true"></div>
        <h1>Loading your onboarding\u2026</h1>
        <p class="sub">Please wait a moment.</p>
      </div>`;
      return;
    }
    if (state.screen === "error") {
      const title = state.errorKind === "cancelled" ? "Onboarding cancelled" : state.errorKind === "used" ? "Link already used" : state.errorKind === "invalid" ? "Link unavailable" : state.errorKind === "rate" ? "Please wait" : "Unable to open";
      const body = state.errorKind === "cancelled" ? "This onboarding was cancelled. Ask your manager for help." : state.errorKind === "used" ? "This link was already opened. Ask your manager for a new link." : state.errorKind === "invalid" ? "This link is invalid, expired, or no longer active. Ask your manager for a new link." : state.errorKind === "rate" ? "Too many attempts from this network. Wait a minute and refresh this page." : esc(state.error || "Please try again later.");
      el.innerHTML = `
      <div class="state">
        <h1>${esc(title)}</h1>
        <p class="sub">${body}</p>
        ${state.errorKind === "rate" ? `<div class="btn-row" style="max-width:280px;margin:16px auto 0;"><button type="button" class="btn btn-secondary" id="ffPortalRetry">Try again</button></div>` : ""}
      </div>`;
      const retry = document.getElementById("ffPortalRetry");
      if (retry) retry.addEventListener("click", () => boot());
      return;
    }
    const dto = state.dto;
    if (!dto) {
      state.screen = "error";
      state.errorKind = "generic";
      state.error = "Missing onboarding data.";
      return render();
    }
    if (state.screen === "task" && state.taskId) {
      const task = (dto.tasks || []).find((t) => t.id === state.taskId);
      if (!task) {
        state.screen = dto.readOnly ? "done" : "home";
        return render();
      }
      el.innerHTML = renderTaskDetail(dto, task);
      wireTaskDetail(task);
      return;
    }
    if (state.screen === "done" || dto.readOnly) {
      el.innerHTML = renderHome(dto, { completedView: true });
      wireHome();
      return;
    }
    el.innerHTML = renderHome(dto, { completedView: false });
    wireHome();
  }
  var SESS_TTL_MS2 = 2 * 60 * 60 * 1e3 - 30 * 1e3;
  function sessionStoreKey(token) {
    return "ff_od_sess_v1_" + String(token || "").slice(-20);
  }
  function loadStoredSession(token) {
    try {
      const raw = sessionStorage.getItem(sessionStoreKey(token));
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.sessionToken) return null;
      if (o.exp && Date.now() > Number(o.exp)) {
        sessionStorage.removeItem(sessionStoreKey(token));
        return null;
      }
      return String(o.sessionToken);
    } catch (_) {
      return null;
    }
  }
  function saveStoredSession(token, sessionToken) {
    try {
      if (!sessionToken) return;
      sessionStorage.setItem(
        sessionStoreKey(token),
        JSON.stringify({
          sessionToken: String(sessionToken),
          exp: Date.now() + SESS_TTL_MS2
        })
      );
    } catch (_) {
    }
  }
  function clearStoredSession(token) {
    try {
      sessionStorage.removeItem(sessionStoreKey(token));
    } catch (_) {
    }
  }
  function paintFromDto(dto) {
    applyDto(dto);
    const hashTask = parseHashTaskId();
    if (dto.readOnly || dto.run && dto.run.status === "completed") {
      state.screen = "done";
      if (hashTask) {
        state.taskId = hashTask;
        state.screen = "task";
      }
    } else if (hashTask) {
      state.taskId = hashTask;
      state.screen = "task";
    } else {
      state.screen = "home";
    }
  }
  async function boot() {
    try {
      if (typeof window.__ffPortalMarkBooted === "function") window.__ffPortalMarkBooted();
    } catch (_) {
    }
    state.screen = "loading";
    render();
    const token = parseTokenFromPath();
    if (!token || token.length < 20) {
      state.errorKind = "invalid";
      state.error = "Invalid or expired link.";
      state.screen = "error";
      render();
      return;
    }
    const stored = loadStoredSession(token);
    if (stored) {
      try {
        const dto = await portalHttp(CF_NAMES.getState, { sessionToken: stored });
        if (dto && dto.sessionToken) saveStoredSession(token, dto.sessionToken);
        paintFromDto(dto);
        render();
        return;
      } catch (e) {
        clearStoredSession(token);
        const msg = String(e && e.message || "");
        if (/cancel/i.test(msg)) {
          setErrorFromException(e);
          render();
          return;
        }
      }
    }
    try {
      const dto = await portalHttp(CF_NAMES.bootstrap, { token });
      if (dto && dto.sessionToken) saveStoredSession(token, dto.sessionToken);
      paintFromDto(dto);
      render();
    } catch (e) {
      setErrorFromException(e);
      render();
    }
  }
  bindRequestRender(render);
  window.addEventListener("hashchange", () => {
    if (state.screen === "loading" || state.screen === "error" || !state.dto) return;
    const id = parseHashTaskId();
    if (id) {
      state.taskId = id;
      state.screen = "task";
    } else {
      goHome();
      return;
    }
    render();
  });
  try {
    if (window.history && window.history.replaceState) {
    }
  } catch (_) {
  }
  boot();
})();
