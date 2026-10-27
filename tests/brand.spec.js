// 11. The brand-site goal: no prices and no "free" claims, no sales CTA and no phone bar, one contact section
// (2 WhatsApp links + 1 share link), a teachers section, and a contact box that holds at 320 and 390 wide.
// Tests target structure (ids, classes, roles). Hebrew copy is only checked for the price and "בחינם" rule.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PHONE, WA_PREFIX, builtHtml, gotoHome } from "./helpers.js";

const SHARE_PREFIX = "https://wa.me/?text=";
const OWNER = JSON.parse(readFileSync(new URL("../src/owner.json", import.meta.url), "utf8"));
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

// Hebrew letters as lookaround guards: \b does not work around Hebrew, and "שח" must not match inside words like "משחק".
const HEB = "\\u0590-\\u05FF";
const NIS = `(?<![${HEB}])ש["'״”]{0,2}ח(?![${HEB}])`; // שח, ש"ח, ש״ח as a standalone word
const PRICE_RULES = {
  "shekel sign": /₪/,
  "amount before ש״ח or שח": new RegExp(`\\d[\\d,.]*\\s*${NIS}`),
  "ש״ח or שח as a word": new RegExp(NIS),
  "NIS or ILS": /\b(?:NIS|ILS)\b/,
};
const FREE_RULE = { "בחינם": /בחינם/ };
const hits = (text, rules) =>
  Object.entries(rules).flatMap(([name, re]) => {
    const m = text.match(re);
    return m ? [`${name}: "…${text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}…"`] : [];
  });

const homeHtml = () => builtHtml().find((f) => f.file === "index.html").html;

// 1. No prices.
test.describe("no prices, no free claims", () => {
  test("home page rendered text: no ₪, no amounts, no ש״ח/שח, no בחינם", async ({ page }) => {
    await page.goto("/");
    const { rendered, content, attrs } = await page.evaluate(() => ({
      rendered: document.body.innerText,
      content: document.body.textContent,
      // Text a screen reader or a share preview can read without it being on screen.
      attrs: [...document.querySelectorAll("[alt],[aria-label],[title],[data-wa],[data-share],meta[content]")]
        .map((e) => [e.getAttribute("alt"), e.getAttribute("aria-label"), e.getAttribute("title"), e.getAttribute("data-wa"), e.getAttribute("data-share"), e.getAttribute("content")])
        .flat().filter(Boolean).join("\n"),
    }));
    expect(rendered.length, "page has text").toBeGreaterThan(500);
    for (const [name, text] of Object.entries({ "innerText": rendered, "textContent": content, "attributes and meta": attrs })) {
      expect(hits(text, { ...PRICE_RULES, ...FREE_RULE }), `home page ${name}`).toEqual([]);
    }
  });

  test("home page built HTML (head, JSON-LD, comments included): no ₪, no amounts, no בחינם", () => {
    expect(hits(homeHtml(), { ...PRICE_RULES, ...FREE_RULE })).toEqual([]);
  });

  test("terms page: ₪ appears only inside the cancellation fee sentence from owner.json, and in no list", async ({ page }) => {
    const fee = norm(OWNER.cancellationFee);
    expect(fee, "owner.json cancellationFee is a filled-in fact").not.toBe("");
    await page.goto("/terms/");
    const info = await page.evaluate(() => {
      const main = document.querySelector("main");
      // Split main into sections: each h2 and everything until the next h2.
      const sections = [];
      let cur = null;
      for (const el of main.children) {
        if (el.tagName === "H2") { cur = { text: "", els: [] }; sections.push(cur); }
        if (cur) { cur.text += " " + el.textContent; cur.els.push(el); }
      }
      return {
        text: main.textContent,
        sections: sections.map((s) => s.text),
        // Elements that own a ₪ and are not just a wrapper of other elements that own it.
        shekelParas: [...main.querySelectorAll("p, li, td, th, dd, dt")].filter((e) => e.textContent.includes("₪")).map((e) => ({ tag: e.tagName, text: e.textContent })),
        listsWithShekel: [...main.querySelectorAll("ul, ol, dl, table")].filter((e) => e.textContent.includes("₪")).length,
        lists: main.querySelectorAll("ul, ol, dl, table").length,
      };
    });
    const text = norm(info.text);
    expect(text, "the cancellation fee sentence is still on the page").toContain(fee);

    // Everything outside the fee fact is free of money amounts.
    const outside = text.split(fee).join(" ");
    expect(hits(outside, PRICE_RULES), "money outside the cancellation fee").toEqual([]);

    // The fee is the only ₪ on the page, in one paragraph (not a list, not a table).
    const feeShekels = (fee.match(/₪/g) || []).length;
    expect((text.match(/₪/g) || []).length, "number of ₪ on the page").toBe(feeShekels);
    expect(info.shekelParas.every((p) => p.tag === "P" && norm(p.text).includes(fee)), "every ₪ sits in a paragraph that holds the fee sentence").toBe(true);
    expect(info.listsWithShekel, "lists or tables with ₪ (a price list)").toBe(0);

    // Exactly one section mentions ₪, and it is the one with the fee.
    const withShekel = info.sections.filter((s) => s.includes("₪"));
    expect(withShekel, "sections with ₪").toHaveLength(feeShekels ? 1 : 0);
    if (feeShekels) expect(norm(withShekel[0])).toContain(fee);
  });
});

// 2. WhatsApp: 2 a.wa and 1 a.share, all inside #contact, nowhere else, and no phone bar.
test.describe("WhatsApp links live only in #contact", () => {
  const isWaScript = () => {
    const re = /wa\.me|whatsapp/i;
    return [...document.querySelectorAll("[href], [data-wa], [data-share], .wa, .share")]
      .filter((e) => re.test(e.getAttribute("href") || "") || e.matches("[data-wa], [data-share], .wa, .share"))
      .map((e) => ({ tag: e.tagName, cls: e.className, inContact: Boolean(e.closest("#contact")) }));
  };

  test("exactly 2 a.wa and 1 a.share, all inside #contact", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("a.wa")).toHaveCount(2);
    await expect(page.locator("a.share")).toHaveCount(1);
    await expect(page.locator("#contact a.wa")).toHaveCount(2);
    await expect(page.locator("#contact a.share")).toHaveCount(1);
    await expect(page.locator(".wa:not(a), .share:not(a)"), "wa/share classes only on links").toHaveCount(0);
    const all = await page.evaluate(isWaScript);
    expect(all, "every WhatsApp-ish element on the page").toHaveLength(3);
    expect(all.filter((e) => !e.inContact), "WhatsApp-ish elements outside #contact").toEqual([]);
  });

  test("no WhatsApp link in the nav, hero, FAQ, #teach or footer", async ({ page }) => {
    await page.goto("/");
    const regions = { nav: "header nav", hero: ".hero", faq: "#faq", teach: "#teach", footer: "footer" };
    for (const [name, sel] of Object.entries(regions)) {
      await expect(page.locator(sel), `${name} (${sel}) exists`).toHaveCount(1);
      const wa = await page.locator(sel).evaluate((root) => {
        const re = /wa\.me|whatsapp\.com|whatsapp:/i;
        return [...root.querySelectorAll("a, [href], [data-wa], [data-share], .wa, .share")]
          .filter((e) => re.test(e.getAttribute("href") || "") || e.matches("[data-wa], [data-share], .wa, .share"))
          .map((e) => e.outerHTML.slice(0, 80));
      });
      expect(wa, `${name}: WhatsApp links`).toEqual([]);
    }
  });

  test("no phone bar element, and no wa-bar in the built HTML, CSS or JS", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".wa-bar")).toHaveCount(0);
    expect(homeHtml()).not.toMatch(/wa-bar/);
    for (const file of ["styles.css", "main.js"]) {
      const res = await page.request.get(`/${file}`);
      expect(res.ok(), `${file} is served`).toBe(true);
      expect(await res.text(), `${file} mentions wa-bar`).not.toMatch(/wa-bar/);
    }
  });
});

// 3. #teach: after #faq, before #contact, 3 stops, and linked from the nav and the footer nav.
test.describe("#teach and the navigation", () => {
  test("#teach comes after #faq and before #contact, with 3 .stop items", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#teach")).toHaveCount(1);
    await expect(page.locator("#teach")).toBeVisible();
    await expect(page.locator("#teach .stop")).toHaveCount(3);
    const order = await page.evaluate(() => {
      const [faq, teach, contact] = ["faq", "teach", "contact"].map((id) => document.getElementById(id));
      const F = Node.DOCUMENT_POSITION_FOLLOWING;
      return {
        faqBeforeTeach: Boolean(faq.compareDocumentPosition(teach) & F),
        teachBeforeContact: Boolean(teach.compareDocumentPosition(contact) & F),
        nested: faq.contains(teach) || teach.contains(contact) || contact.contains(teach) || teach.contains(faq),
      };
    });
    expect(order).toEqual({ faqBeforeTeach: true, teachBeforeContact: true, nested: false });
  });

  test("#teach leads to #contact with an in-page link, not a WhatsApp link", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('#teach a[href="#contact"]').first()).toBeVisible();
  });

  test("the nav and the footer nav both link to #teach and #contact, with 5 to 6 in-page anchors", async ({ page }) => {
    await page.goto("/");
    for (const [name, nav] of Object.entries({ nav: "header nav", footer: "footer nav" })) {
      const hrefs = await page.locator(`${nav} a[href^="#"]`).evaluateAll((els) => els.map((a) => a.getAttribute("href")));
      const label = `${name} anchors: ${hrefs.join(" ")}`;
      expect(hrefs, label).toContain("#teach");
      expect(hrefs, label).toContain("#contact");
      expect(hrefs.length, label).toBeGreaterThanOrEqual(5);
      expect(hrefs.length, label).toBeLessThanOrEqual(6);
    }
    await expect(page.locator("header nav .btn"), "no button in the nav").toHaveCount(0);
  });
});

// 4. The contact box at 320 and 390: nothing overflows, every link has a usable tap target.
for (const width of [320, 390]) {
  test(`#contact at ${width}px: every link and the email fit inside the viewport, tap targets are at least 24px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await gotoHome(page);
    await page.locator("#contact").scrollIntoViewIfNeeded();
    const box = await page.evaluate(() => {
      const r = (rect) => ({ left: rect.left, right: rect.right, width: rect.width, height: rect.height });
      const links = [...document.querySelectorAll("#contact a")].map((a) => {
        const cs = getComputedStyle(a);
        const span = a.querySelector(".ltr");
        return {
          label: (a.className || a.getAttribute("href") || "link") + ": " + a.textContent.replace(/\s+/g, " ").trim().slice(0, 40),
          mail: (a.getAttribute("href") || "").startsWith("mailto:"),
          display: cs.display,
          // An inline link in the middle of a sentence (the privacy link) is exempt from the 24px rule in WCAG 2.5.8.
          inSentence: Boolean(a.parentElement && a.parentElement.tagName === "P" && a.parentElement.textContent.trim() !== a.textContent.trim() && cs.display === "inline"),
          inNote: Boolean(a.closest(".privacy-note")),
          box: r(a.getBoundingClientRect()),
          lines: [...a.getClientRects()].map(r),
          span: span ? r(span.getBoundingClientRect()) : null,
          // Content wider than the link's own box (only measurable for non-inline links).
          spill: cs.display === "inline" ? 0 : a.scrollWidth - a.clientWidth,
        };
      });
      const root = document.documentElement;
      return {
        links,
        finalBox: r(document.querySelector("#contact .final-box").getBoundingClientRect()),
        pageOverflow: root.scrollWidth - root.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
      };
    });

    const EPS = 0.5;
    const inside = (r) => r.left >= -EPS && r.right <= width + EPS;
    expect(box.links.length, "links in #contact (2 wa, 1 share, email, privacy)").toBeGreaterThanOrEqual(4);
    expect(box.links.filter((l) => l.mail), "email link").toHaveLength(1);
    // The sentence-link exemption must stay narrow: at most one link (the privacy link in the note), never a standalone one.
    expect(box.links.filter((l) => l.inSentence).length, "links exempt from the 24px rule (inline in a sentence)").toBeLessThanOrEqual(1);
    expect(box.links.filter((l) => l.inSentence && !l.inNote), "exempt links outside .privacy-note").toEqual([]);
    expect(inside(box.finalBox), `contact box fits: ${JSON.stringify(box.finalBox)}`).toBe(true);
    expect(box.pageOverflow, "page scrolls sideways").toBeLessThanOrEqual(0);
    expect(box.bodyScrollWidth, "body wider than the viewport").toBeLessThanOrEqual(width);

    for (const l of box.links) {
      expect.soft(l.lines.every(inside), `${l.label}: every line box inside 0..${width}: ${JSON.stringify(l.lines.map((x) => [Math.round(x.left), Math.round(x.right)]))}`).toBe(true);
      expect.soft(l.spill, `${l.label}: content spills out of the link box`).toBeLessThanOrEqual(1);
      if (l.span) {
        expect.soft(inside(l.span), `${l.label}: inner text inside the viewport: ${JSON.stringify(l.span)}`).toBe(true);
        expect.soft(l.span.left >= l.box.left - EPS && l.span.right <= l.box.right + EPS, `${l.label}: inner text inside its own link box`).toBe(true);
      }
      if (!l.inSentence) {
        expect.soft(l.box.height, `${l.label}: tap target height`).toBeGreaterThanOrEqual(24);
        expect.soft(l.box.width, `${l.label}: tap target width`).toBeGreaterThanOrEqual(24);
      }
    }
  });
}

// 5. The build's data-share step, read straight from dist/index.html.
test.describe("built share link (dist/index.html)", () => {
  const anchors = (html) => [...html.matchAll(/<a\s[^>]*>/g)].map((m) => m[0]);
  const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
  const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

  test("the share href decodes to the data-share text and carries no phone number", () => {
    const html = homeHtml();
    const shares = anchors(html).filter((t) => /\sdata-share=/.test(t));
    expect(shares, "anchors with data-share").toHaveLength(1);
    const tag = shares[0];
    const href = decodeEntities(attr(tag, "href") || "");
    const text = decodeEntities(attr(tag, "data-share") || "");

    expect(text.length, "data-share text").toBeGreaterThan(20);
    expect(href.startsWith(SHARE_PREFIX), `href starts with ${SHARE_PREFIX}: ${href.slice(0, 40)}`).toBe(true);
    expect(href.slice(SHARE_PREFIX.length), "href has the text and nothing else").not.toMatch(/[?&#]/);
    expect(decodeURIComponent(href.slice(SHARE_PREFIX.length)), "href text decodes to data-share").toBe(text);

    // No phone number in the link, encoded or decoded: not ours, and not any 9+ digit run.
    for (const s of [href, decodeURIComponent(href), text, tag]) {
      expect(s, "our phone in the share link").not.toContain(PHONE);
      expect(s, "our phone without the country code").not.toContain(PHONE.slice(3));
      expect(s.replace(/%[0-9A-F]{2}/gi, ""), "any long digit run (a phone number)").not.toMatch(/\d{9,}/);
    }
    expect(href, "no wa.me/<number> form").not.toMatch(/wa\.me\/\d/);

    // It is a share link and not a "message us" link, and it opens safely in a new tab.
    expect(attr(tag, "class").split(/\s+/)).toContain("share");
    expect(attr(tag, "class").split(/\s+/)).not.toContain("wa");
    expect(tag, "data-wa left on the share link").not.toMatch(/\sdata-wa=/);
    expect(attr(tag, "target")).toBe("_blank");
    expect((attr(tag, "rel") || "").split(/\s+/)).toContain("noopener");
    // The text is the site address, so the recipient can open it.
    expect(text).toContain("https://ba-derech.com/");
  });

  test("the share link tells screen readers it opens WhatsApp", () => {
    const m = homeHtml().match(/<a\s[^>]*data-share=[^>]*>([\s\S]*?)<\/a>/);
    expect(m, "share anchor found").toBeTruthy();
    expect(m[1], "span.sr inside the share link").toMatch(/<span class="sr">[^<]+<\/span>/);
  });

  test("no data-share is left unprocessed, and the two a.wa links still point at our number", () => {
    const html = homeHtml();
    const tags = anchors(html);
    expect(tags.filter((t) => /\sdata-share=/.test(t) && !/\shref="/.test(t)), "data-share anchors with no href").toEqual([]);
    const wa = tags.filter((t) => /\sdata-wa=/.test(t));
    expect(wa, "anchors with data-wa").toHaveLength(2);
    for (const t of wa) expect(decodeEntities(attr(t, "href") || "").startsWith(WA_PREFIX), `wa link href: ${t.slice(0, 60)}`).toBe(true);
  });
});
