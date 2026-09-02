/**
 * Employee Onboarding S5 — write callables barrel.
 *
 *   firebase deploy --only \
 *     functions:createOnboardingCategory,functions:updateOnboardingCategory,functions:deleteOnboardingCategory,functions:createOnboardingTaskTemplate,functions:updateOnboardingTaskTemplate,functions:deleteOnboardingTaskTemplate,functions:createOnboardingPackage,functions:updateOnboardingPackage,functions:deleteOnboardingPackage,functions:createOnboardingRunFromPackage,functions:activateOnboardingRun,functions:cancelOnboardingRun,functions:skipOnboardingTask,functions:acknowledgeOnboardingPolicyTask,functions:markOnboardingUploadWaitingApproval,functions:completeOnboardingTaskFromInboxApprove,functions:rejectOnboardingTaskFromInbox,functions:reopenOnboardingEsignTask \
 *     --project fair-flow-staging
 */
Object.assign(
  exports,
  require("./onboarding-catalog"),
  require("./onboarding-runs-write")
);
