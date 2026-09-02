// schedule-nav-runtime.js
// Schedule runtime entry — explicit side-effect imports ensure preview init wiring
// and UI window hooks / bindScheduleUi run; re-exports the public API.

import "./schedule-nav-runtime-preview.js?v=20260902_sched_dual";
import "./schedule-nav-runtime-ui.js?v=20260902_sched_dual";

export { refreshSchedulePreview } from "./schedule-nav-runtime-preview.js?v=20260902_sched_dual";
export { goToSchedule, hideScheduleScreen } from "./schedule-nav-runtime-ui.js?v=20260902_sched_dual";
