# Self Delete – תיעוד

## קבצים שעודכנו

| קובץ | שינויים |
|------|---------|
| `public/media-cloud.js` | הוספת `selfDeleteContentWork(workId)` – מוחק מדיה מ-Storage, מוחק mediaItems, מעדכן status ל-"deleted" |
| `public/media-upload.js` | הוספת `isSelfDeleteEligible()`, `canShowSelfDeleteButton()`, כפתור "Delete My Work" ב-Work Details, הודעה ל-eligible |

## איך נקבע eligibility

הפונקציה `isSelfDeleteEligible(work)` בודקת שכל התנאים מתקיימים:

1. **createdByUid === uid** – ה-Work שייך למשתמש המחובר
2. **postedCount === 0** – לא סומן כ-Posted
3. **featured !== true** – לא Featured
4. **status === "active"** – רק עבודות פעילות
5. **פחות מ-24 שעות מאז createdAt** – חישוב: `(Date.now() - createdAt) / (1000*60*60) < 24`

## איך נבדק חלון 24 שעות

```javascript
const createdAt = work.createdAt?.toDate ? work.createdAt.toDate() : new Date(work.createdAt);
const hoursSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);
return hoursSince < 24;
```

## איך נבדק שה-Work שייך למשתמש

```javascript
work.createdByUid === auth.currentUser?.uid
```

## מה בדיוק קורה במחיקה

1. `deleteAllMediaFromWork(workId)` – מוחק את כל קבצי המדיה מ-Firebase Storage, מוחק את כל mediaItems מ-Firestore
2. `updateContentWork(workId, { status: "deleted" })` – מעדכן את status ל-"deleted"

## איך ה-UI מתנהג כשה-Work לא eligible

- **לא מציגים את הכפתור** – אם המשתמש לא Technician/Manager ולא Admin
- **לא מציגים את הכפתור** – אם ה-Work לא eligible (לא שלו, או Posted, או Featured, או מעל 24 שעות)
- **מציגים טקסט הסבר** – אם המשתמש Technician/Manager, ה-Work שלו, אבל לא eligible: "You can only delete your own active work within 24 hours, before it is posted or featured."

## מי יכול לראות Delete My Work

- **Technician** – רק על Work שלו, בתנאים
- **Manager** – רק על Work שלו, בתנאים
- **Admin** – לא מקבל את הכפתור (יש לו Delete Work / Delete Media Only)

## Confirm לפני מחיקה

טקסט: "This will delete your uploaded work and remove its media files. Continue?"
כפתורים: Cancel, Delete My Work (אישור)

## עדכון UI אחרי מחיקה

- סגירת Work Details
- עדכון הרשימה (renderMediaList)
- ה-Work לא יופיע יותר (מסונן לפי `status !== "deleted"`)
