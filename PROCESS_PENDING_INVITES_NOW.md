# שליחת הזמנות ידנית (כשהטריגרים לא רצים)

## אופציה 1: הרצה מהמחשב (PowerShell)

1. הרצי קודם (פעם אחת):
   ```powershell
   gcloud auth application-default login
   ```
2. אחרי ההתחברות:
   ```powershell
   cd "c:\Users\Neo Nails\Fair Flow APP 2\functions"
   node process-pending-invites.js
   ```

## אופציה 2: Cloud Shell

1. היכנסי ל־https://console.cloud.google.com
2. בחרי את הפרויקט **fairflowapp-db841**
3. לחצי על אייקון **>_** (Cloud Shell)
4. העלי את הקובץ `functions/process-pending-invites.js` (דרג־גרור)
5. הרצי:
   ```bash
   npm install firebase-admin
   node process-pending-invites.js
   ```

---

זה יטפל בכל ההזמנות ב־PENDING וישלח את המיילים. בדקי ב־Firestore ש־status התעדכן ל־"done".
