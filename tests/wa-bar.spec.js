// 6. The phone WhatsApp bar (.wa-bar): only below 861px; appears after the hero button, leaves at #start,
// and is never reachable by keyboard while hidden.
import { test, expect } from "@playwright/test";
import { gotoHome, isNarrow, scrollToY, tabKey } from "./helpers.js";

/** True if the element can take focus right now (visibility:hidden elements cannot). */
const canFocus = (loc) =>
  loc.evaluate((el) => {
    const prev = document.activeElement;
    el.focus({ preventScroll: true });
    const ok = document.activeElement === el;
    if (ok) el.blur();
    if (prev && prev !== el && prev.focus) prev.focus({ preventScroll: true });
    return ok;
  });

async function scrollPastHeroButton(page) {
  const y = await page.locator(".hero .wa").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY + 20);
  await scrollToY(page, y);
}

test.describe("narrow screens (phone and tablet)", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!isNarrow(page), "the bar only exists at max-width 860px");
    await gotoHome(page);
  });

  test("hidden and not focusable at load", async ({ page }) => {
    const bar = page.locator(".wa-bar");
    await expect(bar).toHaveCount(1);
    await expect(bar).toBeHidden();
    expect(await bar.evaluate((el) => getComputedStyle(el).visibility)).toBe("hidden");
    expect(await canFocus(bar)).toBe(false);
  });

  test("still hidden while the hero button is on screen", async ({ page }) => {
    const y = await page.locator(".hero .wa").first().evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight / 2);
    await scrollToY(page, Math.max(0, y));
    await expect(page.locator(".hero .wa").first()).toBeInViewport();
    await expect(page.locator(".wa-bar")).toBeHidden();
  });

  test("shows after scrolling past the hero button, hides again when #start is on screen", async ({ page }) => {
    const bar = page.locator(".wa-bar");
    await scrollPastHeroButton(page);
    await expect(bar).toHaveClass(/\bshow\b/);
    await expect(bar).toBeVisible();
    await expect(bar).toBeInViewport({ ratio: 0.9 });
    expect(await canFocus(bar)).toBe(true);

    // #start just entering from the bottom of the screen.
    const y = await page.locator("#start").evaluate((el) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight + 80);
    await scrollToY(page, y);
    await expect(bar).not.toHaveClass(/\bshow\b/);
    await expect(bar).toBeHidden(); // visibility flips after the .28s slide-out
    expect(await canFocus(bar)).toBe(false);

    // Scrolling back up into the middle brings it back.
    await scrollPastHeroButton(page);
    await expect(bar).toBeVisible();
  });

  test("keyboard focus skips the hidden bar", async ({ page, browserName }) => {
    const bar = page.locator(".wa-bar");
    // The last focusable element before the bar in DOM order is the footer's back-to-top link.
    const lastBefore = page.locator("footer a").last();
    await lastBefore.focus();
    await expect(bar).toBeHidden();
    await page.keyboard.press(tabKey(browserName));
    await expect(bar).not.toBeFocused();
  });
});

test.describe("wide screens", () => {
  test("bar is not displayed on desktop, even after scrolling", async ({ page }) => {
    test.skip(isNarrow(page), "desktop only");
    await gotoHome(page);
    const bar = page.locator(".wa-bar");
    expect(await bar.evaluate((el) => getComputedStyle(el).display)).toBe("none");
    await scrollPastHeroButton(page);
    expect(await bar.evaluate((el) => getComputedStyle(el).display)).toBe("none");
    await expect(bar).toBeHidden();
  });
});
