/**
 * Booking Client model V1 — identity helpers only.
 * Does not read Firestore. UI and the repository consume this.
 */
(function () {
  var SEARCH_LIMIT = 25;
  var NOTES_MAX = 2000;

  function trimText(value) {
    return String(value == null ? "" : value).trim();
  }

  function collapseSpaces(value) {
    return trimText(value).replace(/\s+/g, " ");
  }

  function normalizeNamePart(value) {
    return collapseSpaces(value).toLowerCase();
  }

  function displayName(firstName, lastName) {
    return [collapseSpaces(firstName), collapseSpaces(lastName)].filter(Boolean).join(" ");
  }

  function displayEmail(value) {
    return trimText(value);
  }

  function normalizeEmail(value) {
    return trimText(value).toLowerCase();
  }

  function isEmailLike(value) {
    var email = normalizeEmail(value);
    if (!email || /\s/.test(email)) return false;
    var at = email.indexOf("@");
    if (at <= 0 || at !== email.lastIndexOf("@")) return false;
    var local = email.slice(0, at);
    var domain = email.slice(at + 1);
    if (!/^[a-z0-9._+-]+$/.test(local)) return false;
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain)) return false;
    return true;
  }

  function phoneDigits(value) {
    return String(value == null ? "" : value).replace(/\D/g, "");
  }

  /**
   * Lookup keys for one phone. US 10-digit and +1 11-digit forms share keys.
   * Longer/shorter digit strings (international) stay intact — no country guessing.
   */
  function phoneKeys(value) {
    var digits = phoneDigits(value);
    var keys = [];
    if (!digits) return keys;
    keys.push(digits);
    if (digits.length === 11 && digits.charAt(0) === "1") {
      keys.push(digits.slice(1));
    } else if (digits.length === 10) {
      keys.push("1" + digits);
    }
    return uniqueStrings(keys);
  }

  var PREFIX_MIN = 3;

  /**
   * Prefixes of canonical phoneKeys, from 3 digits through the full key.
   * Used only for targeted array-contains partial lookup.
   */
  function phoneKeyPrefixes(value) {
    var keys = phoneKeys(value);
    var prefixes = [];
    keys.forEach(function (key) {
      var digits = phoneDigits(key);
      var i;
      for (i = PREFIX_MIN; i <= digits.length; i += 1) {
        prefixes.push(digits.slice(0, i));
      }
    });
    return uniqueStrings(prefixes);
  }

  function uniqueStrings(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (item) {
      var key = String(item || "");
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(key);
    });
    return out;
  }

  function stripPhonePunctuation(value) {
    return String(value == null ? "" : value).replace(/[\s().+\-\u2010-\u2015\u2212/]/g, "");
  }

  function looksLikePhoneQuery(value) {
    var digits = phoneDigits(value);
    var raw = trimText(value);
    if (!digits) return false;
    if (digits.length >= PREFIX_MIN && digits.length === stripPhonePunctuation(raw).length) return true;
    return digits.length >= 10 && digits.length / Math.max(raw.length, 1) >= 0.6;
  }

  function buildSearchFields(input) {
    var firstName = collapseSpaces(input && input.firstName);
    var lastName = collapseSpaces(input && input.lastName);
    var phone = collapseSpaces(input && input.phone);
    var email = displayEmail(input && input.email);
    var notes = collapseSpaces(input && input.notes);
    if (notes.length > NOTES_MAX) notes = notes.slice(0, NOTES_MAX);
    var firstNameNormalized = normalizeNamePart(firstName);
    var lastNameNormalized = normalizeNamePart(lastName);
    return {
      firstName: firstName,
      lastName: lastName,
      phone: phone,
      email: email,
      notes: notes,
      firstNameNormalized: firstNameNormalized,
      lastNameNormalized: lastNameNormalized,
      displayNameNormalized: displayName(firstNameNormalized, lastNameNormalized),
      emailNormalized: normalizeEmail(email),
      phoneDigits: phoneDigits(phone),
      phoneKeys: phoneKeys(phone),
      phoneKeyPrefixes: phoneKeyPrefixes(phone)
    };
  }

  function validateCreate(input) {
    var fields = buildSearchFields(input || {});
    if (!fields.firstName && !fields.lastName) {
      return { ok: false, error: "A first or last name is required." };
    }
    if (fields.email && !isEmailLike(fields.email)) {
      return { ok: false, error: "Email looks invalid." };
    }
    return { ok: true, fields: fields };
  }

  function fromDoc(id, data) {
    var raw = data && typeof data === "object" ? data : {};
    var firstName = collapseSpaces(raw.firstName);
    var lastName = collapseSpaces(raw.lastName);
    return {
      clientId: String(id || raw.clientId || ""),
      firstName: firstName,
      lastName: lastName,
      displayName: displayName(firstName, lastName),
      phone: collapseSpaces(raw.phone),
      email: displayEmail(raw.email),
      notes: collapseSpaces(raw.notes),
      firstNameNormalized: String(raw.firstNameNormalized || normalizeNamePart(firstName)),
      lastNameNormalized: String(raw.lastNameNormalized || normalizeNamePart(lastName)),
      displayNameNormalized: String(raw.displayNameNormalized || ""),
      emailNormalized: String(raw.emailNormalized || normalizeEmail(raw.email)),
      phoneDigits: String(raw.phoneDigits || phoneDigits(raw.phone)),
      phoneKeys: Array.isArray(raw.phoneKeys) ? raw.phoneKeys.slice() : phoneKeys(raw.phone),
      phoneKeyPrefixes: Array.isArray(raw.phoneKeyPrefixes) ? raw.phoneKeyPrefixes.slice() : phoneKeyPrefixes(raw.phone),
      createdAtLocationId: String(raw.createdAtLocationId || ""),
      createdByUid: String(raw.createdByUid || ""),
      createdByStaffId: String(raw.createdByStaffId || ""),
      createdAt: raw.createdAt || null,
      updatedAt: raw.updatedAt || null,
      photoUrl: String(raw.photoUrl || raw.photo || raw.avatarUrl || "")
    };
  }

  function classifyQuery(raw) {
    var q = collapseSpaces(raw);
    if (!q) return { kind: "empty", value: "" };
    if (isEmailLike(q)) return { kind: "email", value: normalizeEmail(q) };
    if (looksLikePhoneQuery(q)) return { kind: "phone", value: phoneDigits(q), keys: phoneKeys(q) };
    return { kind: "name", value: normalizeNamePart(q) };
  }

  window.ffBookingClientModel = {
    SEARCH_LIMIT: SEARCH_LIMIT,
    NOTES_MAX: NOTES_MAX,
    displayName: displayName,
    normalizeNamePart: normalizeNamePart,
    normalizeEmail: normalizeEmail,
    displayEmail: displayEmail,
    isEmailLike: isEmailLike,
    phoneDigits: phoneDigits,
    phoneKeys: phoneKeys,
    phoneKeyPrefixes: phoneKeyPrefixes,
    buildSearchFields: buildSearchFields,
    validateCreate: validateCreate,
    fromDoc: fromDoc,
    classifyQuery: classifyQuery
  };
})();
