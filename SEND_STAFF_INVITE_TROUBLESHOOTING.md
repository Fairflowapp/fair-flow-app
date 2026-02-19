# Troubleshooting: sendStaffInvite CORS / FirebaseError internal

## 0. 403 על Preflight (sendStaffInviteCallable) – פתרון מהיר – Gen 1

הזמנות המייל רצות על **Gen 1** Cloud Functions.

אם מקבלים **403 Forbidden** על `sendStaffInviteCallable` או **CORS blocked**:

```powershell
# התחברות והגדרת פרויקט
gcloud auth login
gcloud config set project fairflowapp-db841

# Gen 1 – הוספת Cloud Functions Invoker
# אם allUsers חסום על־ידי מדיניות ארגונית, נסי allAuthenticatedUsers:
gcloud functions add-invoker-policy-binding sendStaffInvite --region=us-central1 --member="allUsers"

# או (אם allUsers חסום):
gcloud functions add-invoker-policy-binding sendStaffInvite --region=us-central1 --member="allAuthenticatedUsers"
```

---

## 1. אימות הרשאות IAM ב-GCP

### בדיקה ידנית (Google Cloud Console)
1. היכנסי ל-[Google Cloud Console](https://console.cloud.google.com/)
2. בחרי את הפרויקט `fairflowapp-db841`
3. **IAM & Admin** → **IAM**
4. חפשי `Cloud Functions` או `allUsers`
5. הפונקציה חייבת להיות נגישה ל-`allUsers` עם התפקיד **Cloud Functions Invoker**

### בדיקה ושינוי דרך gcloud (CLI)

```powershell
# התקנת gcloud (אם עדיין לא מותקן):
# https://cloud.google.com/sdk/docs/install

# התחברות
gcloud auth login

# בחירת הפרויקט
gcloud config set project fairflowapp-db841

# רשימת הפונקציות וה-region
gcloud functions list --gen2
# או Gen1:
gcloud functions list

# הצגת הרשאות IAM לפונקציה sendStaffInvite
gcloud functions get-iam-policy sendStaffInvite --region=us-central1 --gen2

# הוספת Cloud Functions Invoker ל-allUsers (אם חסר):
gcloud functions add-invoker-policy-binding sendStaffInvite \
  --region=us-central1 \
  --member="allUsers"

# ל-Gen2 (אם משתמשים ב-Gen2):
gcloud run services add-iam-policy-binding sendStaffInvite \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/run.invoker"
```

### אם הפונקציה היא Gen1 (Cloud Functions)
```powershell
gcloud functions add-iam-policy-binding sendStaffInvite \
  --region=us-central1 \
  --member="allUsers" \
  --role="roles/cloudfunctions.invoker"
```

---

## 2. קוד Client עם region מפורש + logging

ראה את השינויים ב-`public/index.html` וב-`public/app.js`:
- שימוש ב-`getFunctions(app, "us-central1")` עם app מפורש (לא `undefined`)
- `console.log` לפני ואחרי `httpsCallable`
- טעינת `getFunctions` מאותו Firebase SDK כמו שאר האפליקציה (גרסה 11.0.1)

---

## 3. פונקציית testCallable לבדיקה

נוספה פונקציה `testCallable` ב-`functions/index.js`.
אם היא עובדת ו-`sendStaffInvite` לא – הבעיה ספציפית ל-`sendStaffInvite`.

בדיקה מה-Console (F12) – אחרי שהדף נטען:
```javascript
(async () => {
  const app = window.__firebaseApp || (window.getApp && window.getApp());
  const getFunctions = window.getFunctions;
  const httpsCallable = window.httpsCallable;
  if (!app || !getFunctions || !httpsCallable) {
    console.error("Firebase not ready. app:", !!app, "getFunctions:", !!getFunctions, "httpsCallable:", !!httpsCallable);
    return;
  }
  const fn = httpsCallable(getFunctions(app, "us-central1"), "testCallable");
  const r = await fn({ test: 1 });
  console.log("testCallable OK:", r.data);
})();
```

אם `testCallable` עובדת ו-`sendStaffInvite` לא – הבעיה ספציפית ל-`sendStaffInvite` (למשל Firestore rules, הרשאות, או לוגיקה פנימית).

---

## 4. מחיקה ו-redepoy בטוחים

### לפני מחיקה
```powershell
cd "c:\Users\Neo Nails\Fair Flow APP 2"
```

### מחיקה (רק הפונקציה)
```powershell
firebase functions:delete sendStaffInvite --region=us-central1
# יתבקש אימות – אשר/י
```

### פריסה מחדש
```powershell
firebase deploy --only functions:sendStaffInvite
```

### אם הפונקציה תקועה / cache
```powershell
# פריסה מחדש של כל הפונקציות
firebase deploy --only functions
```

---

## 5. Error handling משופר ב-onCall

נוסף try-catch בתחילת הפונקציה עם `console.error` מפורט, כדי לתפוס קריסות מוקדמות לפני הלוג הראשון.
