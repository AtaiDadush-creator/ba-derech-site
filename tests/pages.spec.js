// 10. Legal pages and 404: clean load, axe in light and dark, no overflow, footer links reach every page.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoHome, scrollThrough } from "./helpers.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const PAGES = ["terms/", "privacy/", "accessibility/"];

for (const path of PAGES) {
  test(`${path}: clean load, one h1, axe light and dark, no overflow`, async ({ page }) => {
    const problems = [];
    page.on("console", (m) => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
    page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
    page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()}`));
    page.on("response", (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await page.goto(`/${path}`);
      await page.evaluate(() => document.fonts.ready.then(() => true));
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.locator("main#main")).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), colorScheme).toEqual([]);
      const worst = await scrollThrough(page);
      expect(worst.overflow, `horizontal overflow at y=${worst.y}`).toBeLessThanOrEqual(0);
    }
    expect(problems).toEqual([]);
  });
}

test("footer legal links reach each page, and each page links home", async ({ page }) => {
  for (const path of PAGES) {
    await gotoHome(page);
    await page.locator(`.foot-legal nav a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await page.locator("header a", { hasText: "לדף הבית" }).click();
    await expect(page.locator(".hero")).toBeVisible();
  }
});

test("unknown path returns 404 with a way home", async ({ page }) => {
  const res = await page.goto("/no-such-page/");
  expect(res.status()).toBe(404);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('a[href="/"]').first()).toBeVisible();
});
