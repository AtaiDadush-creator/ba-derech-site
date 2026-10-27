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

  // The phone menu lives in an inline script in the shared header, so it works even if this file does not load.

  var form = document.getElementById("lead-form");
  if (form) leadForm(form);

  // Lead form (contact page). The build fills data-endpoint from owner.json leadsEndpoint:
  // - empty: the details open in WhatsApp, prefilled, and nothing is stored anywhere;
  // - an Apps Script /exec URL: POST with a text/plain body (a simple request, no CORS preflight),
  //   success only when the reply is exactly "ok"; anything else offers the same prefilled WhatsApp link.
  // The client never drops a send on its own: the honeypot value and the time on the page travel to the server,
  // which files a suspected bot with the status "חשד" instead of losing a real lead.
  // The message has no field for the child's name.
  function leadForm(form) {
    var WA = "https://wa.me/972559897869?text=";
    var GRADE = { "ו": "ו׳", "ז": "ז׳", "ח": "ח׳", "ט": "ט׳", "אחרת": "אחרת" };
    var FIELD = { name: "f-name", phone: "f-phone", grade: "f-grade" };
    var MIN_MS = 2100; // the server files sends faster than 2 seconds as suspect
    var WA_HOLD_MS = 2000; // a second tap within this time does not open a second WhatsApp tab
    var el = function (id) { return document.getElementById(id); };
    // performance.now() does not jump when the device clock is synced.
    var now = function () { return window.performance && performance.now ? performance.now() : Date.now(); };
    var endpoint = form.getAttribute("data-endpoint") || "";
    var shownAt = now();
    var formId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2);
    var status = el("f-status"), done = el("f-done"), sum = el("f-sum"), submit = form.querySelector('button[type="submit"]');
    var busy = false, waHold = null, sumCount = 0;

    form.hidden = false;
    el("f-nojs").hidden = true;
    if (!endpoint) {
      submit.textContent = submit.getAttribute("data-label-wa");
      el("f-mode").hidden = false;
    }
    if (new URLSearchParams(location.search).get("role") === "teacher") form.elements.role.value = "teacher";
    applyRole();

    form.addEventListener("change", function (e) {
      release();
      if (e.target.name === "role") applyRole();
      if (e.target.name === "grade") clearErr("grade");
    });
    form.addEventListener("input", function (e) {
      release();
      if (e.target.name === "name" || e.target.name === "phone") clearErr(e.target.name);
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy || waHold) return;
      var d = read();
      if (!d) return;
      var link = WA + encodeURIComponent(message(d));
      if (!endpoint) {
        window.open(link, "_blank", "noopener");
        say(status.dataset.waOpen, link, status.dataset.waLink);
        waHold = setTimeout(release, WA_HOLD_MS);
        return;
      }
      send(d, link);
    });

    // Editing the form ends the WhatsApp double-tap hold: a changed form is a new send, not a second tap.
    function release() {
      if (!waHold) return;
      clearTimeout(waHold);
      waHold = null;
    }

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
      if (sumCount) summary(form.querySelectorAll('[aria-invalid="true"]').length, false);
    }

    // The line above the fields (role="alert"): how many fields need fixing. Emptied and refilled so it is read again.
    function summary(n, announce) {
      if (n === sumCount && !announce) return;
      sumCount = n;
      var text = !n ? "" : n === 1 ? sum.getAttribute("data-one") : sum.getAttribute("data-many").replace("{n}", n);
      sum.textContent = "";
      if (!text) return;
      if (announce) setTimeout(function () { if (sumCount === n) sum.textContent = text; }, 60);
      else sum.textContent = text;
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
      // Any script counts as a name (Hebrew, Arabic, Russian, English...).
      if (d.name.length < 2 || d.name.length > 60 || !/\p{L}/u.test(d.name)) bad.push("name");
      if (!d.phone) bad.push("phone");
      if (r === "parent" && !Object.prototype.hasOwnProperty.call(GRADE, d.grade)) bad.push("grade");
      ["name", "phone", "grade"].forEach(function (k) { if (bad.indexOf(k) < 0) clearErr(k); else setErr(k); });
      summary(bad.length, true);
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

    // While sending, the button says so with aria-disabled (it keeps keyboard focus) and the busy flag stops a second send.
    function send(d, link) {
      busy = true;
      submit.setAttribute("aria-disabled", "true");
      say(status.dataset.sending);
      setTimeout(function () {
        var ctrl = typeof AbortController === "function" ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
        var body = JSON.stringify({
          role: d.role, name: d.name, phone: d.phone, grade: d.grade, contact: d.contact, note: d.note,
          hp: form.elements.hp.value, t: Math.round(now() - shownAt), id: formId, page: location.pathname,
        });
        fetch(endpoint, { method: "POST", body: body, signal: ctrl ? ctrl.signal : undefined })
          .then(function (r) { return r.ok ? r.text() : ""; })
          .then(function (text) {
            if (String(text).trim() === "ok") finish(d);
            else say(status.dataset.fail, link, status.dataset.failLink);
          })
          .catch(function () { say(status.dataset.fail, link, status.dataset.failLink); })
          .then(function () { clearTimeout(timer); busy = false; submit.removeAttribute("aria-disabled"); });
      }, Math.max(0, MIN_MS - (now() - shownAt)));
    }
  }
})();
