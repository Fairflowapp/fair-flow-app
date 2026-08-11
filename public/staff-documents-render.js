/**
 * staff-documents-render.js — Staff Documents rendering + live subscription split out of
 * staff-documents.js: filter/search toolbar, list + card renderers, grouping/sections,
 * the Firestore onSnapshot subscription, and DOM re-render into the mounted container.
 * Reads/writes the shared sdState; consumed by the lifecycle orchestrator in staff-documents.js.
 */
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { db } from "/app.js?v=20260610_force_lp_ios";
import { sdState, STAFF_DOC_FILTER_IDS } from "./staff-documents-state.js?v=20260701_staffdoc_state_split";
import {
  trimStr,
  ffComputeLifecycleFromExpiration,
  escapeHtml,
  escapeAttr,
  toDateMaybe,
  formatWhen,
  formatDay,
  formatDocumentTitle,
  formatApprovalLabel,
  formatLifecycleLabel,
  staffDocsEmptyMessageHtml,
  staffDocsShellStyle,
  expiryBadgeState,
  badgeHtml,
  isPortalEsignDocument,
  groupDocument,
  tierForActiveSectionDoc,
  sortActiveDocuments,
  sortArchivedDocuments,
  renderActiveSubheader,
  filterDocumentsByChip,
  normalizeStaffDocSearch,
  docMatchesSearch,
  sortDocumentsForFilterChip,
  renderFilterChipsHtml,
} from "./staff-documents-format.js?v=20260809_esign_e5";
import { refreshStaffDocViewerEditMeta } from "./staff-documents-ui.js?v=20260809_esign_e5";
import { ffRunExpiryChatNotify } from "./staff-documents-expiry-chat.js?v=20260701_staffdoc_expiry_split";

function renderActiveSectionWithSubheaders(sortedActive) {
  if (!sortedActive.length) return "";
  const expired = [];
  const expiring = [];
  const normal = [];
  sortedActive.forEach((d) => {
    const t = tierForActiveSectionDoc(d);
    if (t === "expired") expired.push(d);
    else if (t === "expiring_soon") expiring.push(d);
    else normal.push(d);
  });
  let html = "";
  let first = true;
  if (expired.length) {
    html += renderActiveSubheader("Expired", first) + expired.map(renderDocumentCard).join("");
    first = false;
  }
  if (expiring.length) {
    html += renderActiveSubheader("Expiring Soon", first) + expiring.map(renderDocumentCard).join("");
    first = false;
  }
  if (normal.length) {
    if (expired.length || expiring.length) {
      html += renderActiveSubheader("Active", first) + normal.map(renderDocumentCard).join("");
    } else {
      html += normal.map(renderDocumentCard).join("");
    }
  }
  return html;
}


function renderFilteredSingleSection(docs, chip) {
  const sorted = sortDocumentsForFilterChip(docs, chip);
  return sorted.map(renderDocumentCard).join("");
}


function renderSearchRowHtml() {
  const v = escapeHtml(sdState._staffDocumentsSearchQuery);
  return `<div style="display:flex;align-items:stretch;gap:8px;">
  <input type="search" data-ff-doc-search placeholder="Search documents" value="${v}" autocomplete="off" style="flex:1;min-width:0;min-height:34px;padding:7px 11px;font-size:12px;border:1px solid #e5e7eb;border-radius:8px;box-sizing:border-box;font-family:inherit;color:#111827;background:#fff;" />
  <button type="button" data-ff-doc-search-clear title="Clear search" aria-label="Clear search" style="min-height:34px;padding:0 12px;font-size:11px;font-weight:600;border:1px solid #e5e7eb;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0;">Clear</button>
</div>`;
}

function renderListContentBody(list) {
  if (!STAFF_DOC_FILTER_IDS.has(sdState._staffDocumentsFilter)) {
    sdState._staffDocumentsFilter = "active";
  }
  const f = sdState._staffDocumentsFilter || "active";
  const q = normalizeStaffDocSearch(sdState._staffDocumentsSearchQuery);
  const chips = renderFilterChipsHtml(f, list);
  const searchRow = renderSearchRowHtml();
  const chipsWrap = `<div class="ff-staff-doc-filters" style="display:flex;align-items:center;gap:8px;">${chips}</div>`;
  const searchWrap = `<div style="margin-top:10px;">${searchRow}</div>`;
  const head = `<div class="ff-staff-doc-toolbar" style="margin:0 0 16px 0;padding-bottom:14px;border-bottom:1px solid #f3f4f6;">${chipsWrap}${searchWrap}</div>`;

  const afterChip = filterDocumentsByChip(list, f);
  const afterSearch = q ? afterChip.filter((d) => docMatchesSearch(d, q)) : afterChip;

  if (afterChip.length === 0) {
    return head + staffDocsEmptyMessageHtml("No documents match this filter.");
  }

  if (afterSearch.length === 0) {
    const msg =
      f !== "all" && q
        ? "No documents match this filter and search."
        : "No documents match this search.";
    return head + staffDocsEmptyMessageHtml(msg);
  }

  if (f === "all" && !q) {
    return head + renderGrouped(list);
  }
  if (f === "all" && q) {
    return head + renderGrouped(afterSearch);
  }
  return head + renderFilteredSingleSection(afterSearch, f);
}

function ensureStaffDocSearchListeners(container) {
  if (!container || container.__ffStaffSearchBound) return;
  container.__ffStaffSearchBound = true;
  if (!sdState._onStaffDocSearchInput) {
    sdState._onStaffDocSearchInput = function (e) {
      const t = e.target && e.target.closest && e.target.closest("input[data-ff-doc-search]");
      if (!t) return;
      sdState._staffDocumentsSearchQuery = t.value;
      if (sdState._lastDocList !== null && sdState._ffBoundContainer) {
        renderListIntoContainer(sdState._ffBoundContainer, sdState._lastDocList);
      }
    };
  }
  container.addEventListener("input", sdState._onStaffDocSearchInput);
  container.addEventListener("change", (e) => {
    const sel = e.target && e.target.closest && e.target.closest("select[data-ff-doc-filter-select]");
    if (!sel) return;
    const id = sel.value;
    if (id && STAFF_DOC_FILTER_IDS.has(id) && sdState._staffDocumentsFilter !== id) {
      sdState._staffDocumentsFilter = id;
      if (sdState._lastDocList !== null && sdState._ffBoundContainer) {
        renderListIntoContainer(sdState._ffBoundContainer, sdState._lastDocList);
      }
    }
  });
}

/** Direct handler on the button — does not rely on bubbling to the documents container. */
function wireStaffDocExpiryChatButtons(container) {
  if (!container || !container.querySelectorAll) return;
  container.querySelectorAll('button[data-ff-doc-action="expiry_chat_notify"]').forEach((btn) => {
    btn.onclick = async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (btn.disabled) return;
      const originalText = btn.textContent || "Send chat reminder";
      btn.disabled = true;
      btn.textContent = "Sending...";
      btn.style.opacity = "0.75";
      btn.style.cursor = "wait";
      const ok = await ffRunExpiryChatNotify(btn.getAttribute("data-doc-id"));
      if (ok) {
        btn.textContent = "Sent";
        btn.style.opacity = "1";
        btn.style.cursor = "default";
        setTimeout(() => {
          try {
            btn.disabled = false;
            btn.textContent = originalText;
            btn.style.cursor = "pointer";
          } catch (_) {}
        }, 2500);
      } else {
        btn.disabled = false;
        btn.textContent = originalText;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
      }
    };
  });
}

function renderListIntoContainer(container, list) {
  if (!container) return;
  const active = document.activeElement;
  const wasSearch =
    active &&
    active.getAttribute &&
    active.getAttribute("data-ff-doc-search") !== null &&
    container.contains(active);
  let selStart = 0;
  let selEnd = 0;
  if (wasSearch && active instanceof HTMLInputElement) {
    selStart = active.selectionStart ?? 0;
    selEnd = active.selectionEnd ?? 0;
  }

  if (!list.length) {
    sdState._staffDocumentsSearchQuery = "";
    container.innerHTML = `<div style="${staffDocsShellStyle()}">${renderEmpty()}</div>`;
    return;
  }
  const body = renderListContentBody(list);
  container.innerHTML = `<div style="${staffDocsShellStyle()}">${body}</div>`;
  wireStaffDocExpiryChatButtons(container);

  if (wasSearch) {
    const inp = container.querySelector("input[data-ff-doc-search]");
    if (inp) {
      inp.focus();
      try {
        inp.setSelectionRange(selStart, selEnd);
      } catch (_) {}
    }
  }
}

function applyDocumentsSnapshot() {
  const sid = sdState._mountCtx.salonId;
  const stid = sdState._mountCtx.staffId;
  const key = `${sid}::${stid}`;
  if (sdState._mountedKey !== key) return;
  const list = sdState._lastDocList;
  if (list === null) return;
  if (sdState._ffBoundContainer) {
    renderListIntoContainer(sdState._ffBoundContainer, list);
  }
}

function ensureSubscription(sid, stid) {
  const key = `${sid}::${stid}`;
  if (sdState._mountedKey === key && sdState._unsub) return;

  if (typeof sdState._unsub === "function") {
    try {
      sdState._unsub();
    } catch (_) {}
  }
  sdState._unsub = null;
  sdState._mountedKey = key;
  sdState._mountCtx = { salonId: sid, staffId: stid };
  sdState._lastDocList = null;
  sdState._staffDocumentsFilter = "active";
  sdState._staffDocumentsSearchQuery = "";

  void refreshStaffDocViewerEditMeta().then(() => {
    if (sdState._mountedKey === key && sdState._lastDocList && sdState._ffBoundContainer) {
      applyDocumentsSnapshot();
    }
  });

  if (sdState._ffBoundContainer) {
    sdState._ffBoundContainer.innerHTML = `<div style="min-height:88px;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;"><p style="margin:0;font-size:13px;color:#6b7280;">Loading documents…</p></div>`;
  }

  const colRef = collection(db, "salons", sid, "staff", stid, "documents");
  sdState._unsub = onSnapshot(
    colRef,
    (snap) => {
      if (sdState._mountedKey !== key) return;
      const list = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() });
      });
      list.sort((a, b) => {
        const ta = toDateMaybe(a.createdAt)?.getTime() ?? 0;
        const tb = toDateMaybe(b.createdAt)?.getTime() ?? 0;
        return tb - ta;
      });
      sdState._lastDocList = list;
      applyDocumentsSnapshot();
    },
    (err) => {
      console.warn("[staff-documents]", err);
      if (sdState._mountedKey !== key) return;
      const errHtml = `<p style="margin:0;font-size:13px;color:#b91c1c;">Could not load documents.</p>`;
      if (sdState._ffBoundContainer) {
        sdState._ffBoundContainer.innerHTML = errHtml;
      }
    },
  );
}

function renderDocumentCard(doc) {
  const title = formatDocumentTitle(doc.title);
  const type =
    doc.type != null && String(doc.type).trim() !== "" ? String(doc.type).trim() : "—";
  const fileName =
    doc.fileName != null && String(doc.fileName).trim() !== "" ? String(doc.fileName).trim() : "—";
  const ap = String(doc.approvalStatus || "").toLowerCase();
  const approvalDisplay = formatApprovalLabel(doc.approvalStatus != null ? String(doc.approvalStatus) : "");
  const expirationDate = doc.expirationDate;
  const lifecycleRaw = doc.lifecycleStatus != null ? String(doc.lifecycleStatus) : "";
  const lifeLower = trimStr(String(doc.lifecycleStatus || "")).toLowerCase();
  const isArchived = lifeLower === "archived";
  const isEsign = isPortalEsignDocument(doc);
  const lifecycleDisplay = isArchived
    ? formatLifecycleLabel("archived")
    : doc.expirationDate != null
      ? formatLifecycleLabel(ffComputeLifecycleFromExpiration(doc.expirationDate))
      : formatLifecycleLabel(lifecycleRaw);
  const createdAt = doc.createdAt;

  const badges = [];
  if (isEsign) {
    badges.push(badgeHtml("esigned"));
    if (String(doc.esignKind || "") === "certificate") {
      badges.push(badgeHtml("esign_certificate"));
    } else {
      badges.push(badgeHtml("sealed"));
    }
  } else if (ap === "pending") badges.push(badgeHtml("pending"));
  else if (ap === "approved" || ap === "rejected") badges.push(badgeHtml(ap));

  const expState = expiryBadgeState(expirationDate);
  if (expState) {
    badges.push(badgeHtml(expState));
  } else if (doc.expirationDate == null) {
    const life = String(doc.lifecycleStatus || "").toLowerCase();
    if (life === "expired") badges.push(badgeHtml("expired"));
    else if (life === "expiring_soon") badges.push(badgeHtml("expiring_soon"));
  }

  if (isArchived) {
    badges.push(badgeHtml("archived"));
  }

  // Pill-sized actions — e-sign sealed docs are read-only (no edit / delete / replace)
  const editMetaPillBtn =
    !isEsign && sdState._staffDocsViewerCanEditMeta && !isArchived
      ? `<button type="button" data-ff-doc-action="edit_meta" data-doc-id="${escapeHtml(doc.id)}" title="Edit type, title, expiration" style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.02em;line-height:1.3;background:#faf5ff;color:#5b21b6;border:1px solid #c4b5fd;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;flex-shrink:0;">✎ Edit</button>`
      : "";
  const deletePillBtn =
    !isEsign && isArchived
      ? `<button type="button" data-ff-doc-action="delete_permanent" data-doc-id="${escapeHtml(doc.id)}" title="Permanently delete this document and its file. This cannot be undone." style="display:inline-block;padding:3px 9px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:0.02em;line-height:1.3;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent;flex-shrink:0;">Delete</button>`
      : "";
  const badgeActions = [editMetaPillBtn, deletePillBtn].filter(Boolean).join("");

  const badgeRow =
    badges.length || badgeActions
      ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:10px;">
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:1;min-width:0;">${badges.join("")}</div>
          ${badgeActions ? `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex-shrink:0;">${badgeActions}</div>` : ""}
        </div>`
      : "";

  const path = trimStr(doc.storagePath || doc.filePath || "");
  const fUrl = trimStr(doc.fileUrl || "");
  const canView = !!path || fUrl.startsWith("http://") || fUrl.startsWith("https://");
  const derivedForReplace =
    !isArchived && doc.expirationDate != null
      ? ffComputeLifecycleFromExpiration(doc.expirationDate)
      : lifeLower;
  const showExpiredReplace = !isEsign && !isArchived && derivedForReplace === "expired";
  const showExpiringSoonChat = !isEsign && !isArchived && derivedForReplace === "expiring_soon";

  const btnBase =
    "min-height:36px;padding:8px 14px;font-size:12px;font-weight:600;border-radius:999px;line-height:1.2;box-sizing:border-box;font-family:inherit;-webkit-tap-highlight-color:transparent;";
  // Same purple treatment as document filter chips (selected): border #7c3aed, tint #ede9fe
  const btnStyle = `${btnBase}cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;touch-action:manipulation;`;
  const btnDisabledStyle = `${btnBase}cursor:not-allowed;border:1px solid #e5e7eb;background:#f9fafb;color:#9ca3af;`;

  const hasDirectHttpUrl = fUrl.startsWith("http://") || fUrl.startsWith("https://");
  const viewBtn = !canView
    ? `<button type="button" disabled title="No file attached" style="${btnDisabledStyle}">View</button>`
    : hasDirectHttpUrl
    ? `<a href="${escapeAttr(fUrl)}" target="_blank" rel="noopener noreferrer" style="${btnStyle}text-decoration:none;display:inline-block;">View</a>`
    : `<button type="button" data-ff-doc-action="view" data-doc-id="${escapeHtml(doc.id)}" style="${btnStyle}">View</button>`;

  const archiveOrUnarchive = isEsign
    ? ""
    : isArchived
      ? `<button type="button" data-ff-doc-action="unarchive" data-doc-id="${escapeHtml(doc.id)}" style="${btnStyle}">Unarchive</button>`
      : `<button type="button" data-ff-doc-action="archive" data-doc-id="${escapeHtml(doc.id)}" style="${btnStyle}">Archive</button>`;

  const uploadNewVersionBtn = showExpiredReplace
    ? `<button type="button" data-ff-doc-action="replace" data-doc-id="${escapeHtml(doc.id)}" title="Replace file on this document (same record)" style="${btnBase}cursor:pointer;border:1px dashed #7c3aed;background:#faf5ff;color:#6d28d9;">Upload New Version</button>`
    : "";
  const expiringSoonChatBtn = showExpiringSoonChat
    ? `<button type="button" data-ff-doc-action="expiry_chat_notify" data-doc-id="${escapeHtml(doc.id)}" title="Send this staff member a chat reminder" style="${btnBase}cursor:pointer;border:1px solid #7c3aed;background:#ede9fe;color:#5b21b6;pointer-events:auto !important;position:relative;z-index:2;touch-action:manipulation;">Send chat reminder</button>`
    : "";

  const actionsRow = `
    <div class="ff-staff-doc-actions" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;align-items:center;">
      ${viewBtn}
      ${archiveOrUnarchive}
      ${expiringSoonChatBtn}
      ${uploadNewVersionBtn}
    </div>`;

  const esignMetaRows = isEsign
    ? `${
        doc.signerName
          ? `<span style="color:#9ca3af;">Signer</span><span>${escapeHtml(String(doc.signerName))}</span>`
          : ""
      }
      ${
        doc.signedAt
          ? `<span style="color:#9ca3af;">Signed</span><span>${escapeHtml(formatWhen(doc.signedAt))}</span>`
          : ""
      }
      ${
        doc.documentTitle || doc.documentVersion != null || doc.documentVersionId
          ? `<span style="color:#9ca3af;">Version</span><span>${escapeHtml(
              String(
                doc.documentVersion != null
                  ? doc.documentVersion
                  : doc.documentVersionId || "—"
              )
            )}${doc.documentTitle ? " · " + escapeHtml(String(doc.documentTitle)) : ""}</span>`
          : ""
      }
      ${
        doc.onboardingRunId
          ? `<span style="color:#9ca3af;">Onboarding</span><span>Run ${_escShort(doc.onboardingRunId)}${
              doc.onboardingTaskId
                ? " · Task " + _escShort(doc.onboardingTaskId)
                : ""
            }</span>`
          : ""
      }
      <span style="color:#9ca3af;">Source</span><span>Portal e-sign · read-only</span>`
    : "";

  return `
    <div class="ff-staff-doc-card${isEsign ? " ff-staff-doc-esign" : ""}" style="border:1px solid #e5e7eb;border-radius:10px;padding:13px 14px;background:#fff;margin-bottom:10px;">
      ${badgeRow}
      <div style="font-size:13px;font-weight:700;color:#111827;margin-bottom:8px;line-height:1.35;">${escapeHtml(title)}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:12px;color:#374151;line-height:1.4;">
        <span style="color:#9ca3af;">Type</span><span>${escapeHtml(type)}</span>
        <span style="color:#9ca3af;">File</span><span style="word-break:break-word;">${escapeHtml(fileName)}</span>
        ${
          isEsign
            ? esignMetaRows
            : `<span style="color:#9ca3af;">Approval</span><span>${escapeHtml(approvalDisplay)}</span>
        <span style="color:#9ca3af;">Expires</span><span>${escapeHtml(formatDay(expirationDate))}</span>
        <span style="color:#9ca3af;">Lifecycle</span><span>${escapeHtml(lifecycleDisplay)}</span>
        <span style="color:#9ca3af;">Created</span><span>${escapeHtml(formatWhen(createdAt))}</span>`
        }
        ${
          isEsign
            ? `<span style="color:#9ca3af;">Created</span><span>${escapeHtml(formatWhen(createdAt))}</span>`
            : ""
        }
      </div>
      ${actionsRow}
    </div>
  `;
}

function _escShort(id) {
  const s = String(id || "");
  if (s.length <= 10) return escapeHtml(s);
  return escapeHtml(s.slice(0, 6) + "…" + s.slice(-4));
}

function renderGrouped(docs) {
  const active = [];
  const archived = [];
  docs.forEach((d) => {
    const g = groupDocument(d);
    if (g === "archived") archived.push(d);
    else active.push(d);
  });

  const activeSorted = sortActiveDocuments(active);
  const archivedSorted = sortArchivedDocuments(archived);

  function section(title, innerHtml) {
    if (!innerHtml) return "";
    return `
      <div style="margin-bottom:22px;">
        <h4 style="margin:0 0 12px 0;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(title)}</h4>
        ${innerHtml}
      </div>
    `;
  }

  return (
    section("Documents", renderActiveSectionWithSubheaders(activeSorted)) +
    section("Archived", archivedSorted.map(renderDocumentCard).join(""))
  );
}

function renderEmpty() {
  return staffDocsEmptyMessageHtml("No documents uploaded yet.");
}

export { ensureStaffDocSearchListeners, renderListIntoContainer, ensureSubscription };
