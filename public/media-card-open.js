/**
 * Open the Work Details modal from a Media card click.
 * Capture-phase so the click never hits an <img> (that navigates / reloads the app).
 * Modal opens on the next tick so the same click cannot land on the overlay.
 */
(function () {
  function openWorkCard(id) {
    if (!id) return;
    window.setTimeout(function () {
      if (typeof window.openWorkDetails === "function") {
        window.openWorkDetails(id);
        return;
      }
      var modal = document.getElementById("workDetailsModal");
      var content = document.getElementById("workDetailsContent");
      if (!modal || !content) return;
      modal.style.display = "flex";
      var works = window.__ffMediaBootWorks || [];
      var work = null;
      for (var i = 0; i < works.length; i++) {
        if (works[i] && String(works[i].id) === String(id)) {
          work = works[i];
          break;
        }
      }
      content.textContent = "";
      var title = document.createElement("div");
      title.style.cssText = "font-size:13px;font-weight:600;margin-bottom:10px;color:#111;";
      title.textContent = work
        ? (Array.isArray(work.categoryNames) ? work.categoryNames.join(", ") : (work.categoryName || work.serviceType || "Work"))
        : "Media file";
      content.appendChild(title);
      if (work && work.staffName) {
        var by = document.createElement("div");
        by.style.cssText = "font-size:11px;color:#6b7280;";
        by.textContent = "By " + work.staffName;
        content.appendChild(by);
      }
    }, 0);
  }

  document.addEventListener(
    "click",
    function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      var card = t.closest("#mediaList .media-work-card");
      if (!card) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openWorkCard(card.getAttribute("data-work-id"));
    },
    true
  );
})();
