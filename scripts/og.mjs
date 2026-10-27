// Renders scripts/og.html to src/assets/img/og.png (1200x630), the image shown when the link is shared.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(new URL("og.html", import.meta.url).href);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: fileURLToPath(new URL("../src/assets/img/og.png", import.meta.url)) });
await browser.close();
console.log("Wrote src/assets/img/og.png");
