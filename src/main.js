"use strict";
(function () {
  var $ = function (id) { return document.getElementById(id); };

  // FAQ: each card toggles on its own, from the tab or anywhere outside the answer.
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

  // Phone bar: shown once the hero button is above the screen, hidden from the final section down.
  var bar = document.querySelector(".wa-bar"), heroBtn = document.querySelector(".hero .wa"), finalSec = $("start");
  if (bar && heroBtn && finalSec) {
    var queued = false, update = function () {
      queued = false;
      var finalOn = finalSec.getBoundingClientRect().top < innerHeight;
      bar.classList.toggle("show", heroBtn.getBoundingClientRect().bottom < 0 && !finalOn);
    };
    var queue = function () { if (!queued) { queued = true; requestAnimationFrame(update); } };
    addEventListener("scroll", queue, { passive: true }); addEventListener("resize", queue); update();
  }

})();
