# Media Module – Data Model

## Overview

The Media module manages **content works** (עבודות) – each Work represents one completed job for a client, with associated media files and posting history. The structure is prepared for future Fair Flow Points integration (no points logic yet).

---

## Collection Structure

```
salons/{salonId}/contentWorks/{workId}
  ├── mediaItems/{mediaId}      ← subcollection
  └── postedHistory/{historyId} ← subcollection
```

### Choice: Subcollections vs Top-Level Collections

**Chosen: Subcollections**

- **mediaItems** and **postedHistory** are subcollections of `contentWorks`.
- **Rationale:**
  - Both have a strict 1:N relationship with a Work (one work → many media items, one work → many posted entries).
  - Data is always accessed in the context of a specific Work.
  - No need for cross-work queries on media or posted history.
  - Simpler paths: `contentWorks/{workId}/mediaItems` instead of `mediaItems` + `where('workId','==',workId)`.
  - Aligns with Firestore hierarchy best practices.
  - `workId` is implicit from the path, so no redundant field in documents.

---

## 1. contentWorks (Main Collection)

**Path:** `salons/{salonId}/contentWorks/{workId}`

Each document represents one work performed for a client (not a single file).

### Document Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| salonId | string | — | Tenant ID (matches path, for queries) |
| staffId | string | — | Staff who performed the work |
| staffName | string | — | Snapshot of staff name (read-only after create) |
| createdByUid | string | — | UID of user who created the record (security) |
| createdByRole | string | — | Role of creator: "technician", "manager", etc. |
| serviceType | string | — | Type of service (e.g. from services catalog) |
| caption | string | "" | Optional caption/description |
| featured | boolean | false | Featured work flag |
| duplicate | boolean | false | Duplicate work flag |
| status | string | "active" | `active` \| `archived` \| `deleted` |
| postedCount | number | 0 | Count of posted entries |
| createdAt | Timestamp | — | Creation time |
| updatedAt | Timestamp \| null | null | Last update time |

### Status Values

- **active** – visible, in use
- **archived** – hidden from main view
- **deleted** – soft delete

### Future Points Hooks (not implemented)

The structure supports future events: create Work, add media, mark Featured, mark Posted, delete, archive, duplicate.

---

## 2. mediaItems (Subcollection)

**Path:** `salons/{salonId}/contentWorks/{workId}/mediaItems/{mediaId}`

Each document is one media file (photo/video) belonging to a Work.

### Document Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| mediaType | string | — | `photo` \| `video` \| `before_after_before` \| `before_after_after` |
| mediaUrl | string | — | Download URL (Firebase Storage) |
| storagePath | string | — | Storage path for delete/update |
| sortOrder | number | 0 | Display order |
| createdAt | Timestamp | — | Creation time |

### mediaType Values

- **photo** – regular photo
- **video** – video
- **before_after_before** – before image in before/after pair
- **before_after_after** – after image in before/after pair

---

## 3. postedHistory (Subcollection)

**Path:** `salons/{salonId}/contentWorks/{workId}/postedHistory/{historyId}`

Each document records one posting of the work to a platform.

### Document Schema

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| platform | string | — | e.g. "instagram", "facebook", "tiktok" |
| format | string | — | e.g. "story", "reel", "post" |
| postedDate | string | — | Date of posting (YYYY-MM-DD or ISO) |
| markedByStaffId | string | — | Staff who marked as posted |
| markedByName | string | — | Snapshot of staff name |
| notes | string | "" | Optional notes |
| createdAt | Timestamp | — | Creation time |

---

## Storage Paths (Firebase Storage)

Media files are stored under:

```
salons/{salonId}/media/{workId}/{mediaId}-{fileName}
```

Example: `salons/salon_abc/media/work_xyz/a1b2c3d4-photo.jpg`

---

## Indexes

Firebase will suggest indexes when queries run. Expected composite indexes:

```javascript
// contentWorks: filter by status, sort by date
// Query: where('status','==','active').orderBy('createdAt','desc')
[status, createdAt DESC]

// contentWorks: filter by staff
// Query: where('staffId','==',staffId).orderBy('createdAt','desc')
[staffId, createdAt DESC]

// contentWorks: featured works
// Query: where('featured','==',true).orderBy('createdAt','desc')
[featured, createdAt DESC]
```

---

## Sample Documents

### contentWorks

```javascript
{
  salonId: "salon_xyz",
  staffId: "staff_123",
  staffName: "Sarah Cohen",
  createdByUid: "uid_abc...",
  createdByRole: "technician",
  serviceType: "manicure",
  caption: "Gel nails - spring colors",
  featured: false,
  duplicate: false,
  status: "active",
  postedCount: 1,
  createdAt: Timestamp,
  updatedAt: null
}
```

### mediaItems

```javascript
{
  mediaType: "photo",
  mediaUrl: "https://...",
  storagePath: "salons/salon_xyz/media/work_abc/202603/xyz_photo.jpg",
  sortOrder: 0,
  createdAt: Timestamp
}
```

### postedHistory

```javascript
{
  platform: "instagram",
  format: "reel",
  postedDate: "2026-03-15",
  markedByStaffId: "staff_123",
  markedByName: "Sarah Cohen",
  notes: "",
  createdAt: Timestamp
}
```
