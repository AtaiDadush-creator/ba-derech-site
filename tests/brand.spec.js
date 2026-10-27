// 11. The brand-site goal: no prices and no "free" claims, no phone bar, WhatsApp only where the owner said
// (header and footer everywhere, plus the home hero and the contact page), one share link on the home and contact pages,
// and contact boxes that hold at 320 and 390 wide.
// Tests target structure (ids, classes, roles). Hebrew copy is only checked for the price and "בחינם" rule.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { ALL, PHONE, SHARE_COUNT, WA_COUNT, WA_PREFIX, builtHtml, gotoPage } from "./helpers.js";

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

// "/" -> "index.html", "/contact/" -> "contact/index.html"
const distFile = (path) => `${path.slice(1)}index.html`;
const builtPage = (path) => builtHtml().find((f) => f.file === distFile(path)).html;

// 1. No prices, on every page but the terms page.
test.describe("no prices, no free claims", () => {
  for (const path of ALL.filter((p) => p !== "/terms/")) {
    test(`${path} rendered text: no ₪, no amounts, no ש״ח/שח, no בחינם`, async ({ page }) => {
      await page.goto(path);
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
        expect(hits(text, { ...PRICE_RULES, ...FREE_RULE }), `${path} ${name}`).toEqual([]);
      }
    });

    test(`${path} built HTML (head, JSON-LD, comments included): no ₪, no amounts, no בחינם`, () => {
      expect(hits(builtPage(path), { ...PRICE_RULES, ...FREE_RULE })).toEqual([]);
    });
  }

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

// 2. WhatsApp only where the owner said: header and footer on every page, the hero on the home page, #lead on the contact page.
test.describe("WhatsApp only where the owner said", () => {
  for (const path of ALL) {
    test(`${path}: the number of a.wa and a.share, and where they sit`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("a.wa")).toHaveCount(WA_COUNT[path] ?? 2);
      await expect(page.locator("a.share")).toHaveCount(SHARE_COUNT[path] ?? 0);
      await expect(page.locator(".wa:not(a), .share:not(a)"), "wa/share classes only on links").toHaveCount(0);
      const misplaced = await page.locator("a.wa").evaluateAll((els, p) => {
        const allowed = ["header", "footer"].concat(p === "/" ? [".hero"] : [], p === "/contact/" ? ["#lead"] : []);
        return els.filter((a) => !allowed.some((sel) => a.closest(sel))).map((a) => a.outerHTML.slice(0, 80));
      }, path);
      expect(misplaced, "a.wa outside header, footer, the home hero or #lead").toEqual([]);
      const pinned = await page.locator("a.wa").evaluateAll((els) =>
        els.filter((a) => ["fixed", "sticky"].includes(getComputedStyle(a).position)).map((a) => a.outerHTML.slice(0, 80)));
      expect(pinned, "a.wa with position fixed or sticky").toEqual([]);
    });
  }

  test("no phone bar element, and no wa-bar in the built HTML, CSS or JS", async ({ page }) => {
    for (const path of ALL) {
      await page.goto(path);
      await expect(page.locator(".wa-bar"), path).toHaveCount(0);
      expect(builtPage(path), path).not.toMatch(/wa-bar/);
    }
    for (const file of ["styles.css", "main.js"]) {
      const res = await page.request.get(`/${file}`);
      expect(res.ok(), `${file} is served`).toBe(true);
      expect(await res.text(), `${file} mentions wa-bar`).not.toMatch(/wa-bar/);
    }
  });
});

// 3. The contact boxes at 320 and 390: nothing overflows, every link has a usable tap target.
const BOXES = [
  { path: "/", box: "#contact .final-box", mail: 0 },
  { path: "/contact/", box: "#lead .contact-side", mail: 1 },
];
for (const { path, box: sel, mail } of BOXES) {
  for (const width of [320, 390]) {
    test(`${path} ${sel} at ${width}px: every link fits inside the viewport, tap targets are at least 24px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoPage(page, path);
      await page.locator(sel).scrollIntoViewIfNeeded();
      const box = await page.evaluate((sel) => {
        const r = (rect) => ({ left: rect.left, right: rect.right, width: rect.width, height: rect.height });
        const links = [...document.querySelectorAll(`${sel} a`)].map((a) => {
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
          region: r(document.querySelector(sel).getBoundingClientRect()),
          pageOverflow: root.scrollWidth - root.clientWidth,
          bodyScrollWidth: document.body.scrollWidth,
        };
      }, sel);

      const EPS = 0.5;
      const inside = (r) => r.left >= -EPS && r.right <= width + EPS;
      expect(box.links.length, "links in the box").toBeGreaterThanOrEqual(4);
      expect(box.links.filter((l) => l.mail), "email links").toHaveLength(mail);
      // The sentence-link exemption must stay narrow: at most one link (the privacy link in the note), never a standalone one.
      expect(box.links.filter((l) => l.inSentence).length, "links exempt from the 24px rule (inline in a sentence)").toBeLessThanOrEqual(1);
      expect(box.links.filter((l) => l.inSentence && !l.inNote), "exempt links outside .privacy-note").toEqual([]);
      expect(inside(box.region), `the box fits: ${JSON.stringify(box.region)}`).toBe(true);
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
}

// 4. The build's data-share step, read straight from dist/index.html and dist/contact/index.html.
for (const path of ["/", "/contact/"]) {
  test.describe(`built share link (dist/${distFile(path)})`, () => {
    const anchors = (html) => [...html.matchAll(/<a\s[^>]*>/g)].map((m) => m[0]);
    const attr = (tag, name) => (tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1];
    const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

    test("the share href decodes to the data-share text and carries no phone number", () => {
      const html = builtPage(path);
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
      const m = builtPage(path).match(/<a\s[^>]*data-share=[^>]*>([\s\S]*?)<\/a>/);
      expect(m, "share anchor found").toBeTruthy();
      expect(m[1], "span.sr inside the share link").toMatch(/<span class="sr">[^<]+<\/span>/);
    });

    test("no data-share is left unprocessed, and every a.wa still points at our number", () => {
      const tags = anchors(builtPage(path));
      expect(tags.filter((t) => /\sdata-share=/.test(t) && !/\shref="/.test(t)), "data-share anchors with no href").toEqual([]);
      const wa = tags.filter((t) => /\sdata-wa=/.test(t));
      expect(wa, "anchors with data-wa").toHaveLength(WA_COUNT[path]);
      for (const t of wa) expect(decodeEntities(attr(t, "href") || "").startsWith(WA_PREFIX), `wa link href: ${t.slice(0, 60)}`).toBe(true);
    });
  });
}
