// 7-9. Accessibility: axe WCAG 2.x A/AA in light and dark, skip link, reduced motion.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoHome, isNarrow, scrollToY, tabKey } from "./helpers.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

function report(violations) {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n` + v.nodes.map((n) => `    ${n.target.join(" ")}\n      ${(n.failureSummary || "").split("\n").slice(1).join(" ").trim()}`).join("\n"))
    .join("\n");
}

for (const colorScheme of ["light", "dark"]) {
  test(`axe: no WCAG 2.1 A/AA violations (${colorScheme}, all FAQ answers open)`, async ({ page }) => {
    // Reduced motion so the scan sees final colours, not mid-animation opacity.
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await gotoHome(page);
    await page.evaluate(() => document.querySelectorAll(".faq .card:not(.open) .q").forEach((q) => q.click()));
    await expect(page.locator(".faq .a:not([hidden])")).toHaveCount(await page.locator(".faq .a").count());

    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    expect(results.violations, report(results.violations)).toEqual([]);
  });
}

test("axe: the phone bar itself, while shown (light and dark)", async ({ page }) => {
  test.skip(!isNarrow(page), "the bar only exists at max-width 860px");
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await gotoHome(page);
    const y = await page.locator(".hero .wa").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY + 20);
    await scrollToY(page, y);
    await expect(page.locator(".wa-bar")).toBeVisible();
    const results = await new AxeBuilder({ page }).include(".wa-bar").withTags(TAGS).analyze();
    expect(results.violations, `${colorScheme}:\n${report(results.violations)}`).toEqual([]);
  }
});

test("skip link: first Tab focuses it, Enter moves to #main", async ({ page, browserName }) => {
  await gotoHome(page);
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

test("reduced motion: no bar transition, no smooth scroll, no CSS animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const r = await page.evaluate(() => {
    const bar = document.querySelector(".wa-bar");
    const t = () => {
      const cs = getComputedStyle(bar);
      return { property: cs.transitionProperty, duration: cs.transitionDuration, delay: cs.transitionDelay };
    };
    const hidden = t();
    bar.classList.add("show");
    const shown = t();
    bar.classList.remove("show");
    return { hidden, shown, scroll: getComputedStyle(document.documentElement).scrollBehavior, animations: document.getAnimations().map((a) => a.animationName || "?") };
  });
  const allZero = (list) => list.split(",").every((d) => parseFloat(d) === 0);
  for (const [name, s] of Object.entries({ hidden: r.hidden, shown: r.shown })) {
    expect.soft(s.property === "none" || (allZero(s.duration) && allZero(s.delay)), `.wa-bar (${name}) transition: ${JSON.stringify(s)}`).toBe(true);
  }
  expect(r.scroll).not.toBe("smooth");
  expect(r.animations, "running CSS animations").toEqual([]);
});

test("default motion: smooth scroll is on (sanity check for the reduced-motion test)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("smooth");
});
