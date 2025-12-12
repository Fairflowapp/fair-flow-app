# Cloud Functions for Admin PIN Reset

This document describes the Firebase Cloud Functions that need to be implemented to support the secure email-based admin PIN reset flow.

## Overview

The client-side code has been updated to call three Cloud Functions:
1. `generatePinResetLink` - Generates a reset token and sends email to owner
2. `verifyPinResetToken` - Validates a reset token
3. `confirmPinReset` - Updates the admin PIN and deletes the token

## Firestore Data Model

### Salon Settings
- **Path**: `salons/{salonId}/settings/main`
- **Fields**:
  - `adminPin`: string - The admin PIN (4-6 digits)

### Reset Tokens Collection
- **Path**: `salons/{salonId}/pinResetTokens/{token}`
- **Fields**:
  - `token`: string (document ID, random secure string)
  - `salonId`: string
  - `createdAt`: Timestamp
  - `expiresIn`: number (10 minutes in milliseconds or seconds)

## Cloud Functions

### 1. generatePinResetLink

**Type**: Callable Function  
**Input**: `{ salonId: string }`  
**Output**: `{ success: boolean }`

**Steps**:
1. Validate input (salonId must be provided)
2. Read `salons/{salonId}` to get owner email (from owner field or settings)
3. If owner email is missing, throw a generic error
4. Generate a cryptographically secure random token (32+ bytes, base64/hex)
5. Create document in `salons/{salonId}/pinResetTokens/{token}` with:
   - `salonId`
   - `createdAt`: serverTimestamp()
   - `expiresIn`: 600 (10 minutes in seconds) or equivalent
6. Build reset URL: `https://YOUR_DOMAIN/reset-pin.html?token=<token>`
7. Send email to owner using Firebase Email Templates (or SendGrid/Mailgun)
8. Return `{ success: true }`

**Email Template** (Firebase Email Templates):
```
Subject: Reset Admin PIN for [SALON_NAME]

You requested to reset the admin PIN for [SALON_NAME]. If this wasn't you, ignore this email.

Click the link below to reset your admin PIN:
[RESET_URL]

This link expires in 10 minutes.
```

**Security**:
- Never log the token or PIN in plain text
- Use environment variables for email service API keys
- Implement rate limiting per salonId or IP address

---

### 2. verifyPinResetToken

**Type**: Callable Function  
**Input**: `{ token: string }`  
**Output**: `{ valid: boolean }` or error

**Steps**:
1. Validate input (token must be provided)
2. Search for token in Firestore:
   - Query `pinResetTokens` collection where token matches
   - Or use a collection group query if tokens are stored per salon
3. Check:
   - Document exists
   - `createdAt + expiresIn` is in the future
4. If valid, return `{ valid: true }`
5. If invalid or expired, throw an error: "This reset link is invalid or has expired"

**Note**: Since tokens are stored under `salons/{salonId}/pinResetTokens/{token}`, you may need to:
- Store salonId with the token and query by token + salonId
- Or use a collection group query to search across all salons

---

### 3. confirmPinReset

**Type**: Callable Function  
**Input**: `{ token: string, newPin: string }`  
**Output**: `{ success: boolean }`

**Steps**:
1. Validate input (token and newPin must be provided)
2. Validate newPin: must be 4-6 digits, numeric only
3. Look up token in `salons/{salonId}/pinResetTokens/{token}` (you'll need to find which salonId)
4. Check:
   - Document exists
   - `createdAt + expiresIn` is in the future
5. If invalid or expired, throw error
6. Read `salonId` from token document
7. Update `salons/{salonId}/settings/main`:
   - Set `adminPin` to the new PIN (store as plain string, or hash if preferred)
   - Use `updateDoc()` to only update this field
8. Delete `salons/{salonId}/pinResetTokens/{token}` document (single-use token)
9. Return `{ success: true }`

**Security**:
- Never log the PIN in plain text
- Ensure token is deleted after use (transactional if possible)
- Validate PIN format on server side

---

## Firestore Security Rules

Add these rules to restrict access:

```javascript
match /salons/{salonId}/settings/main {
  // Only Cloud Functions can write adminPin
  allow read: if request.auth != null;
  allow write: if false; // Only Cloud Functions can write
}

match /salons/{salonId}/pinResetTokens/{token} {
  // Only Cloud Functions can access this collection
  allow read, write: if false;
}
```

## Environment Variables

Set these in Firebase Functions config:

```bash
firebase functions:config:set email.service="firebase" # or "sendgrid" or "mailgun"
firebase functions:config:set email.api_key="YOUR_API_KEY" # if using external service
firebase functions:config:set app.domain="https://yourdomain.com"
```

## Example Implementation Structure

```javascript
// functions/index.js
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
const db = admin.firestore();

// Generate PIN reset link
exports.generatePinResetLink = functions.https.onCall(async (data, context) => {
  const { salonId } = data;
  
  if (!salonId) {
    throw new functions.https.HttpsError('invalid-argument', 'salonId is required');
  }
  
  // Get salon document to find owner email
  const salonDoc = await db.collection('salons').doc(salonId).get();
  if (!salonDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Salon not found');
  }
  
  const salonData = salonDoc.data();
  const ownerEmail = salonData.ownerEmail || salonData.owner?.email;
  
  if (!ownerEmail) {
    throw new functions.https.HttpsError('failed-precondition', 'Owner email not found');
  }
  
  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  
  // Save token to Firestore
  const tokenRef = db.collection('salons').doc(salonId)
    .collection('pinResetTokens').doc(token);
  
  await tokenRef.set({
    salonId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresIn: 600 // 10 minutes in seconds
  });
  
  // Build reset URL
  const resetUrl = `${functions.config().app.domain}/reset-pin.html?token=${token}`;
  
  // Send email using Firebase Email Templates or external service
  // Implementation depends on your email service choice
  
  return { success: true };
});

// Verify PIN reset token
exports.verifyPinResetToken = functions.https.onCall(async (data, context) => {
  const { token } = data;
  
  if (!token) {
    throw new functions.https.HttpsError('invalid-argument', 'token is required');
  }
  
  // Search for token (you may need to use collection group query)
  // For now, assuming we can query by token
  const tokensSnapshot = await db.collectionGroup('pinResetTokens')
    .where(admin.firestore.FieldPath.documentId(), '==', token)
    .limit(1)
    .get();
  
  if (tokensSnapshot.empty) {
    throw new functions.https.HttpsError('not-found', 'Invalid token');
  }
  
  const tokenDoc = tokensSnapshot.docs[0];
  const tokenData = tokenDoc.data();
  
  // Check expiration
  const createdAt = tokenData.createdAt.toMillis();
  const expiresIn = tokenData.expiresIn * 1000; // Convert to milliseconds
  const now = Date.now();
  
  if (now > createdAt + expiresIn) {
    throw new functions.https.HttpsError('deadline-exceeded', 'Token expired');
  }
  
  return { valid: true };
});

// Confirm PIN reset
exports.confirmPinReset = functions.https.onCall(async (data, context) => {
  const { token, newPin } = data;
  
  if (!token || !newPin) {
    throw new functions.https.HttpsError('invalid-argument', 'token and newPin are required');
  }
  
  // Validate PIN format
  if (!/^\d{4,6}$/.test(newPin)) {
    throw new functions.https.HttpsError('invalid-argument', 'PIN must be 4-6 digits');
  }
  
  // Find token
  const tokensSnapshot = await db.collectionGroup('pinResetTokens')
    .where(admin.firestore.FieldPath.documentId(), '==', token)
    .limit(1)
    .get();
  
  if (tokensSnapshot.empty) {
    throw new functions.https.HttpsError('not-found', 'Invalid token');
  }
  
  const tokenDoc = tokensSnapshot.docs[0];
  const tokenData = tokenDoc.data();
  const salonId = tokenData.salonId;
  
  // Check expiration
  const createdAt = tokenData.createdAt.toMillis();
  const expiresIn = tokenData.expiresIn * 1000;
  const now = Date.now();
  
  if (now > createdAt + expiresIn) {
    throw new functions.https.HttpsError('deadline-exceeded', 'Token expired');
  }
  
  // Update admin PIN
  const settingsRef = db.collection('salons').doc(salonId)
    .collection('settings').doc('main');
  
  await settingsRef.set({
    adminPin: newPin
  }, { merge: true });
  
  // Delete token
  await tokenDoc.ref.delete();
  
  return { success: true };
});
```

## Testing

1. Test `generatePinResetLink` with valid salonId
2. Verify email is sent with correct reset link
3. Test `verifyPinResetToken` with valid and expired tokens
4. Test `confirmPinReset` with valid token and new PIN
5. Verify token is deleted after use
6. Verify admin PIN is updated in Firestore
7. Test rate limiting and error handling

## Notes

- The client-side code is already implemented and ready to use these functions
- All functions should handle errors gracefully and return user-friendly messages
- Consider implementing rate limiting to prevent abuse
- Use Firebase Functions logging for debugging (never log sensitive data)
- The reset-pin.html page is already created and ready to use

