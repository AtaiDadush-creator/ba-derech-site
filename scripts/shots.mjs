// Full-page screenshots of every page at phone and desktop width, light and dark, into shots/ (for a quick visual check).
// Usage: npm run build && node scripts/serve.mjs & node scripts/shots.mjs
import { chromium, webkit, devices } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const BASE = "http://localhost:4173/";
const PAGES = ["", "terms/", "privacy/", "accessibility/"];
const RUNS = [
  { name: "phone", engine: webkit, context: { ...devices["iPhone 13"] } },
  { name: "desktop", engine: chromium, context: { viewport: { width: 1440, height: 900 } } },
];

await mkdir("shots", { recursive: true });
for (const run of RUNS) {
  const browser = await run.engine.launch();
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ ...run.context, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const p of PAGES) {
      await page.goto(BASE + p);
      await page.evaluate(() => document.fonts.ready);
      const slug = (p.replace(/\/$/, "") || "home") + `-${run.name}-${scheme}`;
      await page.screenshot({ path: `shots/${slug}.png`, fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
}
console.log("Saved screenshots to shots/");
