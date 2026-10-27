"use strict";
(function () {
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

  // Phone menu: the button shows only with JavaScript; without it the links stay visible (see .js in styles.css).
  var menuBtn = document.querySelector(".menu-btn"), menu = document.getElementById("menu");
  if (menuBtn && menu) {
    var setMenu = function (open) {
      menu.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menuBtn.hidden = false;
    menuBtn.addEventListener("click", function () { setMenu(!menu.classList.contains("open")); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("open")) { setMenu(false); menuBtn.focus(); }
    });
  }

  var form = document.getElementById("lead-form");
  if (form) leadForm(form);

  // Lead form (contact page). The build fills data-endpoint from owner.json leadsEndpoint:
  // - empty: the details open in WhatsApp, prefilled, and nothing is stored anywhere;
  // - an Apps Script /exec URL: POST with a text/plain body (a simple request, no CORS preflight),
  //   success only when the reply is exactly "ok"; anything else offers the same prefilled WhatsApp link.
  // The message has no field for the child's name.
  function leadForm(form) {
    var WA = "https://wa.me/972559897869?text=";
    var GRADE = { "ו": "ו׳", "ז": "ז׳", "ח": "ח׳", "ט": "ט׳", "אחרת": "אחרת" };
    var FIELD = { name: "f-name", phone: "f-phone", grade: "f-grade" };
    var MIN_MS = 2100; // the server ignores sends faster than 2 seconds
    var el = function (id) { return document.getElementById(id); };
    var endpoint = form.getAttribute("data-endpoint") || "";
    var shownAt = Date.now();
    var formId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : shownAt + "-" + Math.random().toString(36).slice(2);
    var status = el("f-status"), done = el("f-done"), submit = form.querySelector('button[type="submit"]');
    var busy = false;

    form.hidden = false;
    if (!endpoint) {
      submit.textContent = submit.getAttribute("data-label-wa");
      el("f-mode").hidden = false;
    }
    if (new URLSearchParams(location.search).get("role") === "teacher") form.elements.role.value = "teacher";
    applyRole();

    form.addEventListener("change", function (e) {
      if (e.target.name === "role") applyRole();
      if (e.target.name === "grade") clearErr("grade");
    });
    form.addEventListener("input", function (e) {
      if (e.target.name === "name" || e.target.name === "phone") clearErr(e.target.name);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      var d = read();
      if (!d) return;
      var link = WA + encodeURIComponent(message(d));
      if (form.elements.hp.value) { finish(d); return; } // a bot filled the trap: a quiet "success", nothing sent
      if (!endpoint) {
        window.open(link, "_blank", "noopener");
        say(status.dataset.waOpen, link, status.dataset.waLink);
        return;
      }
      send(d, link);
    });

    function role() { return form.elements.role.value === "teacher" ? "teacher" : "parent"; }

    function applyRole() {
      var r = role();
      form.querySelectorAll("[data-for]").forEach(function (x) { x.hidden = x.getAttribute("data-for") !== r; });
      el("f-note").setAttribute("aria-describedby", r === "teacher" ? "h-note-t" : "h-note");
      if (r === "teacher") clearErr("grade");
    }

    function setErr(key) {
      var msg = el("e-" + key);
      msg.textContent = msg.getAttribute("data-msg");
      msg.hidden = false;
      el(FIELD[key]).setAttribute("aria-invalid", "true");
    }

    function clearErr(key) {
      var msg = el("e-" + key);
      msg.textContent = "";
      msg.hidden = true;
      el(FIELD[key]).removeAttribute("aria-invalid");
    }

    // 050-123-4567, 0501234567, +972 50 123 4567, 00972501234567 and 972501234567 all become 0501234567.
    function phone(v) {
      var d = String(v).replace(/\D/g, "").replace(/^00/, "");
      if (d.indexOf("972") === 0) d = d.slice(3);
      if (d.charAt(0) !== "0") d = "0" + d;
      return /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(d) ? d : "";
    }

    function read() {
      var r = role();
      var d = {
        role: r,
        name: form.elements.name.value.replace(/\s+/g, " ").trim(),
        phone: phone(form.elements.phone.value),
        grade: r === "parent" ? form.elements.grade.value : "",
        contact: form.elements.contact.value === "call" ? "call" : "whatsapp",
        note: form.elements.note.value.trim().slice(0, 500),
      };
      var bad = [];
      if (d.name.length < 2 || d.name.length > 60 || !/[א-תa-zA-Z]/.test(d.name)) bad.push("name");
      if (!d.phone) bad.push("phone");
      if (r === "parent" && !Object.prototype.hasOwnProperty.call(GRADE, d.grade)) bad.push("grade");
      ["name", "phone", "grade"].forEach(function (k) { if (bad.indexOf(k) < 0) clearErr(k); else setErr(k); });
      if (!bad.length) return d;
      (bad[0] === "grade" ? form.querySelector("#f-grade input") : el(FIELD[bad[0]])).focus();
      return null;
    }

    function message(d) {
      var lines = [
        "היי, הגעתי מהאתר ואשמח שתחזרו אליי.",
        "פונה: " + (d.role === "teacher" ? "מורה למתמטיקה" : "הורה"),
        "שם: " + d.name,
        "טלפון: " + d.phone,
      ];
      if (d.role === "parent") lines.push("כיתה: " + GRADE[d.grade]);
      lines.push("נוח לי: " + (d.contact === "call" ? "שיחת טלפון" : "וואטסאפ"));
      if (d.note) lines.push("הערה: " + d.note);
      return lines.join("\n");
    }

    function say(text, link, label) {
      status.textContent = "";
      var p = document.createElement("p");
      p.textContent = text;
      status.appendChild(p);
      if (!link) return;
      var a = document.createElement("a");
      a.className = "tlink wa-fallback";
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;
      var sr = document.createElement("span");
      sr.className = "sr";
      sr.textContent = " (נפתח בוואטסאפ)";
      a.appendChild(sr);
      status.appendChild(a);
    }

    function finish(d) {
      done.querySelectorAll("[data-contact]").forEach(function (p) { p.hidden = p.getAttribute("data-contact") !== d.contact; });
      form.hidden = true;
      done.hidden = false;
      done.focus();
    }

    function send(d, link) {
      busy = true;
      submit.disabled = true;
      say(status.dataset.sending);
      setTimeout(function () {
        var ctrl = typeof AbortController === "function" ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
        var body = JSON.stringify({
          role: d.role, name: d.name, phone: d.phone, grade: d.grade, contact: d.contact, note: d.note,
          hp: "", t: Date.now() - shownAt, id: formId, page: location.pathname,
        });
        fetch(endpoint, { method: "POST", body: body, signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (text) {
            if (String(text).trim() === "ok") finish(d);
            else say(status.dataset.fail, link, status.dataset.failLink);
          })
          .catch(function () { say(status.dataset.fail, link, status.dataset.failLink); })
          .then(function () { clearTimeout(timer); busy = false; submit.disabled = false; });
      }, Math.max(0, MIN_MS - (Date.now() - shownAt)));
    }
  }
})();
