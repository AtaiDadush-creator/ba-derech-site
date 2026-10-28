// Every page: clean load, one h1, the shared header and footer, axe light and dark, no sideways scroll, the phone menu.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { ALL, CONTENT, NAV, gotoPage, scrollThrough } from "./helpers.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

for (const path of ALL) {
  test(`${path}: clean load, lang and dir, one h1, axe light and dark, no overflow`, async ({ page }) => {
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await gotoPage(page, path);
      await expect(page.locator("html")).toHaveAttribute("lang", "he");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main#main")).toBeVisible();
      if (path === "/faq/") await page.evaluate(() => document.querySelectorAll(".faq .card:not(.open) .q").forEach((q) => q.click()));
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${path} ${colorScheme}`).toEqual([]);
      const worst = await scrollThrough(page);
      expect(worst.overflow, `${path}: sideways scroll at y=${worst.y}`).toBeLessThanOrEqual(0);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test(`${path}: the shared header and footer`, async ({ page }) => {
    await gotoPage(page, path);
    const links = page.locator("header #menu a");
    await expect(links).toHaveText(NAV.map(([label]) => label));
    expect(await links.evaluateAll((els) => els.map((a) => new URL(a.href).pathname))).toEqual(NAV.map(([, p]) => `/${p}`));
    const current = await page.locator('header [aria-current="page"]').evaluateAll((els) => els.map((a) => new URL(a.href).pathname));
    expect(current, "aria-current").toEqual(path !== "/" && CONTENT.includes(path) ? [path] : []);
    await expect(page.locator("header a.logo")).toHaveAttribute("href", path === "/" ? "./" : "../");
    await expect(page.locator("header a.wa")).toHaveCount(1);
    await expect(page.locator("footer .foot-h")).toHaveText(["הורים", "מורים", "קשר"]);
    await expect(page.locator("footer a.wa"), "the teacher link and the general WhatsApp link").toHaveCount(2);
    await expect(page.locator(".foot-legal nav a")).toHaveCount(3);
  });
}

test("every internal link on every page answers 200", async ({ page, request }) => {
  const seen = new Set();
  for (const path of ALL) {
    await page.goto(path);
    const urls = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => a.href.split("#")[0]).filter((u) => u.startsWith(location.origin)));
    for (const u of urls) {
      if (seen.has(u)) continue;
      seen.add(u);
      expect.soft((await request.get(u)).status(), `${path} links to ${u}`).toBe(200);
    }
  }
});

test("phone menu: closed at first, opens and closes, Escape returns focus; on desktop the links show", async ({ page }) => {
  await gotoPage(page, "/method/");
  const btn = page.locator(".menu-btn"), menu = page.locator("#menu");
  if (page.viewportSize().width > 860) {
    await expect(btn).toBeHidden();
    await expect(menu).toBeVisible();
    return;
  }
  await expect(btn).toBeVisible();
  await expect(btn).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeHidden();
  const closedLabel = (await btn.textContent()).trim();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await expect(menu).toBeVisible();
  await expect(btn, "the open button says it closes").toHaveText(await btn.getAttribute("data-close"));
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(btn).toBeFocused();
  await expect(btn).toHaveText(closedLabel);
  // A tap outside the header closes the open menu.
  await btn.click();
  await expect(menu).toBeVisible();
  await page.locator("main h1").click();
  await expect(menu).toBeHidden();
  await expect(btn).toHaveAttribute("aria-expanded", "false");
});

test("no form anywhere: no form, field or link to a form; the contact page offers two WhatsApp choices", async ({ page }) => {
  for (const path of ALL) {
    await page.goto(path);
    await expect(page.locator("form, input, textarea, select"), `${path}: form controls`).toHaveCount(0);
    expect(await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter((h) => /#lead|role=teacher/.test(h))), `${path}: links to the old form`).toEqual([]);
  }
  await page.goto("/contact/");
  const choices = page.locator("#write .wa-choices a.wa");
  await expect(choices).toHaveCount(2);
  for (const a of await choices.all()) {
    await expect(a).toBeVisible();
    expect((await a.boundingBox()).height, "a real button, easy to tap").toBeGreaterThanOrEqual(44);
  }
});

test("if main.js does not load: the phone menu still works", async ({ page }) => {
  await page.route("**/main.js", (route) => route.abort());
  await gotoPage(page, "/contact/");
  if (page.viewportSize().width > 860) {
    await expect(page.locator("#menu a").first()).toBeVisible();
    return;
  }
  await page.locator(".menu-btn").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator(".menu-btn")).toHaveAttribute("aria-expanded", "true");
});

test("without JavaScript: nav links visible, no menu button", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("http://localhost:4173/");
  await expect(page.locator(".menu-btn")).toBeHidden();
  await expect(page.locator("#menu a").first()).toBeVisible();
  await ctx.close();
});

test("the sitemap lists every page", () => {
  const xml = readFileSync(new URL("../dist/sitemap.xml", import.meta.url), "utf8");
  for (const p of ALL) expect(xml).toContain(`<loc>https://ba-derech.com${p}</loc>`);
});

test("styles.css has no shadows and no gradients", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).not.toMatch(/box-shadow|text-shadow|linear-gradient|radial-gradient/);
});
