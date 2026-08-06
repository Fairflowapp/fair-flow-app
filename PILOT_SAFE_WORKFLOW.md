# Pilot Safe Workflow — Fair Flow

מטרה: לקוחות חיים (פיילוט) חייבים חוויה זורמת. אסור ריסט/הבהוב/אובדן נתונים באמצע היום.
לפי הכלל הזה עובדים על כל תיקון מחר ואילך.

## נקודת שחזור יציבה אחרונה
- Tag: `stable-pilot-2026-06-06`
- Commit: `71687d4`
- ענף עבודה: `sync/production` (מגובה ל-GitHub)

חזרה מהירה למצב היציב אם משהו נשבר:
```bash
git checkout stable-pilot-2026-06-06 -- public/
firebase deploy --only hosting --project fair-flow-staging   # קודם בדיקה
firebase deploy --only hosting --project fairflowapp-db841    # רק אחרי אישור
```

## תהליך פריסה (תמיד בסדר הזה)
1. לבצע את השינוי בקוד.
2. **לבדוק קודם ב-staging:** `firebase deploy --only hosting --project fair-flow-staging`
3. לבדוק בטלפון אמיתי ב-https://fair-flow-staging.web.app (לסגור אפליקציה לגמרי ולפתוח מחדש).
4. רק כשתקין — לפרוס לפרודקשן: `firebase deploy --only hosting --project fairflowapp-db841`
5. לעשות commit + tag לפני פריסת פרודקשן גדולה.

> פרודקשן (`fairflowapp-db841`) רק כשמבקשים במפורש. ברירת מחדל = staging.

## אזורים רגישים — לבדוק שלא נשברו אחרי כל שינוי שנוגע בתור
- **טעינת התור (boot):** התור צריך לעלות מלא ולהישאר. בלי "ריק → מלא".
- **צבעי העובדים:** הצבע הנכון כבר בפריסה הראשונה (יש מטמון `ff_staff_color_cache_v1`).
- **Auto-Reset:** לא רץ רטרואקטיבית בטעינה; מאפס רק כשהשעון חוצה את הזמן בזמן שהאפליקציה פתוחה.
- **דריסת ענן:** מכשיר שעלה לא דורס תור חי בענן בנתונים ישנים.

## הגנות שלא לגעת בהן (אלא בזהירות מלאה)
בקובץ `public/queue-cloud.js`:
- אין לנקות את התור ב-resubscribe לאותו סניף (רק במעבר סניף אמיתי).
- אין לצייר snapshot ריק מ-cache בזמן boot אם יש נתונים מקומיים.
- `__ff_queueCloudServerConfirmed` — דגל שאומר שראינו snapshot אמיתי מהשרת.

בקובץ `public/index.html`:
- `ffFilterQueueStateToCurrentStaff` — לא מרוקן תור מלא לגמרי (מונע מרוץ טעינת צוות).
- `applyState` — לא מחליף תור מלא בריק לפני אישור שרת (אלא ב-reset מפורש).
- מטמון צבעי צוות (`ffStaffColorCacheStore` / `ffStaffColorCacheLookup`).

בקובץ `public/index.html` (auto-reset):
- `ffMaybeAutoResetQueue` — חלון חסד של שעתיים + "claim today without wiping" בטעינה ראשונה.

## כלל זהב
כל שינוי שנוגע ב: תור / ריסט / טעינה / סנכרון ענן —
1. מתחילים מנקודת היציבות.
2. בודקים ב-staging בטלפון.
3. מוודאים שכל "האזורים הרגישים" עדיין עובדים.
4. רק אז פרודקשן.
