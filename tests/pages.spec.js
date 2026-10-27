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
