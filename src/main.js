"use strict";
(function () {
  // FAQ: each card toggles on its own, from the tab or anywhere outside the answer.
  // (The phone menu lives in an inline script in the shared header, so it works even if this file does not load.)
  document.querySelectorAll(".card").forEach(function (card) {
    var q = card.querySelector(".q"), a = card.querySelector(".a");
    var toggle = function (open) {
      card.classList.toggle("open", open);
      q.setAttribute("aria-expanded", open ? "true" : "false");
      a.hidden = !open;
    };
    toggle(card.classList.contains("open"));
    card.addEventListener("click", function (e) {
      if (a.contains(e.target)) return;
      toggle(!card.classList.contains("open"));
    });
  });
})();
