// Shared helpers for the landing page specs. Tests target structure (classes, ids, roles), not copy.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const PHONE = "972559897869";
export const WA_PREFIX = `https://wa.me/${PHONE}?text=`;
// .wa-bar is only styled inside @media (max-width: 860px); tablet 768 is in that range too.
export const BAR_MAX_WIDTH = 860;
export const DIST = fileURLToPath(new URL("../dist/", import.meta.url));

export const isNarrow = (page) => page.viewportSize().width <= BAR_MAX_WIDTH;

// WebKit on macOS follows Safari's default: plain Tab skips links, Option+Tab reaches every focusable element.
export const tabKey = (browserName) => (browserName === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");

/** Wait for two animation frames so scroll handlers (queued with rAF) have run. */
export async function frames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Jump (no smooth scroll) to a document y position. */
export async function scrollToY(page, y) {
  await page.evaluate((top) => {
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, top);
    html.style.scrollBehavior = prev;
  }, y);
  await frames(page);
}

/** Load the page and wait until web fonts are settled (wrapping depends on them). */
export async function gotoHome(page) {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready.then(() => true));
}

/**
 * Scroll top to bottom in viewport steps (triggers lazy images and scroll-driven styles),
 * then back to the top. Returns the worst horizontal overflow seen on the root element.
 */
export async function scrollThrough(page) {
  return page.evaluate(async () => {
    const html = document.documentElement;
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    const step = Math.max(200, Math.floor(innerHeight * 0.75));
    let worst = { overflow: html.scrollWidth - html.clientWidth, y: 0, scrollWidth: html.scrollWidth, clientWidth: html.clientWidth };
    const measure = (y) => {
      const overflow = html.scrollWidth - html.clientWidth;
      if (overflow > worst.overflow) worst = { overflow, y, scrollWidth: html.scrollWidth, clientWidth: html.clientWidth };
    };
    for (let y = 0; y < html.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await frame();
      measure(y);
    }
    window.scrollTo(0, html.scrollHeight);
    await frame();
    measure(html.scrollHeight);
    window.scrollTo(0, 0);
    await frame();
    html.style.scrollBehavior = prev;
    return worst;
  });
}

/** Every built HTML file under dist/, as { file, html }. */
export function builtHtml() {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(".html")) out.push({ file: p.slice(DIST.length), html: readFileSync(p, "utf8") });
    }
  };
  walk(DIST);
  return out;
}
