// 3. Every WhatsApp link: right number, message decodes to data-wa, distinct, opens safely in a new tab.
import { test, expect } from "@playwright/test";
import { WA_PREFIX } from "./helpers.js";

test("every a.wa link is a correct, distinct, safe wa.me link", async ({ page }) => {
  await page.goto("/");
  const links = await page.locator("a.wa").evaluateAll((els) =>
    els.map((a) => ({
      where: a.className,
      href: a.getAttribute("href") || "",
      wa: a.getAttribute("data-wa"),
      target: a.getAttribute("target"),
      rel: a.getAttribute("rel") || "",
    })));
  expect(links.length, "number of WhatsApp links").toBe(2);
  test.info().annotations.push({ type: "wa-links", description: String(links.length) });

  for (const l of links) {
    const label = `a.${l.where.replace(/\s+/g, ".")} "${l.wa}"`;
    expect.soft(l.wa, `${label}: data-wa present`).toBeTruthy();
    expect.soft(l.href.startsWith(WA_PREFIX), `${label}: href starts with ${WA_PREFIX}, got ${l.href}`).toBe(true);
    if (l.href.startsWith(WA_PREFIX)) {
      expect.soft([...new URL(l.href).searchParams.keys()], `${label}: only a text parameter`).toEqual(["text"]);
      expect.soft(decodeURIComponent(l.href.slice(WA_PREFIX.length)), `${label}: decoded text equals data-wa`).toBe(l.wa);
    }
    expect.soft(l.target, `${label}: target`).toBe("_blank");
    expect.soft(l.rel.split(/\s+/), `${label}: rel`).toContain("noopener");
    expect.soft(l.wa || "", `${label}: does not ask for the child's name`).not.toContain("שם הילד");
  }

  const msgs = links.map((l) => l.wa);
  const dups = msgs.filter((m, i) => msgs.indexOf(m) !== i);
  expect(dups, "duplicate WhatsApp messages").toEqual([]);
});

test("the share link opens WhatsApp with no number and carries the site address", async ({ page }) => {
  await page.goto("/");
  const SHARE = "https://wa.me/?text=";
  const links = await page.locator("a.share").evaluateAll((els) =>
    els.map((a) => ({ href: a.getAttribute("href") || "", text: a.getAttribute("data-share"), cls: a.className, target: a.getAttribute("target"), rel: a.getAttribute("rel") || "" })));
  expect(links).toHaveLength(1);
  const l = links[0];
  expect(l.href.startsWith(SHARE)).toBe(true);
  expect(decodeURIComponent(l.href.slice(SHARE.length))).toBe(l.text);
  expect(l.text).toContain("https://ba-derech.com/");
  expect(l.cls.split(/\s+/)).not.toContain("wa");
  expect(l.target).toBe("_blank");
  expect(l.rel.split(/\s+/)).toContain("noopener");
});
