# Firebase Storage CORS – הורדה אוטומטית

כדי שההורדה תעבוד אוטומטית, צריך להגדיר CORS על ה-Storage bucket (פעם אחת).

## אופציה 1: Google Cloud Shell (בלי התקנה – הכי פשוט)

1. היכנס ל־https://console.cloud.google.com
2. בחר את הפרויקט **fairflowapp-db841**
3. לחץ על אייקון **>_** (Cloud Shell) בפינה הימנית למעלה
4. בחלון שנפתח, הרץ:
```
echo '[{"origin":["*"],"method":["GET"],"maxAgeSeconds":3600}]' > storage-cors.json
gsutil cors set storage-cors.json gs://fairflowapp-db841.appspot.com
```
5. אם תתבקש – `gcloud auth login`

## אופציה 2: Terminal במחשב

1. התקן [Google Cloud SDK](https://cloud.google.com/sdk/docs/install)
2. פתח PowerShell/CMD
3. `cd` לתיקיית הפרויקט (איפה ש־storage-cors.json)
4. הרץ:
```
gcloud auth login
gsutil cors set storage-cors.json gs://fairflowapp-db841.appspot.com
```
