# Cloud Functions for Admin PIN Reset

This directory contains Firebase Cloud Functions for the secure email-based admin PIN reset workflow.

## Setup Instructions

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Configure Email Settings

Set up Firebase Functions config for email authentication:

```bash
firebase functions:config:set email.user="your_email@gmail.com" email.password="your_app_password"
```

**Note:** For Gmail, you'll need to:
- Enable 2-factor authentication
- Generate an "App Password" (not your regular password)
- Use the app password in the config

### 3. Update APP_BASE_URL

Edit `functions/index.js` and update the `APP_BASE_URL` constant to your actual domain:

```javascript
const APP_BASE_URL = 'https://your-actual-domain.com';
```

### 4. Deploy Functions

```bash
firebase deploy --only functions
```

## Functions

### `generatePinResetLink`

- **Type:** Callable Function (requires authentication)
- **Purpose:** Generates a secure reset token and emails a reset link to the logged-in owner
- **Returns:** Success message

### `confirmPinReset`

- **Type:** Callable Function (public, no authentication required)
- **Purpose:** Validates a reset token and updates the admin PIN in Firestore
- **Parameters:** `{ token: string, newPin: string }`
- **Returns:** Success message

## Security Notes

⚠️ **Important:** The PIN is stored as a **hashed value** using bcrypt. If your existing PIN verification code performs direct string comparison, you'll need to update it to use `bcrypt.compare()` instead.

## Firestore Structure

- **Tokens Collection:** `pinResetTokens/{token}`
  - `salonId`: string
  - `createdAt`: Timestamp
  - `expiresAt`: Timestamp (1 hour from creation)
  - `ownerEmail`: string

- **Salon Document:** `salons/{salonId}`
  - `adminPin`: string (hashed with bcrypt)
  - `pinLastReset`: Timestamp

## Testing

1. Test `generatePinResetLink`:
   - Log in as an owner
   - Click "Forgot Admin PIN?"
   - Check email for reset link

2. Test `confirmPinReset`:
   - Click the reset link from email
   - Enter new PIN
   - Verify PIN is updated in Firestore

