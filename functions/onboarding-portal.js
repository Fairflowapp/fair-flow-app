/**
 * Employee Onboarding Portal — Phase 1 backend (tokens + portal actions).
 *
 * Manager (Firebase Auth):
 *   issueOnboardingPortalToken
 *   reissueOnboardingPortalToken
 *   revokeOnboardingPortalToken
 *   extendOnboardingPortalToken
 *   getOnboardingPortalActiveLink
 *   sendOnboardingPortalEmail
 *   sendOnboardingPortalReminder
 *   runOnboardingRemindersSweep
 *
 * Scheduled:
 *   onboardingRemindersHourly
 *
 * Portal (token / session — no Fair Flow login):
 *   onboardingPortalBootstrap
 *   onboardingPortalGetState
 *   onboardingPortalAckPolicy
 *   onboardingPortalCreateUpload
 *   onboardingPortalFinalizeUpload
 *   onboardingPortalGetSignaturePacket
 *   onboardingPortalSubmitSignature
 *
 * Trigger:
 *   onOnboardingRunWriteForPortal — revoke tokens when run → cancelled
 *
 * Deploy (staging):
 *   firebase deploy --only \
 *     functions:issueOnboardingPortalToken,functions:reissueOnboardingPortalToken,functions:revokeOnboardingPortalToken,functions:extendOnboardingPortalToken,functions:getOnboardingPortalActiveLink,functions:sendOnboardingPortalEmail,functions:sendOnboardingPortalReminder,functions:runOnboardingRemindersSweep,functions:onboardingRemindersHourly,functions:onboardingPortalBootstrap,functions:onboardingPortalGetState,functions:onboardingPortalAckPolicy,functions:onboardingPortalCreateUpload,functions:onboardingPortalFinalizeUpload,functions:onOnboardingRunWriteForPortal \
 *     --project fair-flow-staging
 */

Object.assign(
  exports,
  require("./onboarding-portal-manager"),
  require("./onboarding-portal-reminders"),
  require("./onboarding-portal-http")
);
