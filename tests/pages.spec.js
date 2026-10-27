// 10. Legal pages and 404: footer links reach every legal page, the logo leads home, and an unknown path is a 404.
// (Clean load, axe and overflow on the legal pages live in site.spec.js, with every other page.)
import { test, expect } from "@playwright/test";
import { gotoHome } from "./helpers.js";

const PAGES = ["terms/", "privacy/", "accessibility/"];

test("footer legal links reach each page, and each page links home", async ({ page }) => {
  for (const path of PAGES) {
    await gotoHome(page);
    await page.locator(`.foot-legal nav a[href="${path}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/${path}$`));
    await page.locator("header a.logo").click();
    await expect(page.locator(".hero")).toBeVisible();
  }
});

test("unknown path returns 404 with a way home", async ({ page }) => {
  const res = await page.goto("/no-such-page/");
  expect(res.status()).toBe(404);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator('a[href="/"]').first()).toBeVisible();
});

test("the 404 page uses the shared header and footer, and its links work from any depth", async ({ page, request }) => {
  const problems = [];
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("/deep/")) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  const res = await page.goto("/deep/er/still/");
  expect(res.status()).toBe(404);
  await expect(page.locator("header a.logo")).toHaveAttribute("href", "/");
  await expect(page.locator("header #menu a")).toHaveCount(5);
  await expect(page.locator("footer .foot-legal nav a")).toHaveCount(3);
  const hrefs = await page.locator("header a[href], footer a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")).filter((h) => h.startsWith("/")));
  expect(hrefs.length).toBeGreaterThan(5);
  for (const h of new Set(hrefs)) expect((await request.get(h.split("#")[0])).status(), h).toBe(200);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily), "the shared stylesheet loaded").toMatch(/Noto Sans Hebrew/);
  expect(problems, problems.join("\n")).toEqual([]);
});
