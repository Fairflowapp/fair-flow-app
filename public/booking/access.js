/**
 * Central Booking entitlement. All Booking access checks go through
 * window.ffCanAccessBooking — do not scatter package/plan logic elsewhere.
 *
 * V1 (staging prototype): enabled for signed-in salon members on staging/localhost.
 * Production stays off until a real Booking package exists. Does not weaken auth.
 */
(function () {
  function isStagingLike() {
    if (typeof window.FF_ENV === "string" && window.FF_ENV === "staging") return true;
    var host = (window.location && window.location.hostname) || "";
    return host === "localhost" || host === "127.0.0.1";
  }

  function isSignedIn() {
    try {
      if (document.body && document.body.classList.contains("ff-logged-out")) return false;
      if (window.ffAuth && window.ffAuth.currentUser) return true;
    } catch (_) {}
    return false;
  }

  function hasSalon() {
    try {
      return !!(window.currentSalonId && String(window.currentSalonId).trim());
    } catch (_) {
      return false;
    }
  }

  function isKiosk() {
    try {
      return !!(document.body && (
        document.body.classList.contains("ff-kiosk-mode") ||
        document.body.classList.contains("ff-kiosk-pairing-active")
      ));
    } catch (_) {
      return false;
    }
  }

  function canAccessBooking() {
    if (isKiosk()) return false;
    if (!isSignedIn()) return false;
    if (!hasSalon()) return false;
    if (isStagingLike()) return true;
    return false;
  }

  window.ffCanAccessBooking = canAccessBooking;
})();
