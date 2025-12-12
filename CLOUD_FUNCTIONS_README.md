# Cloud Functions for Admin PIN Reset

This document describes the Firebase Cloud Functions that need to be implemented to support the secure email-based admin PIN reset flow.

## Overview

The client-side code has been updated to call three Cloud Functions:
1. `requestAdminPinReset` - Generates a reset token and sends email to owner
2. `verifyAdminPinResetToken` - Validates a reset token
3. `confirmAdminPinReset` - Updates the admin PIN and deletes the token

## Firestore Data Model

### Salon Settings
- **Path**: `salons/{salonId}/settings`
- **Fields**:
  - `adminPinHash`: string | null - Hashed admin PIN (use bcrypt or argon2)
  - `ownerEmail`: string - Verified email address of the salon owner

### Reset Tokens Collection
- **Path**: `adminPinResetTokens/{token}`
- **Fields**:
  - `token`: string (document ID, random secure string)
  - `salonId`: string
  - `createdAt`: Timestamp
  - `expiresAt`: Timestamp (e.g., now + 30 minutes)

## Cloud Functions

### 1. requestAdminPinReset

**Type**: Callable Function  
**Input**: `{ salonId: string }`  
**Output**: `{ success: boolean }`

**Steps**:
1. Validate input (salonId must be provided)
2. Read `salons/{salonId}/settings` to get `ownerEmail`
3. If `ownerEmail` is missing, throw a generic error (don't reveal if salon exists)
4. Generate a cryptographically secure random token (32+ bytes, base64/hex)
5. Create document in `adminPinResetTokens/{token}` with:
   - `salonId`
   - `createdAt`: serverTimestamp()
   - `expiresAt`: serverTimestamp() + 30 minutes
6. Build reset URL: `https://YOUR_DOMAIN/reset-admin-pin?token=<token>`
7. Send email to `ownerEmail` using transactional email service (SendGrid, Mailgun, or Nodemailer)
8. Return `{ success: true }`

**Email Template**:
```
Subject: Reset Admin PIN for [SALON_NAME]

You requested to reset the admin PIN for [SALON_NAME]. If this wasn't you, ignore this email.

Click the link below to reset your admin PIN:
[RESET_URL]

This link expires in 30 minutes.
```

**Security**:
- Never log the token or PIN in plain text
- Use environment variables for email service API keys
- Implement rate limiting per salonId or IP address

---

### 2. verifyAdminPinResetToken

**Type**: Callable Function  
**Input**: `{ token: string }`  
**Output**: `{ success: boolean, salonId?: string }` or error

**Steps**:
1. Validate input (token must be provided)
2. Look up `adminPinResetTokens/{token}`
3. Check:
   - Document exists
   - `expiresAt` is in the future
4. If valid, return `{ success: true, salonId: tokenDoc.salonId }`
5. If invalid or expired, throw an error: "This reset link is invalid or has expired"

**Security**:
- Don't expose sensitive information in the response
- Only return minimal data needed for the next step

---

### 3. confirmAdminPinReset

**Type**: Callable Function  
**Input**: `{ token: string, newPin: string }`  
**Output**: `{ success: boolean }`

**Steps**:
1. Validate input (token and newPin must be provided)
2. Validate newPin: must be 4-6 digits, numeric only
3. Look up `adminPinResetTokens/{token}`
4. Check:
   - Document exists
   - `expiresAt` is in the future
5. If invalid or expired, throw error
6. Read `salonId` from token document
7. Hash `newPin` using secure hash (bcrypt with cost 10+ or argon2)
8. Update `salons/{salonId}/settings`:
   - Set `adminPinHash` to the new hash
   - Use `updateDoc()` to only update this field
9. Delete `adminPinResetTokens/{token}` document (single-use token)
10. Return `{ success: true }`

**Security**:
- Never log the PIN in plain text
- Use secure hashing algorithm (bcrypt recommended)
- Ensure token is deleted after use (transactional if possible)

---

## Firestore Security Rules

Add these rules to restrict access:

```javascript
match /salons/{salonId}/settings {
  // Only Cloud Functions can read/write adminPinHash
  allow read: if false;
  allow write: if false;
  
  // But allow read of other fields for authenticated users
  allow read: if request.auth != null && 
    request.resource.data.diff(resource.data).affectedKeys().hasOnly(['adminPinHash']) == false;
}

match /adminPinResetTokens/{token} {
  // Only Cloud Functions can access this collection
  allow read, write: if false;
}
```

## Environment Variables

Set these in Firebase Functions config:

```bash
firebase functions:config:set email.service="sendgrid" # or "mailgun" or "gmail"
firebase functions:config:set email.api_key="YOUR_API_KEY"
firebase functions:config:set email.from="noreply@yourdomain.com"
firebase functions:config:set app.domain="https://yourdomain.com"
```

## Example Implementation Structure

```javascript
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const nodemailer = require('nodemailer'); // or SendGrid/Mailgun SDK

admin.initializeApp();

// Email transporter setup (configure based on your service)
const transporter = nodemailer.createTransporter({
  // ... your email service config
});

exports.requestAdminPinReset = functions.https.onCall(async (data, context) => {
  // Implementation here
});

exports.verifyAdminPinResetToken = functions.https.onCall(async (data, context) => {
  // Implementation here
});

exports.confirmAdminPinReset = functions.https.onCall(async (data, context) => {
  // Implementation here
});
```

## Testing

1. Test `requestAdminPinReset` with valid salonId
2. Verify email is sent with correct reset link
3. Test `verifyAdminPinResetToken` with valid and expired tokens
4. Test `confirmAdminPinReset` with valid token and new PIN
5. Verify token is deleted after use
6. Verify admin PIN is updated in Firestore
7. Test rate limiting and error handling

## Notes

- The client-side code is already implemented and ready to use these functions
- All functions should handle errors gracefully and return user-friendly messages
- Consider implementing rate limiting to prevent abuse
- Use Firebase Functions logging for debugging (never log sensitive data)

