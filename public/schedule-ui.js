// schedule-ui.js
// Schedule entry barrel. The former schedule-ui.js orchestrator now lives in
// schedule-nav.js; index.html still loads this file and receives the same
// public exports. schedule-nav.js also wires all window.* hooks as before.

export {
  goToSchedule,
  refreshSchedulePreview,
  hideScheduleScreen,
} from "./schedule-nav.js?v=20260704_schedule_nav_runtime_viewtabs_fix";
