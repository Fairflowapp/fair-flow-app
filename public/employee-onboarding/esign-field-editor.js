/**
 * E-sign Phase E2 — Field Editor over a Signature Library PDF version.
 * PDF.js preview + place/move/resize/delete fields with normalized 0–1 coords.
 */

import {
  ffNormalizeOnboardingEsignFieldSchema,
  ffValidateOnboardingEsignFieldSchema,
  ffOnboardingEsignFieldTypes,
} from "./task-registry.js?v=20260811_od_s3_sensitive";

const PDFJS_VERSION = "4.8.69";
const PDFJS_MOD =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.mjs`;

const DEFAULT_SIZE = {
  signature: { width: 0.36, height: 0.09 },
  typed_name: { width: 0.36, height: 0.05 },
  date: { width: 0.22, height: 0.045 },
  initials: { width: 0.12, height: 0.055 },
  text: { width: 0.36, height: 0.05 },
  checkbox: { width: 0.045, height: 0.045 },
};

const TYPE_LABEL = {
  signature: "Signature",
  typed_name: "Typed name",
  date: "Date",
  initials: "Initials",
  text: "Text",
  checkbox: "Checkbox",
};

let _pdfjsLib = null;
let _open = false;

function _esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _toast(msg, kind) {
  if (typeof window.showToast === "function") window.showToast(msg, kind || "info");
  else if (typeof window.ffToast === "function") window.ffToast(msg, kind || "info");
  else console.log("[EsignFieldEditor]", msg);
}

async function _loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  _pdfjsLib = await import(PDFJS_MOD);
  if (_pdfjsLib.GlobalWorkerOptions) {
    _pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return _pdfjsLib;
}

function _newField(type, page, x, y) {
  const size = DEFAULT_SIZE[type] || DEFAULT_SIZE.text;
  let width = size.width;
  let height = size.height;
  let nx = Math.max(0, Math.min(x, 1 - width));
  let ny = Math.max(0, Math.min(y, 1 - height));
  return {
    id: `fld_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    page,
    x: Number(nx.toFixed(6)),
    y: Number(ny.toFixed(6)),
    width: Number(width.toFixed(6)),
    height: Number(height.toFixed(6)),
    required: type === "signature" || type === "typed_name",
    label: TYPE_LABEL[type] || type,
    signerRole: "employee",
    // sensitive only applies to text (set in props panel)
  };
}

/**
 * Open field editor modal for a ready library version.
 * @returns {Promise<{saved:boolean, fieldSchema:Array}|null>}
 */
export async function ffOpenOnboardingEsignFieldEditor({
  documentId,
  versionId,
  documentTitle,
  readOnly,
  saveLabel,
} = {}) {
  const existing = typeof document !== "undefined"
    ? document.getElementById("ffEsignFieldEditorOverlay")
    : null;
  if (_open && existing) return null;
  _open = false;
  const did = String(documentId || "").trim();
  const vid = String(versionId || "").trim();
  if (!did || !vid) throw new Error("documentId and versionId required");
  if (typeof window.ffGetOnboardingSignatureDocumentVersionReadUrl !== "function") {
    throw new Error("E-sign library cloud not loaded");
  }

  _open = true;
  let resolveDone;
  const donePromise = new Promise((r) => {
    resolveDone = r;
  });

  const overlay = document.createElement("div");
  overlay.id = "ffEsignFieldEditorOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,0.55);display:flex;align-items:center;justify-content:center;padding:max(8px,env(safe-area-inset-top,0px)) 12px max(8px,env(safe-area-inset-bottom,0px));overflow:hidden;box-sizing:border-box;";
  overlay.innerHTML =
    '<div style="background:#fff;border-radius:12px;width:min(520px,100%);padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25);">' +
    '<div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:8px;">Mark where to sign</div>' +
    '<div style="font-size:13px;color:#6b7280;margin-bottom:14px;">Loading PDF…</div>' +
    '<button type="button" data-fe-close style="padding:9px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;">Close</button>' +
    "</div>";
  document.body.appendChild(overlay);
  try {
    document.body.style.overflow = "hidden";
  } catch (_) {}

  let cancelled = false;
  overlay.querySelector("[data-fe-close]").addEventListener("click", () => {
    cancelled = true;
    try {
      overlay.remove();
      document.body.style.overflow = "";
    } catch (_) {}
    _open = false;
    resolveDone({ saved: false });
  });

  let meta;
  try {
    meta = await window.ffGetOnboardingSignatureDocumentVersionReadUrl({
      documentId: did,
      versionId: vid,
    });
    if (!meta || !meta.readUrl) {
      throw new Error("Could not open the PDF preview. Try uploading again.");
    }
  } catch (e) {
    if (!cancelled) {
      try {
        overlay.remove();
        document.body.style.overflow = "";
      } catch (_) {}
      _open = false;
    }
    throw e;
  }
  if (cancelled) return donePromise;

  const frozen = meta.schemaFrozen === true || readOnly === true;
  let fields = ffNormalizeOnboardingEsignFieldSchema(meta.fieldSchema || []);
  let selectedId = null;
  let placeType = null;
  let dirty = false;

  const saveText = String(saveLabel || "Save").trim() || "Save";
  const saveBtnHtml = frozen
    ? ""
    : '<button type="button" data-fe-save style="padding:9px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:13px;font-weight:700;cursor:pointer;flex-shrink:0;">' +
      _esc(saveText) +
      "</button>";
  const floatBarHtml = frozen
    ? ""
    : '<div data-fe-float-bar style="flex-shrink:0;display:flex;justify-content:flex-end;gap:8px;align-items:center;padding:10px 14px;border-top:1px solid #e5e7eb;background:#fff;z-index:6;">' +
      '<span data-fe-dirty style="font-size:11px;color:#6b7280;margin-right:auto;"></span>' +
      '<button type="button" data-fe-save-bottom style="padding:9px 14px;border:none;border-radius:8px;background:#7c3aed;color:#fff;font-size:13px;font-weight:700;cursor:pointer;">' +
      _esc(saveText) +
      "</button></div>";
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:min(1100px,100%);height:calc(100dvh - 24px);max-height:calc(100dvh - 24px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.25);box-sizing:border-box;">
      <div data-fe-toolbar style="display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px 14px;border-bottom:1px solid #e5e7eb;flex-shrink:0;background:#fff;z-index:6;">
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:800;color:#111827;">Mark where to sign</div>
          <div style="font-size:11px;color:#6b7280;margin-top:2px;">
            ${_esc(documentTitle || meta.documentTitle || did)}
            · ${Number(meta.pageCount) || "?"} pages
            ${frozen ? " · <span style='color:#b45309;font-weight:700;'>locked (already in use)</span>" : ""}
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:nowrap;align-items:center;flex-shrink:0;">
          ${saveBtnHtml}
          <button type="button" data-fe-close style="padding:9px 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;font-size:13px;font-weight:600;cursor:pointer;">Close</button>
        </div>
      </div>
      <div style="display:flex;flex:1 1 auto;min-height:0;overflow:hidden;">
        <aside style="width:200px;border-right:1px solid #e5e7eb;padding:10px;overflow:auto;background:#fafafa;flex-shrink:0;">
          <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:8px;">ADD FIELD</div>
          <div id="ffFeTypes" style="display:flex;flex-direction:column;gap:6px;"></div>
          <div style="font-size:11px;color:#9ca3af;margin-top:12px;line-height:1.4;">
            Click a type, then click on the page to place it.
            Before saving, place at least one <b>Signature</b> or <b>Typed name</b>.
          </div>
          <div id="ffFeProps" style="margin-top:14px;"></div>
        </aside>
        <div style="flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;position:relative;overflow:hidden;">
          <div id="ffFePages" style="flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:16px;background:#e5e7eb;-webkit-overflow-scrolling:touch;"></div>
          ${floatBarHtml}
        </div>
      </div>
    </div>
  `;

  const typesEl = overlay.querySelector("#ffFeTypes");
  const pagesEl = overlay.querySelector("#ffFePages");
  const propsEl = overlay.querySelector("#ffFeProps");

  (ffOnboardingEsignFieldTypes() || []).forEach((t) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.feType = t;
    btn.textContent = TYPE_LABEL[t] || t;
    btn.disabled = frozen;
    btn.style.cssText =
      "padding:7px 8px;border:1px solid #ddd6fe;border-radius:8px;background:#fff;color:#5b21b6;font-size:12px;font-weight:600;cursor:pointer;text-align:left;";
    btn.addEventListener("click", () => {
      placeType = t;
      typesEl.querySelectorAll("button").forEach((b) => {
        b.style.background = b.dataset.feType === t ? "#ede9fe" : "#fff";
      });
      _toast(`Click a page to place ${TYPE_LABEL[t] || t}`, "info");
    });
    typesEl.appendChild(btn);
  });

  function close(result) {
    try {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      document.body.style.overflow = "";
    } catch (_) {}
    _open = false;
    resolveDone(result);
  }

  function _setDirty(next) {
    dirty = !!next;
    const el = overlay.querySelector("[data-fe-dirty]");
    if (el) el.textContent = dirty ? "Unsaved changes" : "";
  }

  overlay.querySelector("[data-fe-close]").addEventListener("click", () => {
    if (dirty && !frozen && !window.confirm("Discard unsaved field changes?")) return;
    close({ saved: false, fieldSchema: fields });
  });

  async function _saveLayout() {
    const saveBtns = overlay.querySelectorAll("[data-fe-save], [data-fe-save-bottom]");
    const hasSignature = fields.some((f) => f.type === "signature");
    const hasTypedName = fields.some((f) => f.type === "typed_name");
    if (!fields.length) {
      const msg = "Place at least one field on the document before saving.";
      _toast(msg, "error");
      try {
        window.alert(msg);
      } catch (_) {}
      return;
    }
    if (!hasSignature && !hasTypedName) {
      const msg =
        "Add at least one Signature or Typed name field before saving.\n\nTip: click Signature on the left, then click on the PDF.";
      _toast("Add a Signature or Typed name field first", "error");
      try {
        window.alert(msg);
      } catch (_) {}
      return;
    }
    const v = ffValidateOnboardingEsignFieldSchema(fields, {
      pageCount: meta.pageCount,
      // Signature preferred, but Typed name alone is allowed (matches engine rules).
      requireSignature: false,
    });
    if (!v.ok) {
      const msg = (v.errors || []).join("; ") || "Cannot save yet";
      _toast(msg, "error");
      try {
        window.alert(msg);
      } catch (_) {}
      return;
    }
    try {
      saveBtns.forEach((b) => {
        b.disabled = true;
      });
      // Re-normalize so non-text never carries sensitive to the server.
      const payloadFields = ffNormalizeOnboardingEsignFieldSchema(fields);
      const res = await window.ffSetOnboardingSignatureDocumentVersionFieldSchema({
        documentId: did,
        versionId: vid,
        fieldSchema: payloadFields,
      });
      fields = ffNormalizeOnboardingEsignFieldSchema(res.fieldSchema || payloadFields);
      _setDirty(false);
      _toast("Saved", "success");
      close({ saved: true, fieldSchema: fields, meta: res });
    } catch (e) {
      _toast(e.message || "Save failed", "error");
      saveBtns.forEach((b) => {
        b.disabled = false;
      });
    }
  }

  overlay.querySelectorAll("[data-fe-save], [data-fe-save-bottom]").forEach((btn) => {
    btn.addEventListener("click", () => {
      _saveLayout();
    });
  });

  function onKey(e) {
    if (frozen) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      fields = fields.filter((f) => f.id !== selectedId);
      selectedId = null;
      _setDirty(true);
      renderFields();
      renderProps();
    }
  }
  document.addEventListener("keydown", onKey);

  function renderProps() {
    const f = fields.find((x) => x.id === selectedId);
    if (!f) {
      propsEl.innerHTML =
        '<div style="font-size:11px;color:#9ca3af;">Select a field to edit properties.</div>';
      return;
    }
    // S3: Sensitive UI only for text fields; strip if type is not text.
    if (f.type !== "text" && (f.sensitive || f.sensitiveKind)) {
      delete f.sensitive;
      delete f.sensitiveKind;
    }
    const kind = f.sensitiveKind || "other";
    const sensitiveBlock =
      f.type === "text"
        ? '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#92400e;margin-bottom:6px;font-weight:600;">' +
          '<input data-fe-sensitive type="checkbox"' +
          (f.sensitive ? " checked" : "") +
          (frozen ? " disabled" : "") +
          " /> Sensitive (encrypted at rest)</label>" +
          '<div data-fe-sensitive-kind-wrap style="margin-bottom:8px;' +
          (f.sensitive ? "" : "display:none;") +
          '"><label style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Sensitive kind</label>' +
          '<select data-fe-sensitive-kind' +
          (frozen ? " disabled" : "") +
          ' style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;">' +
          '<option value="ssn"' + (kind === "ssn" ? " selected" : "") + ">SSN</option>" +
          '<option value="bank_account"' + (kind === "bank_account" ? " selected" : "") + ">Bank account</option>" +
          '<option value="other"' + (kind === "other" ? " selected" : "") + ">Other</option>" +
          "</select>" +
          '<div style="font-size:10px;color:#9ca3af;margin-top:4px;line-height:1.35;">Only text fields. Stored encrypted; managers see mask + audited Reveal.</div></div>'
        : '<div style="font-size:10px;color:#9ca3af;margin-bottom:8px;line-height:1.35;">Sensitive flag applies to text fields only.</div>';
    const delBtn = frozen
      ? ""
      : '<button type="button" data-fe-del style="padding:6px 8px;border:1px solid #fecaca;border-radius:6px;background:#fff;color:#b91c1c;font-size:11px;font-weight:600;cursor:pointer;width:100%;">Delete field</button>';
    propsEl.innerHTML = `
      <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:6px;">SELECTED</div>
      <div style="font-size:12px;font-weight:700;color:#111827;margin-bottom:6px;">${_esc(TYPE_LABEL[f.type] || f.type)}</div>
      <label style="display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;">Label</label>
      <input data-fe-label type="text" value="${_esc(f.label)}" ${frozen ? "disabled" : ""} style="width:100%;padding:6px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box;margin-bottom:8px;" />
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#374151;margin-bottom:8px;">
        <input data-fe-req type="checkbox" ${f.required ? "checked" : ""} ${frozen ? "disabled" : ""} />
        Required
      </label>
      ${sensitiveBlock}
      <div style="font-size:11px;color:#9ca3af;margin-bottom:8px;">Page ${f.page}</div>
      ${delBtn}
    `;
    const labelEl = propsEl.querySelector("[data-fe-label]");
    const reqEl = propsEl.querySelector("[data-fe-req]");
    const sensEl = propsEl.querySelector("[data-fe-sensitive]");
    const kindEl = propsEl.querySelector("[data-fe-sensitive-kind]");
    const kindWrap = propsEl.querySelector("[data-fe-sensitive-kind-wrap]");
    const delEl = propsEl.querySelector("[data-fe-del]");
    if (labelEl) {
      labelEl.addEventListener("input", () => {
        f.label = labelEl.value;
        _setDirty(true);
        renderFields();
      });
    }
    if (reqEl) {
      reqEl.addEventListener("change", () => {
        f.required = !!reqEl.checked;
        _setDirty(true);
        renderFields();
      });
    }
    if (sensEl) {
      sensEl.addEventListener("change", () => {
        if (f.type !== "text") {
          sensEl.checked = false;
          delete f.sensitive;
          delete f.sensitiveKind;
          _toast("Sensitive is only allowed on text fields.", "error");
          return;
        }
        if (sensEl.checked) {
          f.sensitive = true;
          f.sensitiveKind = (kindEl && kindEl.value) || "other";
        } else {
          delete f.sensitive;
          delete f.sensitiveKind;
        }
        if (kindWrap) kindWrap.style.display = sensEl.checked ? "" : "none";
        _setDirty(true);
        renderFields();
      });
    }
    if (kindEl) {
      kindEl.addEventListener("change", () => {
        if (!f.sensitive || f.type !== "text") return;
        f.sensitiveKind = kindEl.value || "other";
        _setDirty(true);
      });
    }
    if (delEl) {
      delEl.addEventListener("click", () => {
        fields = fields.filter((x) => x.id !== f.id);
        selectedId = null;
        _setDirty(true);
        renderFields();
        renderProps();
      });
    }
  }

  function renderFields() {
    pagesEl.querySelectorAll("[data-fe-page]").forEach((wrap) => {
      const pageNum = Number(wrap.getAttribute("data-fe-page"));
      const layer = wrap.querySelector("[data-fe-layer]");
      if (!layer) return;
      layer.innerHTML = "";
      fields
        .filter((f) => f.page === pageNum)
        .forEach((f) => {
          const el = document.createElement("div");
          el.dataset.feField = f.id;
          el.style.cssText = `
            position:absolute;
            left:${f.x * 100}%;
            top:${f.y * 100}%;
            width:${f.width * 100}%;
            height:${f.height * 100}%;
            box-sizing:border-box;
            border:2px solid ${
              selectedId === f.id
                ? "#7c3aed"
                : f.sensitive
                  ? "#b45309"
                  : "#2563eb"
            };
            background:${
              f.sensitive ? "rgba(245,158,11,0.16)" : "rgba(37,99,235,0.12)"
            };
            border-radius:4px;
            cursor:${frozen ? "default" : "move"};
            font-size:10px;
            color:${f.sensitive ? "#92400e" : "#1e3a8a"};
            font-weight:700;
            padding:2px 4px;
            overflow:hidden;
            user-select:none;
          `;
          el.innerHTML = `${_esc(f.label || f.type)}${f.required ? " *" : ""}${
            f.sensitive ? " · sens" : ""
          }
            ${
              frozen
                ? ""
                : `<span data-fe-handle style="position:absolute;right:-4px;bottom:-4px;width:10px;height:10px;background:#7c3aed;border-radius:2px;cursor:nwse-resize;"></span>`
            }`;
          el.addEventListener("mousedown", (ev) => {
            if (frozen) {
              selectedId = f.id;
              renderFields();
              renderProps();
              return;
            }
            if (ev.target && ev.target.getAttribute("data-fe-handle") != null) {
              startResize(ev, f, wrap);
              return;
            }
            startDrag(ev, f, wrap);
          });
          layer.appendChild(el);
        });
    });
  }

  function pageMetrics(wrap) {
    const layer = wrap.querySelector("[data-fe-layer]");
    const rect = layer.getBoundingClientRect();
    return { layer, rect, w: rect.width, h: rect.height };
  }

  function startDrag(ev, f, wrap) {
    ev.preventDefault();
    ev.stopPropagation();
    selectedId = f.id;
    renderFields();
    renderProps();
    const { rect, w, h } = pageMetrics(wrap);
    const startX = ev.clientX;
    const startY = ev.clientY;
    const ox = f.x;
    const oy = f.y;
    function move(e) {
      const dx = (e.clientX - startX) / w;
      const dy = (e.clientY - startY) / h;
      f.x = Number(Math.max(0, Math.min(ox + dx, 1 - f.width)).toFixed(6));
      f.y = Number(Math.max(0, Math.min(oy + dy, 1 - f.height)).toFixed(6));
      _setDirty(true);
      renderFields();
      renderProps();
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  function startResize(ev, f, wrap) {
    ev.preventDefault();
    ev.stopPropagation();
    selectedId = f.id;
    const { w, h } = pageMetrics(wrap);
    const startX = ev.clientX;
    const startY = ev.clientY;
    const ow = f.width;
    const oh = f.height;
    function move(e) {
      const dw = (e.clientX - startX) / w;
      const dh = (e.clientY - startY) / h;
      f.width = Number(Math.max(0.02, Math.min(ow + dw, 1 - f.x)).toFixed(6));
      f.height = Number(Math.max(0.02, Math.min(oh + dh, 1 - f.y)).toFixed(6));
      _setDirty(true);
      renderFields();
      renderProps();
    }
    function up() {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    }
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  pagesEl.innerHTML =
    '<div style="font-size:12px;color:#6b7280;padding:20px;">Loading PDF preview…</div>';

  try {
    const pdfjs = await _loadPdfJs();
    const pdf = meta.pdfData
      ? await pdfjs.getDocument({ data: meta.pdfData }).promise
      : await pdfjs.getDocument({ url: meta.readUrl }).promise;
    pagesEl.innerHTML = "";
    const targetWidth = Math.min(820, pagesEl.clientWidth - 24 || 720);

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const unscaled = page.getViewport({ scale: 1 });
      const scale = targetWidth / unscaled.width;
      const viewport = page.getViewport({ scale });
      const wrap = document.createElement("div");
      wrap.dataset.fePage = String(p);
      wrap.style.cssText =
        "position:relative;margin:0 auto 18px;width:" +
        viewport.width +
        "px;box-shadow:0 4px 16px rgba(0,0,0,.15);background:#fff;";
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.cssText = "display:block;width:100%;height:auto;";
      const layer = document.createElement("div");
      layer.setAttribute("data-fe-layer", "1");
      layer.style.cssText =
        "position:absolute;left:0;top:0;width:100%;height:100%;";
      const badge = document.createElement("div");
      badge.textContent = "Page " + p;
      badge.style.cssText =
        "position:absolute;left:8px;top:8px;z-index:2;background:rgba(17,24,39,.75);color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;pointer-events:none;";
      wrap.appendChild(canvas);
      wrap.appendChild(layer);
      wrap.appendChild(badge);
      pagesEl.appendChild(wrap);

      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;

      layer.addEventListener("click", (ev) => {
        if (frozen || !placeType) return;
        if (ev.target !== layer) return;
        const { rect, w, h } = pageMetrics(wrap);
        const x = (ev.clientX - rect.left) / w;
        const y = (ev.clientY - rect.top) / h;
        const field = _newField(placeType, p, x, y);
        fields.push(field);
        selectedId = field.id;
        placeType = null;
        typesEl.querySelectorAll("button").forEach((b) => {
          b.style.background = "#fff";
        });
        _setDirty(true);
        renderFields();
        renderProps();
      });
    }
    renderFields();
    renderProps();
  } catch (e) {
    pagesEl.innerHTML = `<div style="color:#b91c1c;font-size:12px;padding:16px;">Failed to load PDF: ${_esc(e.message || e)}</div>`;
  }

  return donePromise;
}

if (typeof window !== "undefined") {
  window.ffOpenOnboardingEsignFieldEditor = ffOpenOnboardingEsignFieldEditor;
}
