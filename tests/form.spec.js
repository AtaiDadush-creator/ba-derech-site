// The contact form: validation, the WhatsApp mode (no endpoint), the Apps Script mode (mocked), honeypot, no JavaScript, axe.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { PHONE } from "./helpers.js";

const WA = `https://wa.me/${PHONE}?text=`;
const ENDPOINT = "https://script.google.com/macros/s/TEST_ENDPOINT_FOR_PLAYWRIGHT_000001/exec";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const submit = (page) => page.locator('#lead-form button[type="submit"]').click();
const opened = (page) => page.evaluate(() => window.__opened);

// window.open is recorded instead of opening WhatsApp: no network, nothing to close.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
});

async function open(page, query = "") {
  await page.goto(`/contact/${query}`);
  await expect(page.locator("#lead-form")).toBeVisible();
}

async function fill(page, { role = "parent", name = "דנה", phone = "050-123-4567", grade = "ח", contact = "whatsapp", note = "" } = {}) {
  await page.locator(`input[name="role"][value="${role}"]`).check();
  await page.fill("#f-name", name);
  await page.fill("#f-phone", phone);
  if (role === "parent" && grade) await page.locator(`input[name="grade"][value="${grade}"]`).check();
  await page.locator(`input[name="contact"][value="${contact}"]`).check();
  if (note) await page.fill("#f-note", note);
}

// Serves /contact/ with an endpoint in data-endpoint (as the build does once owner.json has one) and mocks the reply.
async function withEndpoint(page, reply) {
  await page.route("**/contact/**", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('data-endpoint=""', `data-endpoint="${ENDPOINT}"`) });
  });
  const requests = [];
  await page.route(ENDPOINT, async (route) => {
    requests.push(route.request());
    if (reply === "network") return route.abort("failed");
    await route.fulfill({ status: reply.status ?? 200, body: reply.body ?? "", headers: { "content-type": "text/plain", "access-control-allow-origin": "*" } });
  });
  return requests;
}

test("empty submit: worded errors, aria-invalid, focus on the first field, nothing opened; fixing clears the error", async ({ page }) => {
  await open(page);
  await submit(page);
  for (const id of ["e-name", "e-phone", "e-grade"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect(page.locator(`#${id}`)).not.toHaveText("");
  }
  for (const id of ["f-name", "f-phone", "f-grade"]) await expect(page.locator(`#${id}`)).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#f-name")).toBeFocused();
  expect(await opened(page)).toEqual([]);
  await page.fill("#f-name", "דנה");
  await expect(page.locator("#e-name")).toBeHidden();
  await expect(page.locator("#f-name")).not.toHaveAttribute("aria-invalid", "true");
});

test("Israeli phone numbers: accepted and rejected formats", async ({ page }) => {
  await open(page);
  for (const ok of ["050-123-4567", "0501234567", "+972 50 123 4567", "00972501234567", "972501234567", "03-1234567", "077-1234567"]) {
    await fill(page, { phone: ok });
    await submit(page);
    await expect(page.locator("#e-phone"), ok).toBeHidden();
  }
  expect(await opened(page)).toHaveLength(7);
  for (const bad of ["12345", "050123456", "05012345678", "0001234567", "06-1234567", "טלפון"]) {
    await page.fill("#f-phone", bad);
    await submit(page);
    await expect(page.locator("#e-phone"), bad).toBeVisible();
    await expect(page.locator("#f-phone")).toBeFocused();
  }
  expect(await opened(page)).toHaveLength(7);
});

test("teacher: ?role=teacher presets it, grade hidden and not required, the hint changes", async ({ page }) => {
  await open(page, "?role=teacher");
  await expect(page.locator('input[name="role"][value="teacher"]')).toBeChecked();
  await expect(page.locator("#f-grade")).toBeHidden();
  await expect(page.locator("#f-note")).toHaveAttribute("aria-describedby", "h-note-t");
  await fill(page, { role: "teacher", note: "לימדתי ז׳ וח׳" });
  await submit(page);
  const [url] = await opened(page);
  const text = decodeURIComponent(url.slice(WA.length));
  expect(text).toContain("פונה: מורה למתמטיקה");
  expect(text).not.toContain("כיתה:");
});

test("WhatsApp mode (no endpoint): honest button, a wa.me link with the details and no child-name field", async ({ page }) => {
  const calls = [];
  page.on("request", (r) => { if (/script\.google\.com/.test(r.url())) calls.push(r.url()); });
  await open(page);
  await expect(page.locator("#lead-form")).toHaveAttribute("data-endpoint", "");
  await expect(page.locator('#lead-form button[type="submit"]')).toHaveText("להמשיך בוואטסאפ");
  await expect(page.locator("#f-mode")).toBeVisible();
  await fill(page, { contact: "call", note: "קשה לו עם שברים" });
  await submit(page);
  const urls = await opened(page);
  expect(urls).toHaveLength(1);
  expect(urls[0].startsWith(WA)).toBe(true);
  expect([...new URL(urls[0]).searchParams.keys()]).toEqual(["text"]);
  const text = decodeURIComponent(urls[0].slice(WA.length));
  expect(text.split("\n")).toEqual([
    "היי, הגעתי מהאתר ואשמח שתחזרו אליי.", "פונה: הורה", "שם: דנה", "טלפון: 0501234567",
    "כיתה: ח׳", "נוח לי: שיחת טלפון", "הערה: קשה לו עם שברים",
  ]);
  expect(text).not.toMatch(/שם הילד|שם התלמיד|ילד:|תלמיד:/);
  const link = page.locator("#f-status a.wa-fallback");
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toBe(urls[0]);
  await expect(link).toHaveAttribute("rel", /noopener/);
  expect(calls).toEqual([]);
});

test("honeypot: the client never drops a send; a filled trap travels in the body and the server decides", async ({ page }) => {
  const requests = await withEndpoint(page, { body: "ok" });
  await open(page);
  await fill(page);
  await page.locator("#f-hp").evaluate((el) => { el.value = "http://spam.example"; });
  await submit(page);
  await expect(page.locator("#f-done")).toBeVisible({ timeout: 6000 });
  expect(requests).toHaveLength(1);
  expect(JSON.parse(requests[0].postData()).hp).toBe("http://spam.example");
  expect(await opened(page)).toEqual([]);
});

test("honeypot in WhatsApp mode: a filled trap (an autofill, say) opens WhatsApp like any other send", async ({ page }) => {
  await open(page);
  await fill(page);
  await page.locator("#f-hp").evaluate((el) => { el.value = "x"; });
  await submit(page);
  expect(await opened(page)).toHaveLength(1);
  await expect(page.locator("#f-done")).toBeHidden();
});

test("with JavaScript the no-JavaScript line is hidden and the form shows", async ({ page }) => {
  await open(page);
  await expect(page.locator("#f-nojs")).toBeHidden();
});

test("error summary: an alert above the fields counts the fields to fix, and empties once they are fixed", async ({ page }) => {
  await open(page);
  const sum = page.locator("#f-sum");
  await expect(sum).toHaveAttribute("role", "alert");
  expect(await sum.evaluate((s) => s.compareDocumentPosition(document.getElementById("f-name")) & Node.DOCUMENT_POSITION_FOLLOWING), "above the fields").toBeTruthy();
  await submit(page);
  const many = await sum.getAttribute("data-many");
  await expect(sum).toHaveText(many.replace("{n}", "3"));
  await expect(page.locator("#f-name")).toBeFocused();
  await page.fill("#f-name", "דנה");
  await page.fill("#f-phone", "0501234567");
  await submit(page);
  await expect(sum).toHaveText(await sum.getAttribute("data-one"));
  await page.locator('input[name="grade"][value="ח"]').check();
  await expect(sum).toHaveText("");
  await submit(page);
  await expect(sum).toHaveText("");
  expect(await opened(page)).toHaveLength(1);
});

test("WhatsApp mode: a double tap opens one tab; editing the form allows the next send", async ({ page }) => {
  await open(page);
  await fill(page);
  await page.evaluate(() => { const f = document.getElementById("lead-form"); f.requestSubmit(); f.requestSubmit(); });
  expect(await opened(page)).toHaveLength(1);
  await page.fill("#f-note", "עוד משהו");
  await submit(page);
  expect(await opened(page)).toHaveLength(2);
});

test("Apps Script mode: while sending, the button stays focused and is marked aria-disabled", async ({ page }) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route("**/contact/**", async (route) => {
    if (route.request().resourceType() !== "document") return route.continue();
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace('data-endpoint=""', `data-endpoint="${ENDPOINT}"`) });
  });
  await page.route(ENDPOINT, async (route) => { await gate; await route.fulfill({ status: 200, body: "ok", headers: { "content-type": "text/plain", "access-control-allow-origin": "*" } }); });
  await open(page);
  await fill(page);
  const btn = page.locator('#lead-form button[type="submit"]');
  await btn.focus();
  await page.keyboard.press("Enter");
  await expect(btn).toHaveAttribute("aria-disabled", "true");
  await expect(btn).toBeFocused();
  await expect(btn).not.toHaveAttribute("disabled", "");
  release();
  await expect(page.locator("#f-done")).toBeVisible({ timeout: 6000 });
});

test("Apps Script mode, reply ok: a text/plain JSON body, then the thank-you panel takes focus", async ({ page }) => {
  const requests = await withEndpoint(page, { body: "ok\n" });
  await open(page);
  await expect(page.locator('#lead-form button[type="submit"]')).toHaveText("לשלוח");
  await expect(page.locator("#f-mode")).toBeHidden();
  await fill(page);
  await submit(page);
  await expect(page.locator("#f-done")).toBeVisible({ timeout: 6000 });
  await expect(page.locator("#f-done")).toBeFocused();
  await expect(page.locator("#lead-form")).toBeHidden();
  await expect(page.locator('#f-done [data-contact="whatsapp"]')).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].method()).toBe("POST");
  expect(requests[0].headers()["content-type"]).toMatch(/^text\/plain/);
  const body = JSON.parse(requests[0].postData());
  expect(Object.keys(body).sort()).toEqual(["contact", "grade", "hp", "id", "name", "note", "page", "phone", "role", "t"]);
  expect(body).toMatchObject({ role: "parent", name: "דנה", phone: "0501234567", grade: "ח", contact: "whatsapp", hp: "", page: "/contact/" });
  expect(body.t).toBeGreaterThanOrEqual(2000);
  expect(await opened(page)).toEqual([]);
});

for (const [name, reply] of [["an error reply", { body: "error:busy" }], ["HTTP 500", { status: 500, body: "ok" }], ["a network failure", "network"]]) {
  test(`Apps Script mode, ${name}: no thank-you, a prefilled WhatsApp link, the button works again`, async ({ page }) => {
    await withEndpoint(page, reply);
    await open(page);
    await fill(page);
    await submit(page);
    const link = page.locator("#f-status a.wa-fallback");
    await expect(link).toBeVisible({ timeout: 6000 });
    expect(decodeURIComponent((await link.getAttribute("href")).slice(WA.length))).toContain("שם: דנה");
    await expect(page.locator("#f-done")).toBeHidden();
    await expect(page.locator('#lead-form button[type="submit"]')).toBeEnabled();
  });
}

test("without JavaScript the form stays hidden, and the WhatsApp and email links remain", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/contact/");
  await expect(page.locator("#lead-form")).toBeHidden();
  await expect(page.locator(".f-nojs")).toBeVisible();
  await expect(page.locator("#lead a.wa")).toHaveCount(2);
  await expect(page.locator('#lead a[href^="mailto:"]')).toBeVisible();
  await ctx.close();
});

for (const colorScheme of ["light", "dark"]) {
  test(`axe on the form with errors shown, and after success (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await withEndpoint(page, { body: "ok" });
    await open(page);
    await submit(page);
    let r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => v.id), "with errors").toEqual([]);
    await fill(page);
    await submit(page);
    await expect(page.locator("#f-done")).toBeVisible({ timeout: 6000 });
    r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => v.id), "after success").toEqual([]);
  });
}
