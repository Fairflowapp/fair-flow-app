# שליחת מיילים עם Gmail

כדי שמיילי ההזמנה יישלחו ישירות (בלי Trigger Email):

## שלבים

1. **הפעל אימות דו-שלבי** בחשבון Google:
   - https://myaccount.google.com/security

2. **צור סיסמת אפליקציה (App Password)**:
   - https://myaccount.google.com/apppasswords
   - בחר "דואר" → צור סיסמה (16 תווים)

3. **צור קובץ `functions/.env`** עם התוכן:
   ```
   SMTP_USER=האימייל-שלך@gmail.com
   SMTP_PASS=סיסמת-האפליקציה-16-תווים
   ```

4. **פרוס**:
   ```
   .\deploy-functions.ps1
   ```

(הקובץ .env כבר נוצר עם ההגדרות שלך)
