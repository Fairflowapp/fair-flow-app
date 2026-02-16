# Deploy Cloud Functions (excludes sendStaffInvite HTTP - org policy blocks it)
firebase deploy --only "functions:testCallable,functions:testCallablePing,functions:testSendEmail,functions:testSendEmailNodemailer,functions:onStaffInviteCreatedV2,functions:processStaffInviteOnCreate,functions:onProcessInviteNow,functions:processPendingInvites,functions:sendStaffInviteCallable"
