#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.resolve(import.meta.dirname, "../..");
const backupPath = path.join(ROOT, "refactor-backups/schedule/schedule-nav-runtime.pre-split.js");
const pub = path.join(ROOT, "public");
const TOKEN = "20260704_schedule_helpers_split";

const backup = fs.readFileSync(backupPath, "utf8");
const lines = backup.split("\n");

const previewHeader = `// schedule-nav-runtime-preview.js
// Schedule preview orchestration — module init wiring and refresh/build flow.
// Extracted verbatim from schedule-nav-runtime.js (nav-runtime split T1).
`;

const previewBody = lines.slice(0, 580).join("\n");
const previewContent = `${previewHeader}\n${previewBody}\n\nexport { refreshSchedulePreview };\n`;

const uiHeader = `// schedule-nav-runtime-ui.js
// Schedule UI runtime — week filter, navigation, event binding, window hooks.
// Extracted verbatim from schedule-nav-runtime.js (nav-runtime split T2).

import { refreshSchedulePreview } from "./schedule-nav-runtime-preview.js?v=${TOKEN}";
import { scheduleState } from "./schedule-state.js?v=20260702_schedule_state";
import {
  renderScheduleBoard,
  renderScheduleSummary,
  setSchedulePreviewMode,
  setSchedulePreviewView,
} from "./schedule-render.js?v=20260703_schedule_render_split";
import {
  discardSavedScheduleWeekDraftAndReload,
  notifyStaffScheduleChanges,
  saveScheduleWeekDraftToCloud,
} from "./schedule-draft.js?v=20260702_schedule_draft";
import {
  canViewScheduleBoardForCurrentWeek,
  ensureSchedulePublishListener,
  teardownSchedulePublishListener,
  toggleScheduleWeekPublished,
  updateSchedulePublishToggleUi,
} from "./schedule-cloud.js?v=20260702_schedule_cloud";
import {
  addDays,
  getScheduleStaffKey,
  getStartOfWeek,
  isTechnicianScheduleStaff,
  syncScheduleWeekFilterUi,
} from "./schedule-format.js?v=20260702_schedule_format";
import {
  ffScheduleAppToast,
  submitScheduleWeekAck,
  teardownScheduleAckListener,
  teardownScheduleChangePingListener,
} from "./schedule-ack.js?v=20260702_schedule_ack";
import { getScheduleAccessContext } from "./schedule-shift-edit.js?v=20260702_schedule_shift_edit";
import {
  renderScheduleCrossLocationConflictBanner,
  renderScheduleViewTabs,
  scheduleInboxUserIsFirestoreManager,
} from "./schedule-nav-core.js?v=20260703_schedule_nav_wiring_fix";
`;

const uiBody = lines.slice(581, 1050).join("\n");
const uiContent = `${uiHeader}\n${uiBody}\n\nexport {\n  hideScheduleScreen,\n};\n`;

const entryContent = `// schedule-nav-runtime.js
// Schedule runtime entry — re-exports preview + UI modules from the nav-runtime split.

export { refreshSchedulePreview } from "./schedule-nav-runtime-preview.js?v=${TOKEN}";
export { goToSchedule, hideScheduleScreen } from "./schedule-nav-runtime-ui.js?v=${TOKEN}";
`;

fs.writeFileSync(path.join(pub, "schedule-nav-runtime-preview.js"), previewContent);
fs.writeFileSync(path.join(pub, "schedule-nav-runtime-ui.js"), uiContent);
fs.writeFileSync(path.join(pub, "schedule-nav-runtime.js"), entryContent);

console.log("Wrote preview:", previewContent.split("\n").length, "lines");
console.log("Wrote ui:", uiContent.split("\n").length, "lines");
console.log("Wrote entry:", entryContent.split("\n").length, "lines");
