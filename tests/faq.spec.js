// 5. FAQ cards: first open, others closed; mouse and keyboard toggle; aria-expanded mirrors the answer's hidden state.
import { test, expect } from "@playwright/test";
import { gotoPage, scrollToY, tabKey } from "./helpers.js";

const state = (page) =>
  page.locator(".faq .card").evaluateAll((cards) =>
    cards.map((c) => {
      const q = c.querySelector(".q");
      const a = c.querySelector(".a");
      return {
        open: c.classList.contains("open"),
        expanded: q.getAttribute("aria-expanded"),
        hidden: a.hidden,
        rendered: a.getClientRects().length > 0,
        controls: q.getAttribute("aria-controls"),
        answerId: a.id,
      };
    }));

function expectConsistent(cards) {
  cards.forEach((c, i) => {
    expect.soft(c.expanded, `card ${i}: aria-expanded vs hidden`).toBe(String(!c.hidden));
    expect.soft(c.open, `card ${i}: .open vs hidden`).toBe(!c.hidden);
    expect.soft(c.rendered, `card ${i}: answer rendered vs hidden`).toBe(!c.hidden);
    expect.soft(c.controls, `card ${i}: aria-controls points at its answer`).toBe(c.answerId);
  });
}

/** Document-relative top of an element, so Playwright's own scrolling cannot hide a layout shift. */
const docTop = (loc) => loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);

/** Put an element in the upper third of the viewport. */
async function bringToUpperThird(page, loc) {
  const y = await loc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY - window.innerHeight / 3);
  await scrollToY(page, Math.max(0, y));
}

test.beforeEach(async ({ page }) => {
  await gotoPage(page, "/faq/");
});

test("first card starts open, all others closed, aria in sync", async ({ page }) => {
  const cards = await state(page);
  expect(cards.length).toBe(9);
  expect(cards[0].open).toBe(true);
  expect(cards.slice(1).every((c) => !c.open && c.hidden)).toBe(true);
  expectConsistent(cards);
});

test("clicking a closed question opens it without moving the card above; clicking again closes it", async ({ page }) => {
  const cards = page.locator(".faq .card");
  const idx = 2;
  const target = cards.nth(idx);
  const above = cards.nth(idx - 1);
  const q = target.locator(".q");

  await bringToUpperThird(page, q);
  const before = { above: await docTop(above), q: await docTop(q), aboveView: (await above.boundingBox()).y };

  await q.click();
  await expect(q).toHaveAttribute("aria-expanded", "true");
  await expect(target.locator(".a")).toBeVisible();
  expect(Math.abs((await docTop(above)) - before.above), "card above moved in the document").toBeLessThanOrEqual(1);
  expect(Math.abs((await docTop(q)) - before.q), "clicked question moved in the document").toBeLessThanOrEqual(1);
  expect(Math.abs((await above.boundingBox()).y - before.aboveView), "card above jumped on screen").toBeLessThanOrEqual(1);
  expectConsistent(await state(page));

  // A click inside the open answer must not close it.
  await target.locator(".a").click({ position: { x: 5, y: 5 } });
  await expect(q).toHaveAttribute("aria-expanded", "true");

  await q.click();
  await expect(q).toHaveAttribute("aria-expanded", "false");
  await expect(target.locator(".a")).toBeHidden();
  expectConsistent(await state(page));
});

test("keyboard: Tab reaches the question button and Enter toggles it", async ({ page, browserName }) => {
  const cards = page.locator(".faq .card");
  const prevQ = cards.nth(2).locator(".q");
  const q = cards.nth(3).locator(".q");
  await bringToUpperThird(page, q);

  await prevQ.focus();
  await page.keyboard.press(tabKey(browserName));
  await expect(q).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(q).toHaveAttribute("aria-expanded", "true");
  await expect(cards.nth(3).locator(".a")).toBeVisible();
  await expect(q).toBeFocused();
  expectConsistent(await state(page));

  await page.keyboard.press("Enter");
  await expect(q).toHaveAttribute("aria-expanded", "false");
  await expect(cards.nth(3).locator(".a")).toBeHidden();
  expectConsistent(await state(page));
});
