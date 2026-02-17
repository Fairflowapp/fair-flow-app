# Inbox/Requests Data Model

## Collection Structure
```
salons/{salonId}/inboxItems/{itemId}
```

## Document Schema

### Core Fields (all types)
```javascript
{
  // Identity (NO 'id' field - use document ID directly!)
  tenantId: string,              // = salonId (for consistency/queries)
  locationId: string | null,     // optional: "brickell", "key_biscayne", etc.
  
  // Request info
  type: string,                  // "vacation" | "late_start" | "early_leave" | "schedule_change" | "supplies" | "maintenance" | "other"
  status: string,                // "open" | "needs_info" | "approved" | "denied" | "done" | "archived"
  priority: string,              // "normal" | "urgent"
  
  // People (BOTH uid and staffId for security + display)
  createdByUid: string,          // request.auth.uid - source of truth for security
  createdByStaffId: string,      // for display/linking to staff doc
  createdByName: string,         // snapshot for display (read-only after create)
  createdByRole: string,         // snapshot: "technician", "manager", etc. (read-only after create)
  forUid: string,                // who the request is for (uid) - source of truth
  forStaffId: string,            // who the request is for (staffId) - for display
  forStaffName: string,          // snapshot (read-only after create)
  assignedTo: string | null,     // managerId or null/"unassigned"
  
  // Timestamps
  createdAt: Timestamp,
  lastActivityAt: Timestamp,     // for sorting
  updatedAt: Timestamp | null,
  
  // Data (type-specific, see below)
  data: object,
  
  // Manager actions
  managerNotes: string | null,   // internal note
  responseNote: string | null,   // note visible to requester
  decidedBy: string | null,      // uid of manager who approved/denied
  decidedAt: Timestamp | null,
  
  // needs_info workflow
  needsInfoQuestion: string | null,   // what manager asked
  staffReply: string | null,          // staff's response (or use comments subcollection)
  
  // Visibility & notifications
  visibility: string,                 // "managers_only" (default)
  unreadForManagers: boolean,         // true when created/updated by staff
  
  // Audit via subcollection (NOT array!)
  // events subcollection: salons/{salonId}/inboxItems/{itemId}/events/{eventId}
}
```

---

## Type-Specific Data

### `type: "vacation"`
```javascript
data: {
  startDate: string,      // "2026-02-20"
  endDate: string,        // "2026-02-25"
  daysCount: number,      // 6
  note: string | null     // optional reason
}
```

### `type: "late_start"`
```javascript
data: {
  date: string,                // "2026-02-20"
  requestedTime: string,       // "10:00"
  normalTime: string | null,   // "08:00" (optional - for reference)
  reason: string
}
```

### `type: "early_leave"`
```javascript
data: {
  date: string,                // "2026-02-20"
  requestedTime: string,       // "15:00"
  normalTime: string | null,   // "17:00" (optional - for reference)
  reason: string
}
```

### `type: "schedule_change"`
```javascript
data: {
  affectedDates: array<string>,  // ["2026-02-20", "2026-02-21"]
  currentSchedule: string,       // "Mon-Fri 9-5"
  requestedSchedule: string,     // "Tue-Sat 10-6"
  reason: string,
  isTemporary: boolean
}
```

### `type: "supplies"`
```javascript
data: {
  items: array<{name, quantity, unit}>,  // unit: "bottles", "pcs", "boxes", etc.
  urgency: string,                       // "routine" | "urgent" | "critical"
  note: string | null
}
```

### `type: "maintenance"`
```javascript
data: {
  issue: string,
  area: string,         // "Station 3", "Break room", etc. (renamed from 'location' to avoid confusion)
  severity: string,     // "minor" | "moderate" | "urgent"
  note: string | null
}
```

### `type: "other"`
```javascript
data: {
  subject: string,
  details: string
}
```

---

## Status Flow

```
open (new request)
  ↓
needs_info (manager asks for clarification)
  ↓ (staff responds)
open (back to queue)
  ↓
approved OR denied (manager decision)
  ↓
done (processed/actioned)
  ↓
archived (hidden from active list)
```

---

## Indexes Needed

**Note:** Since queries are scoped to `salons/{salonId}/inboxItems`, you DON'T need `tenantId` in indexes!

Firebase will automatically prompt you to create indexes when you run queries. The typical ones:

```javascript
// Manager: filter by status + sort by activity
// Query: where('status', '==', 'open').orderBy('lastActivityAt', 'desc')
composite: [status, lastActivityAt DESC]

// Technician: my requests
// Query: where('forUid', '==', uid).orderBy('lastActivityAt', 'desc')
composite: [forUid, lastActivityAt DESC]

// Assigned to specific manager
// Query: where('assignedTo', '==', managerId).where('status', '==', 'open').orderBy('lastActivityAt', 'desc')
composite: [assignedTo, status, lastActivityAt DESC]
```

**Let Firebase Console tell you exactly which indexes to create when you first run the queries!**

---

## Sample Document

```javascript
// Document ID: req_abc123 (auto-generated, NOT in the document!)
{
  // NO 'id' field - use document.id from Firestore!
  tenantId: "salon_xyz",
  locationId: "brickell",
  
  type: "vacation",
  status: "open",
  priority: "normal",
  
  // People (UID = source of truth, staffId for display)
  createdByUid: "YLI2yWA436NHjJnTm...",
  createdByStaffId: "staff_123",
  createdByName: "Sarah Cohen",        // read-only after create
  createdByRole: "technician",         // read-only after create
  forUid: "YLI2yWA436NHjJnTm...",
  forStaffId: "staff_123",
  forStaffName: "Sarah Cohen",         // read-only after create
  assignedTo: null,
  
  // Timestamps
  createdAt: Timestamp(2026-02-16T10:00:00Z),
  lastActivityAt: Timestamp(2026-02-16T10:00:00Z),
  updatedAt: null,
  
  // Type-specific data
  data: {
    startDate: "2026-03-01",
    endDate: "2026-03-05",
    daysCount: 5,
    note: "Family vacation - planned months ago"
  },
  
  // Manager actions (all null on create)
  managerNotes: null,
  responseNote: null,
  decidedBy: null,
  decidedAt: null,
  needsInfoQuestion: null,
  staffReply: null,
  
  // Visibility & notifications
  visibility: "managers_only",
  unreadForManagers: true
}
```

---

## Events Subcollection (for audit trail)

```
salons/{salonId}/inboxItems/{itemId}/events/{eventId}
```

Example event:
```javascript
{
  type: "status_changed",    // "created", "status_changed", "assigned", "note_added", "comment"
  byUid: "managerUid123",
  byName: "Manager Name",
  byRole: "manager",
  at: Timestamp,
  payload: {
    oldStatus: "open",
    newStatus: "approved"
  }
}
```

**Note:** Events subcollection is optional for MVP - can add later!
