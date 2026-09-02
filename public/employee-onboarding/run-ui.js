/**
 * Employee Onboarding Runs — Stage D UI + E5 e-sign polish
 * Thin entry: re-exports public API + window bindings.
 */

export { ffOpenStartOnboardingModal } from "./run-ui-start-modal.js?v=20260815_od_s6";
export {
  ffMountStaffOnboardingRuns,
  ffUnmountStaffOnboardingRuns,
} from "./run-ui-panel.js?v=20260825_od_iospdf";

import { ffOpenStartOnboardingModal } from "./run-ui-start-modal.js?v=20260815_od_s6";
import {
  ffMountStaffOnboardingRuns,
  ffUnmountStaffOnboardingRuns,
} from "./run-ui-panel.js?v=20260825_od_iospdf";
import { _syncOdShellStartUi } from "./run-ui-shared.js?v=20260815_od_s6";

if (typeof window !== "undefined") {
  window.ffOpenStartOnboardingModal = ffOpenStartOnboardingModal;
  window.ffMountStaffOnboardingRuns = ffMountStaffOnboardingRuns;
  window.ffUnmountStaffOnboardingRuns = ffUnmountStaffOnboardingRuns;
  window.__ffOdSyncShellStartUi = _syncOdShellStartUi;
}
