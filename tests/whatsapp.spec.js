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
  expect(links.length, "number of WhatsApp links").toBeGreaterThan(0);
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
