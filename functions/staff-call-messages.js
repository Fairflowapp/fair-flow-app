/**
 * Closed Staff Call phone-message catalog (server source of truth for TTS).
 * IDs + text must stay in sync with the client list in public/index.html
 * (STAFF_CALL_MESSAGE_OPTIONS).
 *
 * callStaff maps staffCallTemplates.*.messageId → canonical text.
 * Free-text `message` in Firestore is never spoken.
 */

const AVAILABLE_MESSAGES = [
  { id: "available_client_waiting", text: "Your client is waiting" },
  { id: "available_client_arrived", text: "Your client has arrived" },
  { id: "available_return_to_floor", text: "Please return to the floor" },
  { id: "available_waiting_at_reception", text: "You have a client waiting at reception" },
];

const IN_SERVICE_MESSAGES = [
  { id: "inservice_reception_calling", text: "Reception is calling you" },
  { id: "inservice_front_desk_when_you_can", text: "Please come to the front desk when you can" },
  { id: "inservice_call_reception", text: "Please call reception" },
  { id: "inservice_needed_at_reception", text: "You're needed at reception" },
];

const BY_KIND = {
  available: AVAILABLE_MESSAGES,
  inService: IN_SERVICE_MESSAGES,
};

const DEFAULT_ID = {
  available: "available_client_waiting",
  inService: "inservice_reception_calling",
};

function kindForCallType(callType) {
  return callType === "front_desk" ? "inService" : "available";
}

function listForKind(kind) {
  return BY_KIND[kind] || AVAILABLE_MESSAGES;
}

function defaultIdForKind(kind) {
  return DEFAULT_ID[kind] || DEFAULT_ID.available;
}

function findById(kind, messageId) {
  const id = String(messageId || "").trim();
  if (!id) return null;
  return listForKind(kind).find((row) => row.id === id) || null;
}

function findByText(kind, message) {
  const needle = String(message || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!needle) return null;
  return listForKind(kind).find((row) => row.text.toLowerCase() === needle) || null;
}

/**
 * Resolve canonical phone text from a template entry.
 * Prefer messageId; fall back to exact text match on legacy `message`; else default.
 */
function resolveCanonicalMessage(kindOrCallType, entry) {
  const kind =
    kindOrCallType === "client_waiting" || kindOrCallType === "front_desk"
      ? kindForCallType(kindOrCallType)
      : kindOrCallType === "inService"
        ? "inService"
        : "available";
  const raw = entry && typeof entry === "object" ? entry : {};
  const byId = findById(kind, raw.messageId);
  if (byId) return { kind, messageId: byId.id, text: byId.text, source: "messageId" };
  const byText = findByText(kind, raw.message);
  if (byText) return { kind, messageId: byText.id, text: byText.text, source: "legacy-message" };
  const fallback = findById(kind, defaultIdForKind(kind));
  return {
    kind,
    messageId: fallback.id,
    text: fallback.text,
    source: "default",
  };
}

module.exports = {
  AVAILABLE_MESSAGES,
  IN_SERVICE_MESSAGES,
  BY_KIND,
  DEFAULT_ID,
  kindForCallType,
  listForKind,
  defaultIdForKind,
  findById,
  findByText,
  resolveCanonicalMessage,
};
