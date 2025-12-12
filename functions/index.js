// Cloud Functions for Admin PIN Reset
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');

// Initialize Firebase Admin (only once)
if (!admin.apps.length) {
  admin.initializeApp();
}

// --- Email Configuration ---
// IMPORTANT: Configure email auth using Firebase Environment Variables
// Example command: firebase functions:config:set email.user="your_email@gmail.com" email.password="your_app_password"
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: functions.config().email?.user,
    pass: functions.config().email?.password
  }
});

// CRITICAL: Set the final public domain for the main application
const APP_BASE_URL = 'https://app.fairflowapp.com';

/**
 * Generates a secure PIN reset token, saves it to Firestore, and emails the reset link.
 * Requires user to be authenticated.
 */
exports.generatePinResetLink = functions.https.onCall(async (data, context) => {
  // 1. Authentication Check
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be logged in to request a PIN reset.');
  }

  const uid = context.auth.uid;
  const email = context.auth.token.email;

  // 2. Retrieve Salon ID from user document
  const userDocRef = admin.firestore().collection('users').doc(uid);
  const userDoc = await userDocRef.get();

  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User profile not found.');
  }

  const userData = userDoc.data();
  const salonId = userData?.salonId;

  if (!salonId) {
    throw new functions.https.HttpsError('failed-precondition', 'Logged-in user is not associated with a salon.');
  }

  // 3. Create Token and Expiration (1 hour)
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expirationTimeMillis = admin.firestore.Timestamp.now().toMillis() + (60 * 60 * 1000); // 1 hour expiration
  const expiresAt = admin.firestore.Timestamp.fromMillis(expirationTimeMillis);

  // 4. Save Token to Firestore in a new collection
  try {
    await admin.firestore().collection('pinResetTokens').doc(resetToken).set({
      salonId: salonId,
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: expiresAt,
      ownerEmail: email
    });
  } catch (error) {
    console.error("Error saving token to Firestore:", error);
    throw new functions.https.HttpsError('internal', 'Failed to save reset token.');
  }

  // 5. Send Email with Reset Link
  const resetLink = `${APP_BASE_URL}/reset-pin.html?token=${resetToken}`;

  const mailOptions = {
    from: 'PIN Reset Service <no-reply@your-app-domain.com>',
    to: email,
    subject: 'Admin PIN Reset Request',
    html: `
      <p>Click the link below to set a new Admin PIN for your salon:</p>
      <p><a href="${resetLink}">Reset Your Admin PIN</a></p>
      <p>This link will expire in 1 hour.</p>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    return { success: true, message: 'Admin PIN reset link sent successfully to your email.' };
  } catch (error) {
    console.error("Error sending email:", error);
    throw new functions.https.HttpsError('internal', 'Failed to send reset email. Check email configuration.');
  }
});

/**
 * Step 3 of PIN Reset: Validates the token, hashes the new PIN, and updates Firestore.
 * This is a PUBLIC function, accessed via the reset link.
 */
exports.confirmPinReset = functions.https.onCall(async (data, context) => {
  const { token, newPin } = data;

  // A. Input Validation
  if (!token || !newPin || newPin.length < 4 || newPin.length > 6 || isNaN(newPin)) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing or invalid token/new PIN. PIN must be 4-6 digits.');
  }

  const tokenRef = admin.firestore().collection('pinResetTokens').doc(token);
  const tokenDoc = await tokenRef.get();

  // B. Token Validation (Existence and Expiration)
  if (!tokenDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Invalid or expired reset token. Please request a new link.');
  }

  const tokenData = tokenDoc.data();
  const currentTimeMillis = admin.firestore.Timestamp.now().toMillis();

  if (currentTimeMillis > tokenData.expiresAt.toMillis()) {
    await tokenRef.delete(); // Clean up expired token
    throw new functions.https.HttpsError('expired', 'Reset link has expired. Please request a new one.');
  }

  // C. Hashing the new PIN for security
  const saltRounds = 10;
  const hashedPin = await bcrypt.hash(newPin, saltRounds);

  // D. Update Firestore (Admin PIN)
  // ASSUMPTION: The PIN is stored at /salons/{salonId}/adminPin
  const salonSettingsRef = admin.firestore()
                                  .collection('salons')
                                  .doc(tokenData.salonId);

  try {
    // Update the main salon document with the new PIN
    await salonSettingsRef.set({
      adminPin: hashedPin,
      pinLastReset: admin.firestore.Timestamp.now()
    }, { merge: true }); // Use merge to only update the specified fields
  } catch (error) {
    console.error("Error updating salon PIN:", error);
    throw new functions.https.HttpsError('internal', 'Failed to update PIN in database. Check Firestore path and permissions.');
  }

  // E. Delete Token (Prevent Reuse)
  await tokenRef.delete();

  return { success: true, message: 'Admin PIN updated successfully.' };
});

