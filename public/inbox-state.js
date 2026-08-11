/**
 * Inbox module state — extracted from inbox.js (Phase 0).
 * Mutable module-level state lives on `inboxState`; immutable config tables
 * are exported by name. Reassign via `inboxState.X = ...`.
 */

export const inboxState = {
  currentInboxTab: 'open',
  inboxViewMode: 'to_handle', // 'mine' | 'to_handle' — only for admin/manager
  inboxUnsubscribe: null,
  currentUserProfile: null,
  // Technicians: merge outgoing (createdByUid) + incoming (forUid) inbox queries.
  _techInboxOutgoing: [],
  _techInboxIncoming: [],
  currentRequests: [],
  customRequestTypes: [],
  inboxStaffFilterUid: '',
  inboxHiddenTypes: [], // loaded from salons/{salonId}/requestTypes
  _inboxUsersCache: null, // { uid, name, staffId, role }[] — loaded from Firestore users
  // Background badge listener (runs regardless of visible screen).
  _bgBadgeUnsubscribe: null,
  _bgBadgeLatestRows: [],
  _bgBadgeIsTech: false,
};

export const REQUEST_CATEGORY_ORDER = ['schedule', 'payments', 'operations', 'documents', 'other'];

export const REQUEST_CATEGORY_LABELS = {
  schedule: '🗓️ Schedule',
  payments: '💰 Payments',
  operations: '🛠️ Operations',
  documents: '📄 Documents',
  other: '⭐ Other'
};

// Built-in request types (id, icon, label, description, category)
export const BUILTIN_TYPES = [
  // Schedule
  { id: 'vacation', icon: '🏖️', label: 'Vacation Request', description: 'PTO — one day or a date range (same start & end = single day)', category: 'schedule' },
  { id: 'late_start', icon: '⏰', label: 'Late Start', description: 'Request to start later', category: 'schedule' },
  { id: 'early_leave', icon: '🏃', label: 'Early Leave', description: 'Request to leave early', category: 'schedule' },
  { id: 'schedule_change', icon: '📅', label: 'Schedule Change', description: 'Request schedule modification', category: 'schedule' },
  { id: 'extra_shift', icon: '✅', label: 'Extra Shift / Pick Up Shift', description: 'Request to work on a day you\'re not scheduled', category: 'schedule' },
  { id: 'swap_shift', icon: '🔄', label: 'Swap Shift', description: 'Swap a shift with another staff member', category: 'schedule' },
  { id: 'break_change', icon: '☕', label: 'Break Change', description: 'Request to change break time', category: 'schedule' },
  // Payments
  { id: 'commission_review', icon: '💰', label: 'Commission Review', description: 'Question about commission or payment', category: 'payments' },
  { id: 'tip_adjustment', icon: '💵', label: 'Tip Adjustment', description: 'Change tip after a service', category: 'payments' },
  { id: 'payment_issue', icon: '📋', label: 'Payment Issue', description: 'Report a payment problem', category: 'payments' },
  // Operations
  { id: 'supplies', icon: '📦', label: 'Supplies', description: 'Request supplies or materials', category: 'operations' },
  { id: 'maintenance', icon: '🔧', label: 'Maintenance', description: 'Report maintenance issue', category: 'operations' },
  { id: 'client_issue', icon: '👤', label: 'Client Issue', description: 'Report or discuss a client-related matter', category: 'operations' },
  { id: 'staff_birthday_reminder', icon: '🎂', label: 'Staff birthday reminder', description: 'Automated — upcoming staff birthday (management only)', category: 'operations' },
  { id: 'onboarding_incomplete', icon: '📋', label: 'Onboarding incomplete', description: 'Automated — employee has not finished onboarding after 7 days (management only)', category: 'operations' },
  // Documents
  { id: 'document_request', icon: '📄', label: 'Request a Document', description: 'Request a document from management (1099, employment letter, contract, etc.)', category: 'documents' },
  {
    id: 'document_renewal_request',
    icon: '📩',
    label: 'Request a new document (from staff)',
    description: 'Ask a service provider to upload a renewed document (e.g. insurance or license before it expires).',
    category: 'documents',
  },
  { id: 'document_upload', icon: '📤', label: 'Upload a Document', description: 'Upload a document to the business (license, insurance, certification)', category: 'documents' },
  { id: 'document_expiring_soon', icon: '⏳', label: 'Document expiring soon', description: 'Automated — staff document expires within 30 days (management only)', category: 'documents' },
  { id: 'document_expired', icon: '⚠️', label: 'Document expired', description: 'Automated — staff document past expiration (management only)', category: 'documents' },
  // Other (always last)
  { id: 'other', icon: '📝', label: 'Other', description: 'Other request', category: 'other' }
];

/** Old inbox items only — not offered in “New request”. */
export const LEGACY_INBOX_TYPE_INFO = {
  day_off: { id: 'day_off', icon: '📴', label: 'Day off', description: 'Legacy request', category: 'schedule' },
  time_off: { id: 'time_off', icon: '🕐', label: 'Time off', description: 'Legacy request', category: 'schedule' },
  inventory_suggestion: { id: 'inventory_suggestion', icon: '📉', label: 'Smart Inventory Alert', description: 'Automated — item forecast to run out soon', category: 'operations' },
};

/** Automated inbox items for management ("To handle") only — never list for technicians. */
export const MANAGER_ONLY_INBOX_TYPES = new Set(["staff_birthday_reminder", "onboarding_incomplete", "document_expiring_soon", "document_expired", "inventory_suggestion"]);

export const INBOX_SETTINGS_DOC_ID = 'visibility';

export const FF_INVENTORY_SUPPLY_VARIANT_KEYS = new Set(["dip", "gel", "regular"]);

export const SUPPLIES_VARIANT_LABELS = { dip: "Dip", gel: "Gel", regular: "Regular" };

export const CUSTOM_TYPE_EMOJIS = ['📝', '📚', '📋', '📅', '⏰', '📦', '🔧', '✅', '🎯', '🪴', '📌', '🔔', '🏖️', '🏃', '💡', '📎'];
