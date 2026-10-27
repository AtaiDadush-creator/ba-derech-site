// QA extras: tests added after mutation testing of the form, the phone menu, the data blocks, prices and WhatsApp placement.
// Each block below closes a hole that a deliberate break of the site got past the other specs.
// Tests target structure (ids, roles, attributes, counts), not Hebrew sentences.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL, LEGAL, DIST, PHONE, WA_COUNT, SHARE_COUNT, builtHtml, scrollThrough, tabKey } from "./helpers.js";

const WA = `https://wa.me/${PHONE}?text=`;
const ENDPOINT = "https://script.google.com/macros/s/QA_EXTRA_ENDPOINT_0000000001/exec";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const HEB = "\\u0590-\\u05FF";

// ---------- form helpers ----------
const submit = (page) => page.locator('#lead-form button[type="submit"]').click();
const calls = (page) => page.evaluate(() => window.__calls);
const textOf = (url) => new URL(url).searchParams.get("text");
// The message is "label: value" lines under a greeting; tests read the values, not the labels.
const values = (url) => textOf(url).split("\n").slice(1).map((l) => l.split(": ").slice(1).join(": "));

async function openForm(page, query = "") {
  await page.goto(`/contact/${query}`);
  await expect(page.locator("#lead-form")).toBeVisible();
}

async function fillForm(page, { role = "parent", name = "דנה", phone = "050-123-4567", grade = "ח", contact = "whatsapp", note = "" } = {}) {
  await page.locator(`input[name="role"][value="${role}"]`).check();
  await page.fill("#f-name", name);
  await page.fill("#f-phone", phone);
  if (role === "parent" && grade) await page.locator(`input[name="grade"][value="${grade}"]`).check();
  await page.locator(`input[name="contact"][value="${contact}"]`).check();
  await page.fill("#f-note", note);
}

// A server mock: serves /contact/ with an endpoint in data-endpoint (as the build does once owner.json has one),
// records every request, and lets the test decide each reply.
async function withEndpoint(page, handler) {
  await page.route("**/contact/**", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('data-endpoint=""', `data-endpoint="${ENDPOINT}"`) });
  });
  const seen = [];
  await page.route(ENDPOINT, async (route) => {
    const r = route.request();
    seen.push({ at: Date.now(), method: r.method(), type: r.headers()["content-type"], body: JSON.parse(r.postData() || "null") });
    await handler(route, seen.length);
  });
  return seen;
}
const reply = (body, status = 200) => (route) =>
  route.fulfill({ status, body, headers: { "content-type": "text/plain", "access-control-allow-origin": "*" } });

// ======================================================================
// Form: WhatsApp mode
// ======================================================================
test.describe("form, WhatsApp mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.__calls = []; window.open = (...a) => { window.__calls.push(a.map(String)); return null; }; });
  });

  test("the link opens in a new tab without giving the new page access to this one", async ({ page }) => {
    await openForm(page);
    await fillForm(page);
    await submit(page);
    const [[url, target, features]] = await calls(page);
    expect(url.startsWith(WA)).toBe(true);
    expect(target).toBe("_blank");
    expect(features).toMatch(/noopener/);
    const link = page.locator("#f-status a.wa-fallback");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  });

  test("the message survives characters that break a URL: & # ? % + quotes and a line break in the note", async ({ page }) => {
    const note = 'קשה & מסובך #1? 50% +3 "ציטוט"\nשורה שנייה';
    await openForm(page);
    await fillForm(page, { note });
    await submit(page);
    const [[url]] = await calls(page);
    const u = new URL(url);
    expect([...u.searchParams.keys()]).toEqual(["text"]);
    expect(u.hash).toBe("");
    expect(/\s/.test(url), "no raw whitespace in the URL").toBe(false);
    expect(textOf(url).endsWith(`: ${note}`)).toBe(true);
    expect(values(url)).toContain("דנה");
    expect(values(url)).toContain("0501234567");
  });

  const ACCEPTED = [
    ["050-123-4567", "0501234567"], ["0501234567", "0501234567"], ["+972 50 123 4567", "0501234567"], ["00972501234567", "0501234567"],
    ["972501234567", "0501234567"], ["501234567", "0501234567"], ["(050) 123 4567", "0501234567"], ["03-1234567", "031234567"],
    ["077-1234567", "0771234567"], ["02 6123456", "026123456"], ["  050 123 4567  ", "0501234567"], ["0541234567", "0541234567"],
  ];
  test("every accepted phone format is sent as a plain Israeli number", async ({ page }) => {
    await openForm(page);
    await fillForm(page);
    let n = 0;
    for (const [typed, sent] of ACCEPTED) {
      await page.fill("#f-phone", typed);
      await submit(page);
      const all = await calls(page);
      expect(all, `"${typed}" is accepted`).toHaveLength(++n);
      expect(values(all[n - 1][0]), `"${typed}" is sent as ${sent}`).toContain(sent);
    }
  });

  const REJECTED = ["1230501234567", "05012345678", "0501234567890", "+1 650 555 0123", "050-123-456", "1234567", "0 5", "abc", "", "+972 6 123 4567", "0701234", "0001234567", "050123456 7 8"];
  test("rejected phone formats show the error, keep focus on the phone, and open nothing", async ({ page }) => {
    await openForm(page);
    await fillForm(page);
    for (const bad of REJECTED) {
      await page.fill("#f-phone", bad);
      await submit(page);
      await expect(page.locator("#e-phone"), `"${bad}"`).toBeVisible();
      await expect(page.locator("#f-phone")).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator("#f-phone")).toBeFocused();
    }
    expect(await calls(page)).toEqual([]);
  });

  test("the phone error clears while typing a better number", async ({ page }) => {
    await openForm(page);
    await fillForm(page, { phone: "12" });
    await submit(page);
    await expect(page.locator("#e-phone")).toBeVisible();
    await page.locator("#f-phone").pressSequentially("3");
    await expect(page.locator("#e-phone")).toBeHidden();
    await expect(page.locator("#f-phone")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("name rules: two letters in, one letter, digits, punctuation and blanks out; spaces squeezed; 60 characters at most", async ({ page }) => {
    await openForm(page);
    await fillForm(page);
    let n = 0;
    for (const ok of ["דנ", "Dana", "דנה2", "  דנה    כהן  ", "א".repeat(60)]) {
      await page.fill("#f-name", ok);
      await submit(page);
      const all = await calls(page);
      expect(all, `name "${ok}" is accepted`).toHaveLength(++n);
      expect(values(all[n - 1][0]), "the name is trimmed and its spaces squeezed").toContain(ok.replace(/\s+/g, " ").trim());
    }
    for (const bad of ["א", "  ", "123", "!!", "?"]) {
      await page.fill("#f-name", bad);
      await submit(page);
      await expect(page.locator("#e-name"), `name "${bad}"`).toBeVisible();
      await expect(page.locator("#f-name")).toBeFocused();
    }
    await page.fill("#f-name", "דנה");
    await page.locator("#f-name").evaluate((el) => { el.value = "א".repeat(61); });
    await submit(page);
    await expect(page.locator("#e-name"), "61 characters").toBeVisible();
    expect(await calls(page)).toHaveLength(n);
  });

  test("each grade is sent as its own label; the grade error points at the first radio and clears on choosing", async ({ page }) => {
    await openForm(page);
    const sent = [];
    await fillForm(page);
    for (const g of ["ו", "ז", "ח", "ט", "אחרת"]) {
      await page.locator(`input[name="grade"][value="${g}"]`).check();
      await submit(page);
      const all = await calls(page);
      sent.push(values(all[all.length - 1][0])[3]);
    }
    expect(sent).toEqual(["ו׳", "ז׳", "ח׳", "ט׳", "אחרת"]);

    await page.reload();
    await expect(page.locator("#lead-form")).toBeVisible();
    await fillForm(page, { grade: null });
    await submit(page);
    await expect(page.locator("#e-grade")).toBeVisible();
    await expect(page.locator("#f-grade")).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('#f-grade input[name="grade"]').first()).toBeFocused();
    await page.locator('input[name="grade"][value="ט"]').check();
    await expect(page.locator("#e-grade")).toBeHidden();
    await expect(page.locator("#f-grade")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("the note is trimmed and cut at 500 characters", async ({ page }) => {
    await openForm(page);
    await fillForm(page, { note: "  הערה קצרה  " });
    await submit(page);
    expect(textOf((await calls(page))[0][0]).endsWith(": הערה קצרה")).toBe(true);
    await fillForm(page);
    await page.locator("#f-note").evaluate((el) => { el.value = "ב".repeat(700); });
    await submit(page);
    const last = (await calls(page)).at(-1)[0];
    expect(values(last).at(-1)).toBe("ב".repeat(500));
  });

  test("honeypot in WhatsApp mode: a filled trap opens nothing and shows the thank-you", async ({ page }) => {
    await openForm(page);
    await fillForm(page);
    await page.locator("#f-hp").evaluate((el) => { el.value = "spam"; });
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible();
    expect(await calls(page)).toEqual([]);
  });

  test("the thank-you shows only the line of the chosen channel", async ({ page }) => {
    await openForm(page);
    await fillForm(page, { contact: "call" });
    await page.locator("#f-hp").evaluate((el) => { el.value = "spam"; });
    await submit(page);
    await expect(page.locator('#f-done [data-contact="call"]')).toBeVisible();
    await expect(page.locator('#f-done [data-contact="whatsapp"]')).toBeHidden();
  });
});

// ======================================================================
// Form layout: no state of the form pushes the page sideways or past the screen edge
// ======================================================================
test.describe("form layout in every state", () => {
  const edge = (page) => page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    return [...document.querySelectorAll("#lead *")].filter((el) => {
      if (el.closest(".f-hp, .sr") || el.closest("[hidden]")) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.left < -1 || r.right > W + 1);
    }).map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${el.className}`);
  });
  const check = async (page, label) => {
    const worst = await scrollThrough(page);
    expect(worst.overflow, `${label}: sideways scroll at y=${worst.y}`).toBeLessThanOrEqual(0);
    expect(await edge(page), `${label}: elements past the screen edge`).toEqual([]);
  };

  test("errors, the WhatsApp status line and the thank-you", async ({ page }) => {
    await page.addInitScript(() => { window.__calls = []; window.open = (...a) => { window.__calls.push(a.map(String)); return null; }; });
    await openForm(page);
    await check(page, "before anything");
    await submit(page);
    await expect(page.locator("#e-name")).toBeVisible();
    await check(page, "all three errors");
    await fillForm(page, { name: "ש".repeat(60), note: "ב".repeat(500) });
    await submit(page);
    await expect(page.locator("#f-status a.wa-fallback")).toBeVisible();
    await check(page, "WhatsApp status line and link");
    await page.locator("#f-hp").evaluate((el) => { el.value = "x"; });
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible();
    await check(page, "thank-you");
  });

  test("the failure message with its WhatsApp link", async ({ page }) => {
    await withEndpoint(page, reply("nope"));
    await openForm(page);
    await fillForm(page, { name: "ש".repeat(60), note: "ב".repeat(500) });
    await submit(page);
    await expect(page.locator("#f-status a.wa-fallback")).toBeVisible({ timeout: 8000 });
    await check(page, "failure link");
  });
});

// ======================================================================
// Form: the honeypot is invisible to people and to the keyboard, but not hidden from the DOM
// ======================================================================
test.describe("honeypot structure", () => {
  test("labelled, off the tab order, no autofill, not aria-hidden, no visible area", async ({ page, browserName }) => {
    await openForm(page);
    const hp = page.locator("#f-hp");
    await expect(hp).toHaveAttribute("tabindex", "-1");
    await expect(hp).toHaveAttribute("autocomplete", "off");
    await expect(page.locator('label[for="f-hp"]')).toHaveCount(1);
    expect(await hp.evaluate((el) => Boolean(el.closest('[aria-hidden="true"]')))).toBe(false);
    // The input keeps its natural size; its wrapper is a 1px clipped box, so nothing of it shows.
    const wrap = await hp.evaluate((el) => {
      const w = el.closest(".f-hp"), r = w.getBoundingClientRect(), cs = getComputedStyle(w);
      return { w: r.width, h: r.height, clipped: cs.overflow !== "visible" || cs.clipPath !== "none", display: cs.display };
    });
    expect(wrap.w <= 2 && wrap.h <= 2, `the trap wrapper takes ${wrap.w}x${wrap.h}px`).toBe(true);
    expect(wrap.clipped, "the wrapper clips the field").toBe(true);

    // Walk the form with the keyboard: the trap is never reached, the submit button is.
    await page.locator("#f-name").focus();
    const seen = [];
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press(tabKey(browserName));
      seen.push(await page.evaluate(() => `${document.activeElement.id || document.activeElement.name || document.activeElement.type}`));
    }
    expect(seen).not.toContain("f-hp");
    expect(seen).toContain("submit");
  });
});

// ======================================================================
// Form: role
// ======================================================================
test.describe("form, role", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.__calls = []; window.open = (...a) => { window.__calls.push(a.map(String)); return null; }; });
  });

  for (const q of ["?role=bogus", "?role=Teacher", "?role=", "?role=parent", "?teacher=1"]) {
    test(`${q}: stays on parent, the grade question shows`, async ({ page }) => {
      await openForm(page, q);
      await expect(page.locator('input[name="role"][value="parent"]')).toBeChecked();
      await expect(page.locator("#f-grade")).toBeVisible();
    });
  }

  test("choosing a role by clicking swaps the grade question and the note hint, both ways", async ({ page }) => {
    await openForm(page);
    await expect(page.locator("#f-grade")).toBeVisible();
    await expect(page.locator("#h-note")).toBeVisible();
    await expect(page.locator("#h-note-t")).toBeHidden();
    await expect(page.locator("#f-note")).toHaveAttribute("aria-describedby", "h-note");
    await page.locator('input[name="role"][value="teacher"]').check();
    await expect(page.locator("#f-grade")).toBeHidden();
    await expect(page.locator("#h-note")).toBeHidden();
    await expect(page.locator("#h-note-t")).toBeVisible();
    await expect(page.locator("#f-note")).toHaveAttribute("aria-describedby", "h-note-t");
    await page.locator('input[name="role"][value="parent"]').check();
    await expect(page.locator("#f-grade")).toBeVisible();
    await expect(page.locator("#h-note")).toBeVisible();
    await expect(page.locator("#h-note-t")).toBeHidden();
    await expect(page.locator("#f-note")).toHaveAttribute("aria-describedby", "h-note");
  });

  test("switching to teacher drops a grade chosen earlier and a stale grade error", async ({ page }) => {
    await openForm(page);
    await fillForm(page, { grade: null });
    await submit(page);
    await expect(page.locator("#e-grade")).toBeVisible();
    await page.locator('input[name="grade"][value="ח"]').check();
    await page.locator('input[name="role"][value="teacher"]').check();
    await submit(page);
    const [[url]] = await calls(page);
    expect(values(url), "no grade in a teacher's message").not.toContain("ח׳");
    expect(textOf(url).split("\n")).toHaveLength(5);

    await page.reload();
    await expect(page.locator("#lead-form")).toBeVisible();
    await fillForm(page, { grade: null });
    await submit(page);
    await expect(page.locator("#f-grade")).toHaveAttribute("aria-invalid", "true");
    await page.locator('input[name="role"][value="teacher"]').check();
    await expect(page.locator("#e-grade")).toBeHidden();
    await expect(page.locator("#f-grade")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("the teacher links on the site land on the form with teacher preselected", async ({ page }) => {
    for (const from of ["/", "/teach/"]) {
      await page.goto(from);
      const link = page.locator('main a[href*="role=teacher"], footer a[href*="role=teacher"]').last();
      expect(await page.locator('a[href*="role=teacher"]').count(), `${from} has a teacher link`).toBeGreaterThan(0);
      await link.click();
      await expect(page).toHaveURL(/\/contact\/\?role=teacher#lead$/);
      await expect(page.locator('input[name="role"][value="teacher"]')).toBeChecked();
      await expect(page.locator("#f-grade")).toBeHidden();
    }
    // The teach page keeps its own call to action in the content, not only the footer.
    await page.goto("/teach/");
    expect(await page.locator('main a[href*="role=teacher"]').count()).toBeGreaterThan(0);
  });
});

// ======================================================================
// Form: Apps Script mode
// ======================================================================
test.describe("form, endpoint mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { window.__calls = []; window.open = (...a) => { window.__calls.push(a.map(String)); return null; }; });
  });

  // Only the exact text "ok" is a success. Everything else is a failure and offers the prefilled WhatsApp link.
  for (const [name, body] of [["not ok", "not ok"], ["OK", "OK"], ["okay", "okay"], ["a JSON object", '{"ok":true}'], ["an empty reply", ""], ["ok followed by text", "ok: but full"], ["the word error", "error"]]) {
    test(`a ${name} reply is a failure, not a thank-you`, async ({ page }) => {
      const seen = await withEndpoint(page, reply(body));
      await openForm(page);
      await fillForm(page);
      await submit(page);
      await expect(page.locator("#f-status a.wa-fallback")).toBeVisible({ timeout: 8000 });
      await expect(page.locator("#f-done")).toBeHidden();
      await expect(page.locator("#lead-form")).toBeVisible();
      expect(seen).toHaveLength(1);
    });
  }

  test("honeypot in endpoint mode: nothing is sent even after the 2 second wait has passed", async ({ page }) => {
    const seen = await withEndpoint(page, reply("ok"));
    await openForm(page);
    await fillForm(page);
    await page.locator("#f-hp").evaluate((el) => { el.value = "spam"; });
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible();
    await page.waitForTimeout(2800); // a delayed send would fire at 2.1 seconds
    expect(seen).toHaveLength(0);
    expect(await calls(page)).toEqual([]);
  });

  test("a request that never answers is given up after 15 seconds, with the WhatsApp link and a working button", async ({ page }) => {
    await page.clock.install();
    const seen = await withEndpoint(page, () => new Promise(() => {})); // never replies
    await openForm(page);
    await fillForm(page);
    await submit(page);
    await page.clock.fastForward(2300);
    await expect.poll(() => seen.length, { timeout: 8000 }).toBe(1);
    await expect(page.locator('#lead-form button[type="submit"]')).toBeDisabled();
    await page.clock.fastForward(16000);
    await expect(page.locator("#f-status a.wa-fallback")).toBeVisible();
    await expect(page.locator('#lead-form button[type="submit"]')).toBeEnabled();
    await expect(page.locator("#f-done")).toBeHidden();
  });

  test("while sending: the button is locked, a status shows, a second submit sends nothing, no early thank-you", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const seen = await withEndpoint(page, async (route) => { await gate; await reply("ok")(route); });
    await openForm(page);
    await fillForm(page);
    await submit(page);
    await expect.poll(() => seen.length, { timeout: 8000 }).toBe(1);
    await expect(page.locator('#lead-form button[type="submit"]')).toBeDisabled();
    await expect(page.locator("#f-status p")).not.toHaveText("");
    await page.evaluate(() => { const f = document.getElementById("lead-form"); f.requestSubmit(); f.requestSubmit(); });
    await page.waitForTimeout(500);
    expect(seen, "requests while the first is pending").toHaveLength(1);
    await expect(page.locator("#f-done")).toBeHidden();
    release();
    await expect(page.locator("#f-done")).toBeVisible();
    expect(seen).toHaveLength(1);
  });

  test("the sending time is honest and short: t is the time since the form was shown, and the wait stays near 2 seconds", async ({ page }) => {
    const t0 = Date.now();
    const seen = await withEndpoint(page, reply("ok"));
    await openForm(page);
    await fillForm(page);
    const clicked = Date.now();
    await submit(page);
    await expect.poll(() => seen.length, { timeout: 8000 }).toBe(1);
    const { at, body } = seen[0];
    expect(body.t, "t is at least the 2 second trap").toBeGreaterThanOrEqual(2000);
    expect(body.t, "t cannot exceed the real time since the page began loading").toBeLessThanOrEqual(at - t0 + 50);
    expect(body.t, "the form does not make a quick visitor wait much longer than 2 seconds").toBeLessThan(4500);
    expect(at - clicked, "click to request").toBeLessThan(3000);
  });

  test("a retry after a failure reuses the form id; a new page load gets a new one; the id is not trivial", async ({ page }) => {
    const seen = await withEndpoint(page, (route, n) => reply(n === 1 ? "nope" : "ok")(route));
    await openForm(page);
    await fillForm(page);
    await submit(page);
    await expect(page.locator("#f-status a.wa-fallback")).toBeVisible({ timeout: 8000 });
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible({ timeout: 8000 });
    expect(seen).toHaveLength(2);
    expect(typeof seen[0].body.id).toBe("string");
    expect(seen[0].body.id.length).toBeGreaterThanOrEqual(8);
    expect(seen[1].body.id).toBe(seen[0].body.id);
    expect(seen[1].body.t).toBeGreaterThan(seen[0].body.t);

    await page.reload();
    await expect(page.locator("#lead-form")).toBeVisible();
    await fillForm(page);
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible({ timeout: 8000 });
    expect(seen[2].body.id).not.toBe(seen[0].body.id);
  });

  test("a teacher who prefers a call: role, empty grade, contact and note travel in the body; the thank-you shows the call line", async ({ page }) => {
    const seen = await withEndpoint(page, reply("ok"));
    await openForm(page);
    await fillForm(page, { grade: "ט" });
    await page.locator('input[name="grade"][value="ט"]').check();
    await fillForm(page, { role: "teacher", name: "רון כהן", phone: "+972 54 123 4567", contact: "call", note: "לימדתי ז׳ וח׳ & ט׳" });
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible({ timeout: 8000 });
    expect(seen[0].body).toMatchObject({ role: "teacher", name: "רון כהן", phone: "0541234567", grade: "", contact: "call", note: "לימדתי ז׳ וח׳ & ט׳", hp: "" });
    await expect(page.locator('#f-done [data-contact="call"]')).toBeVisible();
    await expect(page.locator('#f-done [data-contact="whatsapp"]')).toBeHidden();
    expect(await calls(page)).toEqual([]);
  });
});

// ======================================================================
// Phone menu
// ======================================================================
test.describe("phone menu", () => {
  test("every page: the button controls the real menu, toggles both ways, closed links cannot take focus, a link navigates", async ({ page }) => {
    test.skip(page.viewportSize().width > 860, "phone widths only");
    for (const path of ALL) {
      await page.goto(path);
      const btn = page.locator(".menu-btn"), menu = page.locator("#menu");
      await expect(btn, path).toBeVisible();
      const id = await btn.getAttribute("aria-controls");
      expect(await page.evaluate((i) => document.getElementById(i) === document.querySelector("#menu"), id), `${path}: aria-controls names the menu`).toBe(true);
      const canFocus = () => page.locator("#menu a").evaluateAll((as) => as.map((a) => { a.focus(); return document.activeElement === a; }));
      expect((await canFocus()).some(Boolean), `${path}: a closed menu keeps its links out of reach`).toBe(false);
      await btn.click();
      await expect(menu, path).toBeVisible();
      expect((await canFocus()).every(Boolean), `${path}: an open menu links can take focus`).toBe(true);
      await btn.click();
      await expect(menu, `${path}: second click closes`).toBeHidden();
      await expect(btn).toHaveAttribute("aria-expanded", "false");
    }
    // Escape from inside the open menu (focus on a link, not on the button) closes it and puts focus back on the button.
    await page.goto("/");
    await page.locator(".menu-btn").click();
    await page.locator("#menu a").first().focus();
    await expect(page.locator("#menu a").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator(".menu-btn")).toBeFocused();
    await page.locator(".menu-btn").click();
    await page.locator('#menu a[href$="teachers/"]').click();
    await expect(page).toHaveURL(/\/teachers\/$/);
    await expect(page.locator("#menu")).toBeHidden();
  });

  test("the breakpoint: 860px shows the button and hides the links, 861px the other way", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "one project is enough for a CSS breakpoint");
    await page.goto("/method/");
    for (const [w, phone] of [[860, true], [861, false], [1440, false], [375, true]]) {
      await page.setViewportSize({ width: w, height: 900 });
      if (phone) { await expect(page.locator(".menu-btn"), `${w}px`).toBeVisible(); await expect(page.locator("#menu"), `${w}px`).toBeHidden(); }
      else { await expect(page.locator(".menu-btn"), `${w}px`).toBeHidden(); await expect(page.locator("#menu"), `${w}px`).toBeVisible(); }
    }
  });

  for (const colorScheme of ["light", "dark"]) {
    test(`axe with the menu open (${colorScheme})`, async ({ page }) => {
      test.skip(page.viewportSize().width > 860, "phone widths only");
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const path of ["/", "/contact/"]) {
        await page.goto(path);
        await page.locator(".menu-btn").click();
        await expect(page.locator("#menu")).toBeVisible();
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${path} ${colorScheme}`).toEqual([]);
      }
    });
  }
});

// ======================================================================
// Axe: the scheme it scanned is the scheme the visitor gets
// ======================================================================
test.describe("colour schemes are really applied", () => {
  const luminance = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const path of ALL) {
    test(`${path}: light is light, dark is dark, and neither is forced by the page`, async ({ page }) => {
      for (const [scheme, test_] of [["light", (l) => l > 0.8], ["dark", (l) => l < 0.1]]) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(path);
        const rgb = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
        const ink = await page.evaluate(() => getComputedStyle(document.body).color.match(/\d+/g).slice(0, 3).map(Number));
        expect(test_(luminance(rgb)), `${path} ${scheme}: background ${rgb}`).toBe(true);
        expect(Math.abs(luminance(rgb) - luminance(ink)), `${path} ${scheme}: text against background`).toBeGreaterThan(0.5);
        expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "no theme forced in the markup").toBeNull();
      }
    });
  }
});

// ======================================================================
// Structure that axe reports only as "needs review" or as a best practice
// ======================================================================
test.describe("structure on every page", () => {
  for (const path of ALL) {
    test(`${path}: ARIA references point at real elements; headings, links, buttons and fields have text or a name; one main`, async ({ page }) => {
      await page.goto(path);
      const info = await page.evaluate(() => {
        const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
        const refs = [];
        for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "for"]) {
          for (const e of document.querySelectorAll(`[${attr}]`)) for (const id of e.getAttribute(attr).split(/\s+/).filter(Boolean)) if (!ids.has(id)) refs.push(`${e.tagName.toLowerCase()}[${attr}=${id}]`);
        }
        const text = (e) => (e.textContent || "").replace(/\s+/g, "").length > 0;
        const named = (e) => text(e) || e.getAttribute("aria-label") || [...e.querySelectorAll("img[alt]")].some((i) => i.alt.trim());
        const label = (e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""}`;
        return {
          refs,
          emptyHeadings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => !text(h)).map(label),
          unnamedLinks: [...document.querySelectorAll("a[href]")].filter((a) => !named(a)).map(label),
          unnamedButtons: [...document.querySelectorAll("button")].filter((b) => !named(b)).map(label),
          noAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.getAttribute("src")),
          unlabelled: [...document.querySelectorAll("input:not([type=hidden]), textarea, select")].filter((c) => !(c.labels && c.labels.length) && !c.getAttribute("aria-label") && !c.getAttribute("aria-labelledby")).map(label),
          main: document.querySelectorAll("main, [role=main]").length,
          h1: document.querySelectorAll("h1").length,
        };
      });
      expect(info.refs, "ids that aria-*, for or aria-controls name but the page does not have").toEqual([]);
      expect(info.emptyHeadings, "empty headings").toEqual([]);
      expect(info.unnamedLinks, "links with no text and no name").toEqual([]);
      expect(info.unnamedButtons, "buttons with no text and no name").toEqual([]);
      expect(info.noAlt, "images with no alt attribute").toEqual([]);
      expect(info.unlabelled, "fields with no label").toEqual([]);
      expect(info.main).toBe(1);
      expect(info.h1).toBe(1);
    });
  }
});

// ======================================================================
// Prices and "free" claims: the wider net
// ======================================================================
const WIDE = {
  "שקל or שקלים": new RegExp(`(?<![${HEB}])שקל(?:ים)?(?![${HEB}])`),
  "another currency": new RegExp(`[$€£]|(?<![${HEB}])(?:דולר|דולרים|יורו|אירו)(?![${HEB}])|\\b(?:USD|EUR|GBP)\\b`),
  "free (חינם, בחינם, free)": new RegExp(`(?<![${HEB}])ב?חינם(?![${HEB}])|\\bfree\\b`, "i"),
  "an amount per period": new RegExp(`\\d[\\d,.]*\\s*(?:ל|ב)(?:חודש|שיעור|שעה|שנה|שבוע)(?![${HEB}])`),
  // The words may carry a one-letter prefix (המחיר, ובעלות); "שעולה" (an arrow that rises) is not a price.
  "a price word followed by a number": new RegExp(`(?<![${HEB}])(?:[הבלוכמ]?(?:מחיר(?:ים)?|עלות)|עולה|עולים)(?![${HEB}])[^.\\n<]{0,15}\\d`),
};
const wideHits = (text) => Object.entries(WIDE).flatMap(([name, re]) => { const m = text.match(re); return m ? [`${name}: "...${text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)}..."`] : []; });
const builtOf = (path) => builtHtml().find((f) => f.file === `${path.slice(1)}index.html`).html;

test.describe("no prices and no free claims, wider net", () => {
  for (const path of ALL) {
    test(`${path}: text, attributes and source carry no other currency, price word, per-period amount or free claim`, async ({ page }) => {
      await page.goto(path);
      const { rendered, content, attrs } = await page.evaluate(() => ({
        rendered: document.body.innerText,
        content: document.body.textContent,
        attrs: [...document.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => !["href", "src", "class", "id", "style", "d", "viewBox", "type", "rel", "target"].includes(a.name) && !a.name.startsWith("data-for") && !a.name.startsWith("aria-controls")).map((a) => a.value)).join("\n"),
      }));
      for (const [where, text] of Object.entries({ innerText: rendered, textContent: content, attributes: attrs })) expect(wideHits(text), `${path} ${where}`).toEqual([]);
      expect(wideHits(builtOf(path)), `${path} built HTML`).toEqual([]);
    });
  }
});

// ======================================================================
// WhatsApp: only the allowed links, nothing floating, no stray phone number
// ======================================================================
test.describe("WhatsApp placement, wider net", () => {
  for (const path of ALL) {
    test(`${path}: every WhatsApp, share or tel link is an a.wa or a.share; nothing is fixed to the screen; the number only in a.wa and the legal line`, async ({ page }) => {
      await page.goto(path);
      // The legal pages may print the number in their text (it is the contact detail); every other page only in the footer's legal line.
      const textMayHoldNumber = LEGAL.includes(path);
      const info = await page.evaluate(([phone, textOk]) => {
        const describe = (a) => a.outerHTML.slice(0, 90);
        const chat = [...document.querySelectorAll("a[href]")].filter((a) => /wa\.me|whatsapp|^tel:|^sms:|^callto:/i.test(a.getAttribute("href")));
        const strays = chat.filter((a) => !a.classList.contains("wa") && !a.classList.contains("share")).map(describe);
        const tel = chat.filter((a) => /^(tel|sms|callto):/i.test(a.getAttribute("href"))).map(describe);
        const floating = chat.filter((a) => { for (let e = a; e && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).position === "fixed") return true; return getComputedStyle(a).position === "sticky"; }).map(describe);
        const tail = phone.slice(3);
        const norm = (s) => String(s).replace(/[\s\-().+]/g, "");
        const leaks = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeType === 3) { if (!textOk && norm(n.nodeValue).includes(tail) && !n.parentElement.closest(".foot-legal")) leaks.push(`text: ${n.nodeValue.trim().slice(0, 60)}`); continue; }
          if (n.closest(".foot-legal")) continue;
          for (const a of n.attributes) {
            if (n.matches("a.wa") && (a.name === "href" || a.name === "data-wa")) continue;
            let v = a.value;
            try { v = decodeURIComponent(v); } catch { /* a lone % in a style value */ }
            if (norm(v).includes(tail)) leaks.push(`${n.tagName.toLowerCase()}[${a.name}]: ${a.value.slice(0, 60)}`);
          }
        }
        return { strays, tel, floating, leaks, wa: document.querySelectorAll("a.wa").length, share: document.querySelectorAll("a.share").length };
      }, [PHONE, textMayHoldNumber]);
      expect(info.strays, "WhatsApp or phone links that are neither a.wa nor a.share").toEqual([]);
      expect(info.tel, "tel, sms or callto links").toEqual([]);
      expect(info.floating, "WhatsApp links fixed or stuck to the screen").toEqual([]);
      expect(info.leaks, "our number outside a.wa and the legal line").toEqual([]);
      expect(info.wa).toBe(WA_COUNT[path] ?? 2);
      expect(info.share).toBe(SHARE_COUNT[path] ?? 0);
    });
  }
});

// ======================================================================
// Build: data blocks, labels, validation (desktop only: these run the build script)
// ======================================================================
const parent = (n, extra = {}) => ({ ref: `T0${n}`, audience: "parent", quote: `טקסט בדיקה ${n}: הילד מגיע לשיעור בשמחה, ושואל יותר בכיתה.`, who: "אמא של תלמיד בכיתה ח׳", date: "2026-09", source: "whatsapp", consent: true, rewarded: false, ...extra });
const tquote = (n, extra = {}) => ({ ...parent(n), ref: `T1${n}`, audience: "teacher", who: "מורה בבדרך הנכונה", ...extra });
const teacher = (n, extra = {}) => ({ ref: `M0${n}`, name: ["דנה", "רון", "מיכל", "יעל"][n - 1], role: "מורה למתמטיקה", grades: ["ז", "ח", "ט"], line: `טקסט בדיקה ${n}: אוהבת לראות ילד שמבין סוף סוף שברים.`, consent: true, ...extra });
const some = (f, n) => Array.from({ length: n }, (_, i) => f(i + 1));
const PAGES = ["index.html", "method/index.html", "teachers/index.html", "faq/index.html", "teach/index.html", "contact/index.html", "terms/index.html", "privacy/index.html", "accessibility/index.html"];

// raw: { t, m } as verbatim file text, null to leave the file out; otherwise t and m are item lists.
function build({ t = [], m = [], raw = {}, cwd = process.cwd(), photoFiles = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bdnh-qa-"));
  const data = join(dir, "data"), out = join(dir, "dist");
  mkdirSync(data);
  if (raw.t !== null) writeFileSync(join(data, "testimonials.json"), raw.t ?? JSON.stringify({ items: t }));
  if (raw.m !== null) writeFileSync(join(data, "teachers.json"), raw.m ?? JSON.stringify({ items: m }));
  let run = cwd;
  if (photoFiles.length) {
    // The build looks for photos in ./src/assets/img/teachers, so give it a private copy of the site.
    run = join(dir, "site");
    cpSync(join(cwd, "src"), join(run, "src"), { recursive: true });
    cpSync(join(cwd, "scripts"), join(run, "scripts"), { recursive: true });
    mkdirSync(join(run, "src/assets/img/teachers"), { recursive: true });
    for (const f of photoFiles) writeFileSync(join(run, "src/assets/img/teachers", f), Buffer.from("not really a photo"));
  }
  const r = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: run, env: { ...process.env, SITE_DATA: data, SITE_DIST: out }, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, log: `${r.stdout}\n${r.stderr}`, out, read: (p) => readFileSync(join(out, p), "utf8"), has: (p) => existsSync(join(out, p)) };
}

test.describe("data blocks and build checks", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-chromium", "build checks run once"));

  test("each block has its own threshold of 3: 2 parent quotes and 2 cards stay hidden while 3 teacher quotes show", () => {
    const b = build({ t: [...some(parent, 2), ...some(tquote, 3)], m: some(teacher, 2) });
    expect(b.code, b.log).toBe(0);
    expect(b.read("index.html")).not.toContain('id="voices"');
    expect(b.read("teachers/index.html")).not.toContain('id="team"');
    expect(b.read("teach/index.html").match(/class="voice rv"/g)).toHaveLength(3);
    for (const p of PAGES) expect(b.read(p), `${p}: a link to the parent quotes that are not shown`).not.toContain("#voices");
    expect(b.has("testimonials.json")).toBe(false);
  });

  test("3 parent quotes and 3 cards show, 2 teacher quotes do not; the footer link is on every page", () => {
    const b = build({ t: [...some(parent, 3), ...some(tquote, 2)], m: some(teacher, 3) });
    expect(b.code, b.log).toBe(0);
    expect(b.read("index.html").match(/class="voice rv"/g)).toHaveLength(3);
    expect(b.read("teachers/index.html").match(/class="tcard rv"/g)).toHaveLength(3);
    expect(b.read("teach/index.html")).not.toContain('id="voices"');
    for (const p of PAGES) expect(b.read(p), `${p}: footer link to the quotes`).toMatch(/href="(?:\.\.\/)*(?:\.\/)?#voices"/);
  });

  test("only teacher quotes, only cards: the other blocks and the footer link stay out", () => {
    const b = build({ t: some(tquote, 3) });
    expect(b.code, b.log).toBe(0);
    expect(b.read("index.html")).not.toContain('id="voices"');
    expect(b.read("teach/index.html")).toContain('id="voices"');
    for (const p of PAGES) expect(b.read(p), p).not.toContain("#voices");
    const c = build({ m: some(teacher, 3) });
    expect(c.code, c.log).toBe(0);
    expect(c.read("teachers/index.html")).toContain('id="team"');
    expect(c.read("index.html")).not.toContain('id="voices"');
  });

  test("labels: months, sources, reward note, escaping, grade ranges and the card initial", () => {
    const q = [
      parent(1, { date: "2026-01", source: "email", quote: "טקסט בדיקה: מורה מצוינת & הילד אוהב להגיע לשיעור." }),
      parent(2, { date: "2025-12", source: "form", rewarded: true, rewardNote: "קיבלנו מתנה קטנה על ההמלצה" }),
      parent(3, { date: "2026-09", source: "whatsapp" }),
    ];
    const m = [teacher(1, { grades: ["ח"] }), teacher(2, { grades: ["ט", "ז"] }), teacher(3, { grades: ["ו", "ז", "ח", "ט"] })];
    const b = build({ t: q, m });
    expect(b.code, b.log).toBe(0);
    const home = b.read("index.html");
    expect(home).toContain("ינואר 2026, במייל");
    expect(home).toContain("דצמבר 2025, בטופס באתר");
    expect(home).toContain("ספטמבר 2026, בוואטסאפ");
    expect(home).toContain("קיבלנו מתנה קטנה על ההמלצה");
    expect(home.match(/<span>קיבלנו/g), "the reward note appears once").toHaveLength(1);
    expect(home).toContain("מורה מצוינת &amp; הילד");
    const team = b.read("teachers/index.html");
    expect(team).toContain("מורה למתמטיקה, כיתה ח׳");
    expect(team).toContain("מורה למתמטיקה, כיתות ז׳ וט׳");
    expect(team).toContain("מורה למתמטיקה, כיתות ו׳ עד ט׳");
    expect([...team.matchAll(/tcard-init" aria-hidden="true">([^<]*)</g)].map((x) => x[1])).toEqual(["ד", "ר", "מ"]);
  });

  test("a teacher photo is linked relative to the page and the file is copied", () => {
    const b = build({ m: [teacher(1, { photo: "dana.jpg" }), teacher(2), teacher(3)], photoFiles: ["dana.jpg"] });
    expect(b.code, b.log).toBe(0);
    const html = b.read("teachers/index.html");
    const src = html.match(/<img class="tcard-img" src="([^"]+)"/)[1];
    expect(src).toBe("../assets/img/teachers/dana.jpg");
    expect(b.has(new URL(src, "http://x/teachers/").pathname.slice(1))).toBe(true);
    expect((html.match(/class="tcard-img tcard-init"/g) || []).length, "the cards with no photo keep the initial").toBe(2);
  });

  test("the built site never carries the private data files or the partials", () => {
    for (const f of ["owner.json", "testimonials.json", "teachers.json", "_partials"]) expect(existsSync(join(DIST, f)), `dist/${f}`).toBe(false);
    expect(readFileSync(join(DIST, "CNAME"), "utf8").trim()).toBe("ba-derech.com");
  });

  const BAD = [
    ["a duplicate quote ref", { t: [parent(1), parent(1), parent(3)] }, "duplicate ref"],
    ["an unknown audience", { t: [parent(1, { audience: "student" })] }, "audience must be"],
    ["a quote that is too short", { t: [parent(1, { quote: "קצר מדי" })] }, "allowed 20 to 320"],
    ["a quote that is too long", { t: [parent(1, { quote: "ארוך ".repeat(80) })] }, "allowed 20 to 320"],
    ["an unknown source", { t: [parent(1, { source: "sms" })] }, "source must be"],
    ["rewarded as text", { t: [parent(1, { rewarded: "yes" })] }, "rewarded must be true or false"],
    ["an email in a quote", { t: [parent(1, { quote: "טקסט בדיקה: כתבו לי ל dana@example.com בכל שעה" })] }, "email address or a link"],
    ["a link in a quote", { t: [parent(1, { quote: "טקסט בדיקה: ראו את הדף https://example.com שלהם" })] }, "email address or a link"],
    ["a tag in a quote", { t: [parent(1, { quote: "טקסט בדיקה: <b>מצוין</b> ומקצועי מאוד באמת" })] }, "< > {"],
    ["a quote ref in the wrong format", { t: [parent(1, { ref: "X01" })] }, "ref must look like T01"],
    ["a month that does not exist", { t: [parent(1, { date: "2026-13" })] }, "YYYY-MM"],
    ["a date with no month", { t: [parent(1, { date: "26-09" })] }, "YYYY-MM"],
    ["month zero (an old-looking date that sorts before today)", { t: [parent(1, { date: "2026-00" })] }, "YYYY-MM"],
    ["a one-digit month", { t: [parent(1, { date: "2025-9" })] }, "YYYY-MM"],
    ["a full date instead of year and month", { t: [parent(1, { date: "2025-09-15" })] }, "YYYY-MM"],
    ["the misspelling of ניסיון in a quote", { t: [parent(1, { quote: "טקסט בדיקה: שיעור נס" + "יון מצוין ומקצועי מאוד" })] }, "נס" + "יון"],
    ["a quote label for the wrong audience", { t: [tquote(1, { who: "אמא של תלמיד בכיתה ח׳" })] }, "not an allowed label"],
    ["an item that is not an object", { t: [null] }, "not an object"],
    ["teacher grades as text", { m: [teacher(1, { grades: "ח" })] }, "grades must be a list"],
    ["teacher grades empty", { m: [teacher(1, { grades: [] })] }, "grades must be a list"],
    ["a teacher grade that does not exist", { m: [teacher(1, { grades: ["י"] })] }, "grades must be a list"],
    ["a repeated teacher grade", { m: [teacher(1, { grades: ["ח", "ח"] })] }, "grades must be a list"],
    ["a teacher name in Latin letters", { m: [teacher(1, { name: "Dana" })] }, "Hebrew letters"],
    ["a one-letter teacher name", { m: [teacher(1, { name: "ד" })] }, "allowed 2 to 30"],
    ["a teacher line that is too short", { m: [teacher(1, { line: "קצר מדי" })] }, "allowed 20 to 160"],
    ["a teacher line that is too long", { m: [teacher(1, { line: "ארוך ".repeat(40) })] }, "allowed 20 to 160"],
    ["a teacher role that is too short", { m: [teacher(1, { role: "מו" })] }, "allowed 4 to 40"],
    ["a teacher ref in the wrong format", { m: [teacher(1, { ref: "M1" })] }, "ref must look like M01"],
    ["a duplicate teacher ref", { m: [teacher(1), teacher(1, { name: "רון" })] }, "duplicate ref"],
    ["a teacher photo name with a path", { m: [teacher(1, { photo: "../x.jpg" })] }, "photo must be a file name"],
    ["a teacher photo name in capitals", { m: [teacher(1, { photo: "Dana.JPG" })] }, "photo must be a file name"],
    ["a phone number in a teacher line", { m: [teacher(1, { line: "טקסט בדיקה: התקשרו אליי 050-1234567 בכל שעה" })] }, "phone number"],
    ["an em dash in a teacher line", { m: [teacher(1, { line: "טקסט בדיקה: אוהבת שברים \u2014 וגם אלגברה כיפית" })] }, "em dash"],
    ["a missing testimonials file", { raw: { t: null } }, "testimonials.json: missing"],
    ["a missing teachers file", { raw: { m: null } }, "teachers.json: missing"],
    ["testimonials that are not JSON", { raw: { t: "{ nope" } }, "not valid JSON"],
    ["teachers without an items list", { raw: { m: '{"people": []}' } }, 'needs {"items"'],
  ];
  // "Build failed" is the build's own report. A crash with a stack trace also exits 1 and may even mention the field,
  // so every case checks for the report and for the message that tells the owner what to fix.
  BAD.unshift(["a reward with no note", { t: [parent(1, { rewarded: true })] }, "rewardNote"]);
  for (const [name, data, message] of BAD) {
    test(`the build fails on ${name}, with a message that says what to fix`, () => {
      const b = build(data);
      expect(b.code, b.log).toBe(1);
      expect(b.log).toContain("Build failed");
      expect(b.log).toContain(message);
      expect(b.log, "no stack trace").not.toMatch(/\n\s+at .*\.mjs:\d+/);
    });
  }
});
