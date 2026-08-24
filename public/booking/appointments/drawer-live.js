/**
 * Offset the LIVE FAB while a Booking right drawer is open.
 * Shared by New Appointment and Appointment Details. Does not change LIVE itself.
 */
(function () {
  function rememberFab(fab) {
    if (!fab || fab.dataset.ffApptSaved === "1") return;
    fab.dataset.ffApptSaved = "1";
    fab.dataset.ffApptLeft = fab.style.left || "";
    fab.dataset.ffApptRight = fab.style.right || "";
    fab.dataset.ffApptTop = fab.style.top || "";
    fab.dataset.ffApptBottom = fab.style.bottom || "";
  }

  function place(drawer) {
    var fab = document.querySelector(".ff-live-desk-fab");
    if (!fab || !drawer) return;
    rememberFab(fab);
    var rect = drawer.getBoundingClientRect();
    var width = rect.width || drawer.offsetWidth || 420;
    var leftEdge = rect.left;
    document.documentElement.style.setProperty("--ff-appt-drawer-w", width + "px");
    document.body.classList.add("ff-appt-drawer-open");
    var gap = 16;
    var fabW = fab.offsetWidth || 62;
    if (leftEdge < gap + fabW) {
      fab.style.right = "auto";
      fab.style.left = "16px";
    } else {
      fab.style.left = "auto";
      fab.style.right = Math.round(window.innerWidth - leftEdge + gap) + "px";
    }
  }

  function restore() {
    var fab = document.querySelector(".ff-live-desk-fab");
    document.body.classList.remove("ff-appt-drawer-open");
    document.documentElement.style.removeProperty("--ff-appt-drawer-w");
    if (!fab || fab.dataset.ffApptSaved !== "1") return;
    fab.style.left = fab.dataset.ffApptLeft || "";
    fab.style.right = fab.dataset.ffApptRight || "";
    fab.style.top = fab.dataset.ffApptTop || "";
    fab.style.bottom = fab.dataset.ffApptBottom || "";
    delete fab.dataset.ffApptSaved;
    delete fab.dataset.ffApptLeft;
    delete fab.dataset.ffApptRight;
    delete fab.dataset.ffApptTop;
    delete fab.dataset.ffApptBottom;
  }

  window.ffBookingDrawerLive = {
    place: place,
    restore: restore
  };
})();
