/**
 * Employee Onboarding Runs — runtime cloud layer (Pre-Portal Hardening).
 *
 * salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}
 * salons/{salonId}/staff/{staffId}/onboardingRuns/{runId}/tasks/{taskId}
 *
 * Runs are immutable snapshots of package + templates at create time.
 * Run progress/status are recomputed by Cloud Function onOnboardingTaskWrite.
 * Thin entry: re-exports public API + window bindings.
 */

export {
  ffComputeOnboardingRunProgress,
  ffCanManageOnboardingRunsClient,
  ffBuildOnboardingRunSnapshot,
  ffBuildOnboardingRunSnapshotAsync,
} from "./run-cloud-shared.js?v=20260810_od_split_v1";
export {
  ffGetOnboardingRuns,
  ffGetOnboardingRunTasks,
  ffCreateOnboardingRunFromPackage,
  ffActivateOnboardingRun,
  ffCancelOnboardingRun,
  ffSkipOnboardingTask,
} from "./run-cloud-lifecycle.js?v=20260810_od_split_v1";
export {
  ffAcknowledgeOnboardingPolicyTask,
  ffCompleteOnboardingTaskFromInboxApprove,
  ffRejectOnboardingTaskFromInbox,
  ffSubmitOnboardingDocumentUpload,
  ffSubscribeOnboardingRuns,
  ffSubscribeOnboardingRunTasks,
} from "./run-cloud-actions.js?v=20260810_od_split_v1";

import {
  ffComputeOnboardingRunProgress,
  ffCanManageOnboardingRunsClient,
  ffBuildOnboardingRunSnapshot,
  ffBuildOnboardingRunSnapshotAsync,
} from "./run-cloud-shared.js?v=20260810_od_split_v1";
import {
  ffGetOnboardingRuns,
  ffGetOnboardingRunTasks,
  ffCreateOnboardingRunFromPackage,
  ffActivateOnboardingRun,
  ffCancelOnboardingRun,
  ffSkipOnboardingTask,
} from "./run-cloud-lifecycle.js?v=20260810_od_split_v1";
import {
  ffAcknowledgeOnboardingPolicyTask,
  ffCompleteOnboardingTaskFromInboxApprove,
  ffRejectOnboardingTaskFromInbox,
  ffSubmitOnboardingDocumentUpload,
  ffSubscribeOnboardingRuns,
  ffSubscribeOnboardingRunTasks,
} from "./run-cloud-actions.js?v=20260810_od_split_v1";

if (typeof window !== "undefined") {
  window.ffComputeOnboardingRunProgress = ffComputeOnboardingRunProgress;
  window.ffCanManageOnboardingRunsClient = ffCanManageOnboardingRunsClient;
  window.ffBuildOnboardingRunSnapshot = ffBuildOnboardingRunSnapshot;
  window.ffBuildOnboardingRunSnapshotAsync = ffBuildOnboardingRunSnapshotAsync;
  window.ffGetOnboardingRuns = ffGetOnboardingRuns;
  window.ffGetOnboardingRunTasks = ffGetOnboardingRunTasks;
  window.ffCreateOnboardingRunFromPackage = ffCreateOnboardingRunFromPackage;
  window.ffActivateOnboardingRun = ffActivateOnboardingRun;
  window.ffCancelOnboardingRun = ffCancelOnboardingRun;
  window.ffSkipOnboardingTask = ffSkipOnboardingTask;
  window.ffAcknowledgeOnboardingPolicyTask = ffAcknowledgeOnboardingPolicyTask;
  window.ffCompleteOnboardingTaskFromInboxApprove = ffCompleteOnboardingTaskFromInboxApprove;
  window.ffRejectOnboardingTaskFromInbox = ffRejectOnboardingTaskFromInbox;
  window.ffSubmitOnboardingDocumentUpload = ffSubmitOnboardingDocumentUpload;
  window.ffSubscribeOnboardingRuns = ffSubscribeOnboardingRuns;
  window.ffSubscribeOnboardingRunTasks = ffSubscribeOnboardingRunTasks;
}
