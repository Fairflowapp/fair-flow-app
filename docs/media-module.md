# Media Module – Filters & Sorting

## Overview

The MEDIA screen includes a **Filters** bar and **Sort** dropdown to help managers and admins find content quickly. All filtering and sorting is done **client-side only** (no Firestore query changes).

---

## Filter Bar

Located above the work list.

### My Uploads (Technician / Manager / Admin)

| Filter | Condition |
|--------|-----------|
| All | All works |
| Active | `status === "active"` |
| Posted | `postedCount > 0` |
| Featured | `featured === true` |
| Archived | `status === "archived"` |

### To Handle (Manager / Admin only)

| Filter | Condition |
|--------|-----------|
| All | All works |
| Not Posted | `postedCount === 0` |
| Posted | `postedCount > 0` |
| Featured | `featured === true` |
| Archived | `status === "archived"` |
| Duplicate | `duplicate === true` |

---

## Sorting

| Option | Logic |
|--------|------|
| Newest | `createdAt` desc |
| Oldest | `createdAt` asc |
| Most Posted | `postedCount` desc |
| Featured First | `featured` desc, then `createdAt` desc |

---

## Implementation

- **State:** `currentMediaFilter`, `currentMediaSort` in `media-upload.js`
- **Filter:** Applied in JS after fetching from Firestore
- **Sort:** Applied in JS after filtering
- **No backend changes:** `subscribeContentWorks` query unchanged

---

## UI Behavior

- Active filter has highlighted background (dark)
- Filter/sort changes are immediate (no page reload)
- Switching tabs resets filter to "All"
