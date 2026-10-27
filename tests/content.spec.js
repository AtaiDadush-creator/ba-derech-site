// 4. Content rules: built HTML text rules, document language and direction, headings, in-page links.
import { test, expect } from "@playwright/test";
import { builtHtml, gotoHome } from "./helpers.js";

test.describe("built HTML files", () => {
  const files = builtHtml();

  test("dist has HTML to check", () => {
    expect(files.map((f) => f.file)).toContain("index.html");
  });

  test("no em dash (U+2014) and no misspelling נסיון", () => {
    for (const { file, html } of files) {
      expect.soft(html.includes("\u2014"), `${file}: em dash`).toBe(false);
      expect.soft(html.includes("נסיון"), `${file}: "נסיון" (should be "ניסיון")`).toBe(false);
    }
  });

  test("every href=\"#x\" points to an existing id, and ids are unique", () => {
    for (const { file, html } of files) {
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      const dups = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect.soft(dups, `${file}: duplicate ids`).toEqual([]);
      const missing = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]).filter((t) => !ids.includes(t));
      expect.soft(missing, `${file}: in-page links to missing (or empty) targets`).toEqual([]);
    }
  });
});

test.describe("rendered page", () => {
  test("html lang=he dir=rtl, exactly one h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", "he");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("in-page links resolve in the DOM", async ({ page }) => {
    await page.goto("/");
    const missing = await page.evaluate(() =>
      [...document.querySelectorAll('a[href^="#"]')].map((a) => a.getAttribute("href").slice(1)).filter((id) => !id || !document.getElementById(id)));
    expect(missing).toEqual([]);
  });

  test("every h2 renders in at most two lines", async ({ page }) => {
    await gotoHome(page);
    const heads = await page.evaluate(() =>
      [...document.querySelectorAll("h2")].map((h) => {
        const cs = getComputedStyle(h);
        let lh = parseFloat(cs.lineHeight);
        if (Number.isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.2; // "normal"
        const height = h.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        return { id: h.id || h.className, lines: +(height / lh).toFixed(2), width: Math.round(h.getBoundingClientRect().width) };
      }));
    expect(heads.length).toBeGreaterThan(0);
    const tooTall = heads.filter((h) => h.lines > 2.2);
    expect(tooTall, tooTall.map((h) => `h2#${h.id}: ${h.lines} lines at width ${h.width}px`).join("\n")).toEqual([]);
  });
});
