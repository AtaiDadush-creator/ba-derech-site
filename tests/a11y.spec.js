// 7-9. Accessibility: axe WCAG 2.x A/AA in light and dark, skip link, reduced motion.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoHome, gotoPage, tabKey } from "./helpers.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function report(violations) {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n` + v.nodes.map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary || "").split("\n").slice(1).join(" ").trim()}`).join("\n"))
    .join("\n");
}

for (const colorScheme of ["light", "dark"]) {
  test(`axe: no WCAG 2.1 A/AA violations on the home page (${colorScheme})`, async ({ page }) => {
    // Reduced motion so the scan sees final colours, not mid-animation opacity.
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await gotoHome(page);

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations, report(results.violations)).toEqual([]);
  });
}

for (const path of ["/", "/contact/"]) test(`${path} skip link: first Tab focuses it, Enter moves to #main`, async ({ page, browserName }) => {
  await gotoPage(page, path);
  const key = tabKey(browserName);
  await page.keyboard.press(key);
  const skip = page.locator("a.skip");
  await expect(skip).toBeFocused();
  await expect(skip).toHaveAttribute("href", "#main");
  await expect(skip).toHaveText(/דילוג לתוכן/);
  await expect(skip).toBeInViewport(); // it slides into view on focus

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect
    .poll(() => page.evaluate(() => {
      const main = document.getElementById("main");
      return main.contains(document.activeElement) || Math.abs(main.getBoundingClientRect().top) < 2;
    }))
    .toBe(true);

  // The next Tab continues inside the main content, not back in the header nav.
  await page.keyboard.press(key);
  expect(await page.evaluate(() => document.getElementById("main").contains(document.activeElement))).toBe(true);
});

test("reduced motion: no smooth scroll, no CSS animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const r = await page.evaluate(() => ({
    scroll: getComputedStyle(document.documentElement).scrollBehavior,
    animations: document.getAnimations().map((a) => a.animationName || "?"),
  }));
  expect(r.scroll).not.toBe("smooth");
  expect(r.animations, "running CSS animations").toEqual([]);
});

test("default motion: smooth scroll is on (sanity check for the reduced-motion test)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("smooth");
});
