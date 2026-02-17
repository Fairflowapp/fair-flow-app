# Firestore Rules for Inbox/Requests

## MVP Rules - Secure & Clean

### Rules for `salons/{salonId}/inboxItems/{itemId}`

```javascript
match /salons/{salonId}/inboxItems/{itemId} {
  
  // Helpers
  function userDoc() {
    return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
  }

  function belongsToSalon() {
    return request.auth != null
      && exists(/databases/$(database)/documents/users/$(request.auth.uid))
      && userDoc().salonId == salonId;
  }

  function isManager() {
    return belongsToSalon() && userDoc().role in ['manager','admin','owner'];
  }

  function isTechnician() {
    return belongsToSalon() && userDoc().role == 'technician';
  }

  function changedKeys() {
    return request.resource.data.diff(resource.data).changedKeys();
  }

  // CREATE
  allow create: if belongsToSalon()
    // Required fields
    && request.resource.data.tenantId == salonId
    && request.resource.data.type is string
    && request.resource.data.status == 'open'
    && request.resource.data.priority is string
    
    // Identity (use UID as source of truth!)
    && request.resource.data.createdByUid == request.auth.uid
    && request.resource.data.forUid is string
    && request.resource.data.createdByStaffId is string
    && request.resource.data.forStaffId is string
    
    // Snapshots (read-only after create)
    && request.resource.data.createdByName is string
    && request.resource.data.createdByRole is string
    && request.resource.data.forStaffName is string
    
    // Lock decision fields at creation
    && request.resource.data.decidedBy == null
    && request.resource.data.decidedAt == null
    && request.resource.data.managerNotes == null
    && request.resource.data.responseNote == null
    && request.resource.data.assignedTo == null
    && request.resource.data.needsInfoQuestion == null
    && request.resource.data.staffReply == null
    && request.resource.data.visibility == 'managers_only'
    && request.resource.data.unreadForManagers == true
    
    // Permission check
    && (
      // Technician: can only create for themselves
      (isTechnician() && request.resource.data.forUid == request.auth.uid)
      ||
      // Manager: can create for anyone (on-behalf-of)
      isManager()
    );

  // READ
  allow read: if belongsToSalon()
    && (
      // Manager: can read all requests in salon
      isManager()
      ||
      // Technician: can only read their own requests (by UID!)
      (isTechnician() && resource.data.forUid == request.auth.uid)
    );

  // UPDATE (managers only in MVP)
  allow update: if isManager()
    // Lock immutable fields
    && request.resource.data.tenantId == resource.data.tenantId
    && request.resource.data.type == resource.data.type
    && request.resource.data.createdByUid == resource.data.createdByUid
    && request.resource.data.createdByStaffId == resource.data.createdByStaffId
    && request.resource.data.createdByName == resource.data.createdByName
    && request.resource.data.createdByRole == resource.data.createdByRole
    && request.resource.data.forUid == resource.data.forUid
    && request.resource.data.forStaffId == resource.data.forStaffId
    && request.resource.data.forStaffName == resource.data.forStaffName
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.data == resource.data.data
    // Allow-list: only these fields can be changed
    && changedKeys().hasOnly([
      'status',
      'assignedTo',
      'managerNotes',
      'responseNote',
      'needsInfoQuestion',
      'staffReply',
      'decidedBy',
      'decidedAt',
      'lastActivityAt',
      'updatedAt',
      'unreadForManagers',
      'priority'
    ]);

  // DELETE
  allow delete: if false;  // no deletion, only archive via status='archived'
}
```

---

## Future Enhancement: Staff Can Reply to "needs_info"

When ready to allow technicians to respond:

```javascript
// Add to UPDATE rule:
|| (
  // Technician can reply if status is needs_info AND it's their request
  isTechnician()
  && resource.data.forUid == request.auth.uid
  && resource.data.status == 'needs_info'
  // Lock immutable fields
  && request.resource.data.tenantId == resource.data.tenantId
  && request.resource.data.type == resource.data.type
  && request.resource.data.createdByUid == resource.data.createdByUid
  && request.resource.data.forUid == resource.data.forUid
  // etc...
  // Allow only these changes:
  && changedKeys().hasOnly(['staffReply', 'lastActivityAt', 'updatedAt', 'unreadForManagers'])
)
```

---

## Simplified Rules (if above is too complex)

```javascript
match /salons/{salonId}/inboxItems/{itemId} {
  
  allow create: if request.auth != null
    && exists(/databases/$(database)/documents/users/$(request.auth.uid))
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.salonId == salonId
    && request.resource.data.tenantId == salonId
    && request.resource.data.status == 'open';
  
  allow read: if request.auth != null
    && exists(/databases/$(database)/documents/users/$(request.auth.uid))
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.salonId == salonId;
  
  allow update: if request.auth != null
    && exists(/databases/$(database)/documents/users/$(request.auth.uid))
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.salonId == salonId
    && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['manager', 'admin', 'owner'];
  
  allow delete: if false;
}
```

**Note:** Simplified version is easier to start with. Can enhance later with fine-grained permissions.

---

## Required Firestore Indexes

**Important:** Since queries are scoped to `salons/{salonId}/inboxItems`, you do NOT need `tenantId` in composite indexes!

Firebase Console will automatically prompt you to create indexes when you run queries. Based on the queries below:

```json
{
  "indexes": [
    {
      "collectionGroup": "inboxItems",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "lastActivityAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "inboxItems",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "forUid", "order": "ASCENDING" },
        { "fieldPath": "lastActivityAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "inboxItems",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assignedTo", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "lastActivityAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

**Recommendation:** Don't create indexes manually yet - let Firebase tell you which ones are needed when you run the actual queries!

---

## Key Queries

### Manager: All open requests
```javascript
const q = query(
  collection(db, `salons/${salonId}/inboxItems`),
  where('status', '==', 'open'),
  orderBy('lastActivityAt', 'desc'),
  limit(50)
);
```

### Technician: My requests
```javascript
const q = query(
  collection(db, `salons/${salonId}/inboxItems`),
  where('forUid', '==', currentUser.uid),  // Use UID for security!
  orderBy('lastActivityAt', 'desc'),
  limit(50)
);
```

### Manager: Assigned to me
```javascript
const q = query(
  collection(db, `salons/${salonId}/inboxItems`),
  where('assignedTo', '==', managerId),
  where('status', '==', 'open'),
  orderBy('lastActivityAt', 'desc'),
  limit(50)
);
```
