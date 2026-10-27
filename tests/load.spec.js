// 1-2. Clean load (console, network, font, images) and no horizontal overflow at any project size.
import { test, expect } from "@playwright/test";
import { gotoHome, scrollThrough } from "./helpers.js";

test("loads with no console errors or failed requests; font and images load", async ({ page }) => {
  const problems = [];
  const fonts = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console error: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
    if (r.url().endsWith(".woff2")) fonts.push({ url: r.url(), status: r.status() });
  });

  await gotoHome(page);
  await scrollThrough(page);

  // Rendered images (lazy ones included, now that we scrolled) finish loading with real pixels.
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((i) => i.getClientRects().length && !i.complete).map((i) => i.src)))
    .toEqual([]);
  const broken = await page.evaluate(() =>
    [...document.images].filter((i) => i.getClientRects().length && i.naturalWidth === 0).map((i) => i.src));
  expect(broken, "rendered images with naturalWidth 0").toEqual([]);

  // Theme variants that are display:none here (lazy ones never load) must still exist on the server.
  const allSrc = await page.evaluate(() => [...new Set([...document.images].map((i) => i.src))]);
  for (const src of allSrc) {
    const res = await page.request.get(src);
    expect.soft(res.status(), `image ${src}`).toBe(200);
    expect.soft(res.headers()["content-type"], `image ${src}`).toMatch(/^image\//);
  }

  // The self-hosted Hebrew face is actually used and loaded, not just declared.
  await expect
    .poll(() => page.evaluate(() =>
      [...document.fonts].some((f) => f.family.replace(/["']/g, "") === "Noto Sans Hebrew" && f.status === "loaded" && /U\+0*590/i.test(f.unicodeRange))))
    .toBe(true);
  expect(await page.evaluate(() => document.fonts.check('16px "Noto Sans Hebrew"', "שלום"))).toBe(true);
  expect(fonts.some((f) => f.url.includes("hebrew-hebrew") && f.status === 200), JSON.stringify(fonts)).toBe(true);
  expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?Noto Sans Hebrew/);

  expect(problems, problems.join("\n")).toEqual([]);
});

test("no horizontal overflow (root scrollWidth <= clientWidth) while scrolling through", async ({ page }) => {
  await gotoHome(page);
  const worst = await scrollThrough(page);
  expect(worst.overflow, `scrollWidth ${worst.scrollWidth} > clientWidth ${worst.clientWidth} at y=${worst.y}`).toBeLessThanOrEqual(0);
});

test("no element sticks out past the viewport edge (would be cut off by body overflow-x:hidden)", async ({ page }) => {
  await gotoHome(page);
  await scrollThrough(page);
  const offenders = await page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const clippedByAncestor = (el) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== "visible") return true;
      }
      return false;
    };
    const describe = (el) => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : "");
    const out = [];
    for (const el of document.body.querySelectorAll("*")) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if ((r.left < -1 || r.right > W + 1) && !clippedByAncestor(el)) {
        out.push(`${describe(el)} [${Math.round(r.left)}..${Math.round(r.right)}] viewport ${W}`);
      }
    }
    return out;
  });
  expect(offenders, offenders.join("\n")).toEqual([]);
});
