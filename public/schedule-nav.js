// schedule-nav.js
// Schedule navigation entry. Core helpers and runtime orchestration were split
// into schedule-nav-core.js and schedule-nav-runtime.js; schedule-ui.js still
// re-exports this public API.

export {
  goToSchedule,
  refreshSchedulePreview,
  hideScheduleScreen,
} from "./schedule-nav-runtime.js?v=20260704_schedule_nav_runtime_viewtabs_fix";
