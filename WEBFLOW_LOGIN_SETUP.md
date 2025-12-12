# Webflow Login Integration Setup

This guide explains how to integrate Firebase authentication into your Webflow login page.

## Files

- `webflow-login-code.js` - Complete JavaScript code for Webflow custom code area

## Setup Instructions

### Step 1: Prepare Your Webflow Form

Ensure your login form in Webflow has the following structure:

```html
<form id="wf-form-login">
  <input type="email" id="email-login" placeholder="Email" required />
  <input type="password" id="password-login" placeholder="Password" required />
  <button type="submit">Log In</button>
</form>
```

**Required IDs:**
- Form: `wf-form-login`
- Email Input: `email-login`
- Password Input: `password-login`

### Step 2: Add Custom Code to Webflow

1. Open your Webflow project
2. Go to **Project Settings** > **Custom Code**
3. Scroll to **Footer Code** section
4. Open `webflow-login-code.js` and copy the entire contents
5. Paste it into the Footer Code area
6. **IMPORTANT:** Replace `[YOUR_FIREBASE_HOSTING_URL]` with your actual Firebase Hosting URL
   - Example: `const successRedirectUrl = 'https://app.fairflowapp.com';`

### Step 3: Update Redirect URL

Find this line in the code:
```javascript
const successRedirectUrl = 'https://[YOUR_FIREBASE_HOSTING_URL]';
```

Replace `[YOUR_FIREBASE_HOSTING_URL]` with your actual Firebase Hosting URL where your main app is hosted.

**Example:**
```javascript
const successRedirectUrl = 'https://app.fairflowapp.com';
```

### Step 4: Test the Integration

1. Publish your Webflow site
2. Navigate to the login page
3. Enter valid credentials
4. After successful login, you should be redirected to your Firebase Hosting app

## Features

- ✅ Automatic Firebase SDK loading (if not already present)
- ✅ Email/password validation
- ✅ User-friendly error messages
- ✅ Loading state on submit button
- ✅ Automatic redirect on successful login
- ✅ Password field cleared on error for security

## Error Messages

The code handles the following Firebase Auth error codes:

- `auth/user-not-found` / `auth/wrong-password` / `auth/invalid-credential` → "Invalid email or password"
- `auth/invalid-email` → "Please enter a valid email address"
- `auth/user-disabled` → "This account has been disabled"
- `auth/too-many-requests` → "Too many failed attempts"
- `auth/network-request-failed` → "Network error"
- Other errors → Generic error message

## Troubleshooting

### Form not submitting
- Check browser console for errors
- Verify form and input IDs match exactly: `wf-form-login`, `email-login`, `password-login`
- Ensure Firebase SDK is loading (check Network tab)

### Redirect not working
- Verify `successRedirectUrl` is set correctly
- Check that the Firebase Hosting URL is accessible
- Ensure the URL includes `https://` protocol

### Firebase not initializing
- Check that Firebase config values are correct
- Verify Firebase SDK scripts are loading (check browser console)
- Ensure no other scripts are conflicting

## Notes

- The code uses Firebase v9 compat mode for easier Webflow integration
- Firebase SDK is loaded automatically if not already present
- The code prevents Webflow's default form submission behavior
- Password field is cleared on error for security

