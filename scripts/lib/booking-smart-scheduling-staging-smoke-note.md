# Staging callable smoke / deploy notes

`fair-flow-staging` Cloud Run service `executebookingmutation` uses:

`run.googleapis.com/invoker-iam-disabled: true`

Domain Restricted Sharing (`constraints/iam.allowedPolicyMemberDomains`) blocks `allUsers` → `roles/run.invoker`. Do not change the organization policy. Do not add `allUsers` or `allAuthenticatedUsers`.

After any future `firebase deploy --only functions:executeBookingMutation --project fair-flow-staging`, re-check that annotation. Persistence across new Cloud Run revisions is not proven.

Never deploy this callable to production from these scripts.
