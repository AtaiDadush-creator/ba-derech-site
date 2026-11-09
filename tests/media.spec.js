// 12. Videos and WhatsApp screenshots (owner's decision, 9/11/2026): nothing heavy loads before play,
// every video has a poster, controls and a caption, the files are served in byte ranges (Safari needs them),
// and every screenshot has the message in words as its alt.
import { test, expect } from "@playwright/test";
import { gotoPage, scrollThrough } from "./helpers.js";

const VIDEOS = { "/": ["parent-1", "parent-2", "service-1", "service-2", "service-3", "atai-story"] };

for (const [path, names] of Object.entries(VIDEOS)) {
  test(`${path}: videos load only on play, with poster, controls and a caption`, async ({ page }) => {
    const early = [];
    page.on("request", (r) => { if (r.url().endsWith(".mp4")) early.push(r.url()); });
    await gotoPage(page, path);
    await scrollThrough(page);
    const vids = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => ({
      src: v.querySelector("source")?.getAttribute("src") || "",
      poster: v.getAttribute("poster") || "",
      preload: v.getAttribute("preload"),
      controls: v.controls,
      inline: v.hasAttribute("playsinline"),
      caption: (document.getElementById(v.getAttribute("aria-describedby") || "") || {}).textContent || "",
    })));
    expect(vids.map((v) => v.src.split("/").pop().replace(/\.mp4$/, ""))).toEqual(names);
    for (const v of vids) {
      expect(v.preload, v.src).toBe("none");
      expect(v.controls, v.src).toBe(true);
      expect(v.inline, v.src).toBe(true);
      expect(v.caption.trim().length, `${v.src} caption`).toBeGreaterThan(10);
      const poster = await page.request.get(new URL(v.poster, page.url()).href);
      expect(poster.status(), v.poster).toBe(200);
      expect(poster.headers()["content-type"], v.poster).toMatch(/^image\//);
      const part = await page.request.get(new URL(v.src, page.url()).href, { headers: { range: "bytes=0-1023" } });
      expect(part.status(), `${v.src} byte range`).toBe(206);
      expect(part.headers()["content-type"], v.src).toBe("video/mp4");
      expect((await part.body()).length, v.src).toBe(1024);
    }
    expect(early, "no video file is fetched before someone presses play").toEqual([]);
  });
}

test("teach page: no videos (the owner took the recruiting videos down, 9/11)", async ({ page }) => {
  await gotoPage(page, "/teach/");
  await expect(page.locator("video")).toHaveCount(0);
});

test("home: every WhatsApp screenshot has the message in words as its alt", async ({ page }) => {
  await gotoPage(page, "/");
  const alts = await page.locator("#parents .shots img").evaluateAll((imgs) => imgs.map((i) => i.alt.trim()));
  expect(alts.length).toBeGreaterThanOrEqual(3);
  for (const a of alts) expect(a.length, a).toBeGreaterThan(15);
});
