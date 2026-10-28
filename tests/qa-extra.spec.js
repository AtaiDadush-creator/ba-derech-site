// QA extras: tests added after mutation testing of the phone menu, the data blocks, prices and WhatsApp placement.
// Each block below closes a hole that a deliberate break of the site got past the other specs.
// Tests target structure (ids, roles, attributes, counts), not Hebrew sentences.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ALL, LEGAL, DIST, PHONE, WA_COUNT, SHARE_COUNT, builtHtml } from "./helpers.js";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const HEB = "\\u0590-\\u05FF";

// ======================================================================
// Phone menu
// ======================================================================
test.describe("phone menu", () => {
  test("every page: the button controls the real menu, toggles both ways, closed links cannot take focus, a link navigates", async ({ page }) => {
    test.skip(page.viewportSize().width > 860, "phone widths only");
    for (const path of ALL) {
      await page.goto(path);
      const btn = page.locator(".menu-btn"), menu = page.locator("#menu");
      await expect(btn, path).toBeVisible();
      const id = await btn.getAttribute("aria-controls");
      expect(await page.evaluate((i) => document.getElementById(i) === document.querySelector("#menu"), id), `${path}: aria-controls names the menu`).toBe(true);
      const canFocus = () => page.locator("#menu a").evaluateAll((as) => as.map((a) => { a.focus(); return document.activeElement === a; }));
      expect((await canFocus()).some(Boolean), `${path}: a closed menu keeps its links out of reach`).toBe(false);
      await btn.click();
      await expect(menu, path).toBeVisible();
      expect((await canFocus()).every(Boolean), `${path}: an open menu links can take focus`).toBe(true);
      await btn.click();
      await expect(menu, `${path}: second click closes`).toBeHidden();
      await expect(btn).toHaveAttribute("aria-expanded", "false");
    }
    // Escape from inside the open menu (focus on a link, not on the button) closes it and puts focus back on the button.
    await page.goto("/");
    await page.locator(".menu-btn").click();
    await page.locator("#menu a").first().focus();
    await expect(page.locator("#menu a").first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#menu")).toBeHidden();
    await expect(page.locator(".menu-btn")).toBeFocused();
    await page.locator(".menu-btn").click();
    await page.locator('#menu a[href$="teachers/"]').click();
    await expect(page).toHaveURL(/\/teachers\/$/);
    await expect(page.locator("#menu")).toBeHidden();
  });

  test("the breakpoint: 860px shows the button and hides the links, 861px the other way", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "one project is enough for a CSS breakpoint");
    await page.goto("/method/");
    for (const [w, phone] of [[860, true], [861, false], [1440, false], [375, true]]) {
      await page.setViewportSize({ width: w, height: 900 });
      if (phone) { await expect(page.locator(".menu-btn"), `${w}px`).toBeVisible(); await expect(page.locator("#menu"), `${w}px`).toBeHidden(); }
      else { await expect(page.locator(".menu-btn"), `${w}px`).toBeHidden(); await expect(page.locator("#menu"), `${w}px`).toBeVisible(); }
    }
  });

  for (const colorScheme of ["light", "dark"]) {
    test(`axe with the menu open (${colorScheme})`, async ({ page }) => {
      test.skip(page.viewportSize().width > 860, "phone widths only");
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      for (const path of ["/", "/contact/"]) {
        await page.goto(path);
        await page.locator(".menu-btn").click();
        await expect(page.locator("#menu")).toBeVisible();
        const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), `${path} ${colorScheme}`).toEqual([]);
      }
    });
  }
});

// ======================================================================
// Axe: the scheme it scanned is the scheme the visitor gets
// ======================================================================
test.describe("colour schemes are really applied", () => {
  const luminance = ([r, g, b]) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
  for (const path of ALL) {
    test(`${path}: light is light, dark is dark, and neither is forced by the page`, async ({ page }) => {
      for (const [scheme, test_] of [["light", (l) => l > 0.8], ["dark", (l) => l < 0.1]]) {
        await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
        await page.goto(path);
        const rgb = await page.evaluate(() => getComputedStyle(document.body).backgroundColor.match(/\d+/g).slice(0, 3).map(Number));
        const ink = await page.evaluate(() => getComputedStyle(document.body).color.match(/\d+/g).slice(0, 3).map(Number));
        expect(test_(luminance(rgb)), `${path} ${scheme}: background ${rgb}`).toBe(true);
        expect(Math.abs(luminance(rgb) - luminance(ink)), `${path} ${scheme}: text against background`).toBeGreaterThan(0.5);
        expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme")), "no theme forced in the markup").toBeNull();
      }
    });
  }
});

// ======================================================================
// Structure that axe reports only as "needs review" or as a best practice
// ======================================================================
test.describe("structure on every page", () => {
  for (const path of ALL) {
    test(`${path}: ARIA references point at real elements; headings, links, buttons and fields have text or a name; one main`, async ({ page }) => {
      await page.goto(path);
      const info = await page.evaluate(() => {
        const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
        const refs = [];
        for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "for"]) {
          for (const e of document.querySelectorAll(`[${attr}]`)) for (const id of e.getAttribute(attr).split(/\s+/).filter(Boolean)) if (!ids.has(id)) refs.push(`${e.tagName.toLowerCase()}[${attr}=${id}]`);
        }
        const text = (e) => (e.textContent || "").replace(/\s+/g, "").length > 0;
        const named = (e) => text(e) || e.getAttribute("aria-label") || [...e.querySelectorAll("img[alt]")].some((i) => i.alt.trim());
        const label = (e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}${e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : ""}`;
        return {
          refs,
          emptyHeadings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((h) => !text(h)).map(label),
          unnamedLinks: [...document.querySelectorAll("a[href]")].filter((a) => !named(a)).map(label),
          unnamedButtons: [...document.querySelectorAll("button")].filter((b) => !named(b)).map(label),
          noAlt: [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).map((i) => i.getAttribute("src")),
          unlabelled: [...document.querySelectorAll("input:not([type=hidden]), textarea, select")].filter((c) => !(c.labels && c.labels.length) && !c.getAttribute("aria-label") && !c.getAttribute("aria-labelledby")).map(label),
          main: document.querySelectorAll("main, [role=main]").length,
          h1: document.querySelectorAll("h1").length,
        };
      });
      expect(info.refs, "ids that aria-*, for or aria-controls name but the page does not have").toEqual([]);
      expect(info.emptyHeadings, "empty headings").toEqual([]);
      expect(info.unnamedLinks, "links with no text and no name").toEqual([]);
      expect(info.unnamedButtons, "buttons with no text and no name").toEqual([]);
      expect(info.noAlt, "images with no alt attribute").toEqual([]);
      expect(info.unlabelled, "fields with no label").toEqual([]);
      expect(info.main).toBe(1);
      expect(info.h1).toBe(1);
    });
  }
});

// ======================================================================
// Prices and "free" claims: the wider net
// ======================================================================
const WIDE = {
  "שקל or שקלים": new RegExp(`(?<![${HEB}])שקל(?:ים)?(?![${HEB}])`),
  "another currency": new RegExp(`[$€£]|(?<![${HEB}])(?:דולר|דולרים|יורו|אירו)(?![${HEB}])|\\b(?:USD|EUR|GBP)\\b`),
  "free (חינם, בחינם, free)": new RegExp(`(?<![${HEB}])ב?חינם(?![${HEB}])|\\bfree\\b`, "i"),
  "an amount per period": new RegExp(`\\d[\\d,.]*\\s*(?:ל|ב)(?:חודש|שיעור|שעה|שנה|שבוע)(?![${HEB}])`),
  // The words may carry a one-letter prefix (המחיר, ובעלות); "שעולה" (an arrow that rises) is not a price.
  "a price word followed by a number": new RegExp(`(?<![${HEB}])(?:[הבלוכמ]?(?:מחיר(?:ים)?|עלות)|עולה|עולים)(?![${HEB}])[^.\\n<]{0,15}\\d`),
};
const wideHits = (text) => Object.entries(WIDE).flatMap(([name, re]) => { const m = text.match(re); return m ? [`${name}: "...${text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 25)}..."`] : []; });
const builtOf = (path) => builtHtml().find((f) => f.file === `${path.slice(1)}index.html`).html;

test.describe("no prices and no free claims, wider net", () => {
  for (const path of ALL) {
    test(`${path}: text, attributes and source carry no other currency, price word, per-period amount or free claim`, async ({ page }) => {
      await page.goto(path);
      const { rendered, content, attrs } = await page.evaluate(() => ({
        rendered: document.body.innerText,
        content: document.body.textContent,
        attrs: [...document.querySelectorAll("*")].flatMap((e) => [...e.attributes].filter((a) => !["href", "src", "class", "id", "style", "d", "viewBox", "type", "rel", "target"].includes(a.name) && !a.name.startsWith("data-for") && !a.name.startsWith("aria-controls")).map((a) => a.value)).join("\n"),
      }));
      for (const [where, text] of Object.entries({ innerText: rendered, textContent: content, attributes: attrs })) expect(wideHits(text), `${path} ${where}`).toEqual([]);
      expect(wideHits(builtOf(path)), `${path} built HTML`).toEqual([]);
    });
  }
});

// ======================================================================
// WhatsApp: only the allowed links, nothing floating, no stray phone number
// ======================================================================
test.describe("WhatsApp placement, wider net", () => {
  for (const path of ALL) {
    test(`${path}: every WhatsApp, share or tel link is an a.wa or a.share; nothing is fixed to the screen; the number only in a.wa and the legal line`, async ({ page }) => {
      await page.goto(path);
      // The legal pages may print the number in their text (it is the contact detail); every other page only in the footer's legal line.
      const textMayHoldNumber = LEGAL.includes(path);
      const info = await page.evaluate(([phone, textOk]) => {
        const describe = (a) => a.outerHTML.slice(0, 90);
        const chat = [...document.querySelectorAll("a[href]")].filter((a) => /wa\.me|whatsapp|^tel:|^sms:|^callto:/i.test(a.getAttribute("href")));
        const strays = chat.filter((a) => !a.classList.contains("wa") && !a.classList.contains("share")).map(describe);
        const tel = chat.filter((a) => /^(tel|sms|callto):/i.test(a.getAttribute("href"))).map(describe);
        const floating = chat.filter((a) => { for (let e = a; e && e !== document.documentElement; e = e.parentElement) if (getComputedStyle(e).position === "fixed") return true; return getComputedStyle(a).position === "sticky"; }).map(describe);
        const tail = phone.slice(3);
        const norm = (s) => String(s).replace(/[\s\-().+]/g, "");
        const leaks = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (n.nodeType === 3) { if (!textOk && norm(n.nodeValue).includes(tail) && !n.parentElement.closest(".foot-legal")) leaks.push(`text: ${n.nodeValue.trim().slice(0, 60)}`); continue; }
          if (n.closest(".foot-legal")) continue;
          for (const a of n.attributes) {
            if (n.matches("a.wa") && (a.name === "href" || a.name === "data-wa")) continue;
            let v = a.value;
            try { v = decodeURIComponent(v); } catch { /* a lone % in a style value */ }
            if (norm(v).includes(tail)) leaks.push(`${n.tagName.toLowerCase()}[${a.name}]: ${a.value.slice(0, 60)}`);
          }
        }
        return { strays, tel, floating, leaks, wa: document.querySelectorAll("a.wa").length, share: document.querySelectorAll("a.share").length };
      }, [PHONE, textMayHoldNumber]);
      expect(info.strays, "WhatsApp or phone links that are neither a.wa nor a.share").toEqual([]);
      expect(info.tel, "tel, sms or callto links").toEqual([]);
      expect(info.floating, "WhatsApp links fixed or stuck to the screen").toEqual([]);
      expect(info.leaks, "our number outside a.wa and the legal line").toEqual([]);
      expect(info.wa).toBe(WA_COUNT[path] ?? WA_COUNT.other);
      expect(info.share).toBe(SHARE_COUNT[path] ?? 0);
    });
  }
});

// ======================================================================
// Build: data blocks, labels, validation (desktop only: these run the build script)
// ======================================================================
// No digits in the fixtures: a parent quote, a teacher quote and a teacher line may not carry one.
const LETTER = ["א", "ב", "ג", "ד"];
const parent = (n, extra = {}) => ({ ref: `T0${n}`, audience: "parent", quote: `טקסט בדיקה ${LETTER[n - 1]}: הילד מגיע לשיעור בשמחה, ושואל יותר בכיתה.`, date: "2026-09", source: "whatsapp", consent: true, consentDate: "2026-09-20", shortened: false, rewarded: false, ...extra });
const tquote = (n, extra = {}) => ({ ...parent(n), ref: `T1${n}`, audience: "teacher", ...extra });
const teacher = (n, extra = {}) => ({ ref: `M0${n}`, name: ["דנה", "רון", "מיכל", "יעל"][n - 1], role: "מורה למתמטיקה", grades: ["ז", "ח", "ט"], line: `טקסט בדיקה ${LETTER[n - 1]}: אוהבת לראות ילד שמבין סוף סוף שברים.`, consent: true, ...extra });
const some = (f, n) => Array.from({ length: n }, (_, i) => f(i + 1));
const PAGES = ["index.html", "about/index.html", "method/index.html", "teachers/index.html", "faq/index.html", "teach/index.html", "contact/index.html", "terms/index.html", "privacy/index.html", "accessibility/index.html"];

// raw: { t, m } as verbatim file text, null to leave the file out; otherwise t and m are item lists.
function build({ t = [], m = [], raw = {}, cwd = process.cwd(), photoFiles = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bdnh-qa-"));
  const data = join(dir, "data"), out = join(dir, "dist");
  mkdirSync(data);
  if (raw.t !== null) writeFileSync(join(data, "testimonials.json"), raw.t ?? JSON.stringify({ items: t }));
  if (raw.m !== null) writeFileSync(join(data, "teachers.json"), raw.m ?? JSON.stringify({ items: m }));
  let run = cwd;
  if (photoFiles.length) {
    // The build looks for photos in ./src/assets/img/teachers, so give it a private copy of the site.
    run = join(dir, "site");
    cpSync(join(cwd, "src"), join(run, "src"), { recursive: true });
    cpSync(join(cwd, "scripts"), join(run, "scripts"), { recursive: true });
    mkdirSync(join(run, "src/assets/img/teachers"), { recursive: true });
    for (const f of photoFiles) writeFileSync(join(run, "src/assets/img/teachers", f), Buffer.from("not really a photo"));
  }
  const r = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: run, env: { ...process.env, SITE_DATA: data, SITE_DIST: out }, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, log: `${r.stdout}\n${r.stderr}`, out, read: (p) => readFileSync(join(out, p), "utf8"), has: (p) => existsSync(join(out, p)) };
}

test.describe("data blocks and build checks", () => {
  test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-chromium", "build checks run once"));

  test("each block has its own threshold of 3: 2 parent quotes and 2 cards stay hidden while 3 teacher quotes show", () => {
    const b = build({ t: [...some(parent, 2), ...some(tquote, 3)], m: some(teacher, 2) });
    expect(b.code, b.log).toBe(0);
    expect(b.read("index.html")).not.toContain('id="voices"');
    expect(b.read("teachers/index.html")).not.toContain('id="team"');
    expect(b.read("teach/index.html").match(/class="voice rv"/g)).toHaveLength(3);
    for (const p of PAGES) expect(b.read(p), `${p}: a link to the parent quotes that are not shown`).not.toContain("#voices");
    expect(b.has("testimonials.json")).toBe(false);
  });

  test("3 parent quotes and 3 cards show, 2 teacher quotes do not; the footer link is on every page", () => {
    const b = build({ t: [...some(parent, 3), ...some(tquote, 2)], m: some(teacher, 3) });
    expect(b.code, b.log).toBe(0);
    expect(b.read("index.html").match(/class="voice rv"/g)).toHaveLength(3);
    expect(b.read("teachers/index.html").match(/class="tcard rv"/g)).toHaveLength(3);
    expect(b.read("teach/index.html")).not.toContain('id="voices"');
    for (const p of PAGES) expect(b.read(p), `${p}: footer link to the quotes`).toMatch(/href="(?:\.\.\/)*(?:\.\/)?#voices"/);
  });

  test("only teacher quotes, only cards: the other blocks and the footer link stay out", () => {
    const b = build({ t: some(tquote, 3) });
    expect(b.code, b.log).toBe(0);
    expect(b.read("index.html")).not.toContain('id="voices"');
    expect(b.read("teach/index.html")).toContain('id="voices"');
    for (const p of PAGES) expect(b.read(p), p).not.toContain("#voices");
    const c = build({ m: some(teacher, 3) });
    expect(c.code, c.log).toBe(0);
    expect(c.read("teachers/index.html")).toContain('id="team"');
    expect(c.read("index.html")).not.toContain('id="voices"');
  });

  test("labels: one fixed label, the year only, sources, the shortened mark, reward note, escaping, grade ranges and the card initial", () => {
    const q = [
      parent(1, { date: "2026-01", source: "email", quote: "טקסט בדיקה: מורה מצוינת & הילד אוהב להגיע לשיעור." }),
      parent(2, { date: "2025-12", source: "whatsapp", rewarded: true, rewardNote: "קיבלנו מתנה קטנה על ההמלצה" }),
      parent(3, { date: "2026-09", source: "whatsapp", shortened: true, who: "אמא של תלמיד בכיתה ח׳" }),
    ];
    const m = [teacher(1, { grades: ["ח"] }), teacher(2, { grades: ["ט", "ז"] }), teacher(3, { grades: ["ו", "ז", "ח", "ט"] })];
    const b = build({ t: q, m });
    expect(b.code, b.log).toBe(0);
    const home = b.read("index.html");
    expect(home).toContain("<span>2026, במייל</span>");
    expect(home).toContain("<span>2025, בוואטסאפ</span>");
    expect(home).toContain("<span>2026, בוואטסאפ (בקיצור)</span>");
    expect(home.match(/\(בקיצור\)/g), "only the shortened quote is marked").toHaveLength(1);
    for (const month of ["ינואר", "דצמבר", "ספטמבר"]) expect(home, `no month name (${month})`).not.toContain(month);
    expect(home, "a per-item who label is ignored").not.toContain("אמא של תלמיד");
    expect(home.match(/<b>הורה לתלמיד או לתלמידה בכיתות ו׳ עד ט׳<\/b>/g), "one fixed label on every parent quote").toHaveLength(3);
    expect(home).toContain("קיבלנו מתנה קטנה על ההמלצה");
    expect(home.match(/<span>קיבלנו/g), "the reward note appears once").toHaveLength(1);
    expect(home).toContain("מורה מצוינת &amp; הילד");
    const team = b.read("teachers/index.html");
    expect(team).toContain("מורה למתמטיקה, כיתה ח׳");
    expect(team).toContain("מורה למתמטיקה, כיתות ז׳ וט׳");
    expect(team).toContain("מורה למתמטיקה, כיתות ו׳ עד ט׳");
    expect([...team.matchAll(/tcard-init" aria-hidden="true">([^<]*)</g)].map((x) => x[1])).toEqual(["ד", "ר", "מ"]);
  });

  test("a teacher photo with photoConsent is linked relative to the page and the file is copied", () => {
    const b = build({ m: [teacher(1, { photo: "dana.jpg", photoConsent: true }), teacher(2, { photoConsent: false }), teacher(3)], photoFiles: ["dana.jpg"] });
    expect(b.code, b.log).toBe(0);
    const html = b.read("teachers/index.html");
    const src = html.match(/<img class="tcard-img" src="([^"]+)"/)[1];
    expect(src).toBe("../assets/img/teachers/dana.jpg");
    expect(b.has(new URL(src, "http://x/teachers/").pathname.slice(1))).toBe(true);
    expect((html.match(/class="tcard-img tcard-init"/g) || []).length, "the cards with no photo keep the initial").toBe(2);
  });

  test("the built site never carries the private data files or the partials", () => {
    for (const f of ["owner.json", "testimonials.json", "teachers.json", "_partials"]) expect(existsSync(join(DIST, f)), `dist/${f}`).toBe(false);
    expect(readFileSync(join(DIST, "CNAME"), "utf8").trim()).toBe("ba-derech.com");
  });

  const BAD = [
    ["a duplicate quote ref", { t: [parent(1), parent(1), parent(3)] }, "duplicate ref"],
    ["an unknown audience", { t: [parent(1, { audience: "student" })] }, "audience must be"],
    ["a quote that is too short", { t: [parent(1, { quote: "קצר מדי" })] }, "allowed 20 to 320"],
    ["a quote that is too long", { t: [parent(1, { quote: "ארוך ".repeat(80) })] }, "allowed 20 to 320"],
    ["an unknown source", { t: [parent(1, { source: "sms" })] }, "source must be"],
    ["rewarded as text", { t: [parent(1, { rewarded: "yes" })] }, "rewarded must be true or false"],
    ["an email in a quote", { t: [parent(1, { quote: "טקסט בדיקה: כתבו לי ל dana@example.com בכל שעה" })] }, "email address or a link"],
    ["a link in a quote", { t: [parent(1, { quote: "טקסט בדיקה: ראו את הדף https://example.com שלהם" })] }, "email address or a link"],
    ["a tag in a quote", { t: [parent(1, { quote: "טקסט בדיקה: <b>מצוין</b> ומקצועי מאוד באמת" })] }, "< > {"],
    ["a quote ref in the wrong format", { t: [parent(1, { ref: "X01" })] }, "ref must look like T01"],
    ["a month that does not exist", { t: [parent(1, { date: "2026-13" })] }, "YYYY-MM"],
    ["a date with no month", { t: [parent(1, { date: "26-09" })] }, "YYYY-MM"],
    ["month zero (an old-looking date that sorts before today)", { t: [parent(1, { date: "2026-00" })] }, "YYYY-MM"],
    ["a one-digit month", { t: [parent(1, { date: "2025-9" })] }, "YYYY-MM"],
    ["a full date instead of year and month", { t: [parent(1, { date: "2025-09-15" })] }, "YYYY-MM"],
    ["the misspelling of ניסיון in a quote", { t: [parent(1, { quote: "טקסט בדיקה: שיעור נס" + "יון מצוין ומקצועי מאוד" })] }, "נס" + "יון"],
    ["a teacher quote that claims a degree", { t: [tquote(1, { quote: "טקסט בדיקה: כבוגרת תואר במתמטיקה אני נהנית ללמד כאן" })] }, "a credential, rank, years, pay or a number"],
    ["the site form as a quote source", { t: [parent(1, { source: "form" })] }, "source must be whatsapp or email"],
    ["a consentDate given as year and month only", { t: [parent(1, { consentDate: "2026-09" })] }, "consentDate must be"],
    ["shortened given as text", { t: [parent(1, { shortened: "yes" })] }, "shortened must be true or false"],
    ["a therapist in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: הפסיכולוגית שלו המליצה עליכם בחום" })] }, "a diagnosis, health or therapy detail"],
    ["a jump claim in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: הייתה אצלו קפיצה מטורפת השנה" })] }, "a result claim"],
    ["photoConsent given as text", { m: [teacher(1, { photoConsent: "yes" })] }, "photoConsent must be true or false"],
    ["pay in a teacher role", { m: [teacher(1, { role: "מורה עם שכר גבוה" })] }, "role: a credential"],
    ["an item that is not an object", { t: [null] }, "not an object"],
    ["teacher grades as text", { m: [teacher(1, { grades: "ח" })] }, "grades must be a list"],
    ["teacher grades empty", { m: [teacher(1, { grades: [] })] }, "grades must be a list"],
    ["a teacher grade that does not exist", { m: [teacher(1, { grades: ["י"] })] }, "grades must be a list"],
    ["a repeated teacher grade", { m: [teacher(1, { grades: ["ח", "ח"] })] }, "grades must be a list"],
    ["a teacher name in Latin letters", { m: [teacher(1, { name: "Dana" })] }, "Hebrew letters"],
    ["a one-letter teacher name", { m: [teacher(1, { name: "ד" })] }, "allowed 2 to 30"],
    ["a teacher line that is too short", { m: [teacher(1, { line: "קצר מדי" })] }, "allowed 20 to 160"],
    ["a teacher line that is too long", { m: [teacher(1, { line: "ארוך ".repeat(40) })] }, "allowed 20 to 160"],
    ["a teacher role that is too short", { m: [teacher(1, { role: "מו" })] }, "allowed 4 to 40"],
    ["a teacher ref in the wrong format", { m: [teacher(1, { ref: "M1" })] }, "ref must look like M01"],
    ["a duplicate teacher ref", { m: [teacher(1), teacher(1, { name: "רון" })] }, "duplicate ref"],
    ["a teacher photo name with a path", { m: [teacher(1, { photo: "../x.jpg" })] }, "photo must be a file name"],
    ["a teacher photo name in capitals", { m: [teacher(1, { photo: "Dana.JPG" })] }, "photo must be a file name"],
    ["a phone number in a teacher line", { m: [teacher(1, { line: "טקסט בדיקה: התקשרו אליי 050-1234567 בכל שעה" })] }, "phone number"],
    ["an em dash in a teacher line", { m: [teacher(1, { line: "טקסט בדיקה: אוהבת שברים \u2014 וגם אלגברה כיפית" })] }, "em dash"],
    ["a missing testimonials file", { raw: { t: null } }, "testimonials.json: missing"],
    ["a missing teachers file", { raw: { m: null } }, "teachers.json: missing"],
    ["testimonials that are not JSON", { raw: { t: "{ nope" } }, "not valid JSON"],
    ["teachers without an items list", { raw: { m: '{"people": []}' } }, 'needs {"items"'],
  ];
  // "Build failed" is the build's own report. A crash with a stack trace also exits 1 and may even mention the field,
  // so every case checks for the report and for the message that tells the owner what to fix.
  BAD.unshift(["a reward with no note", { t: [parent(1, { rewarded: true })] }, "rewardNote"]);
  for (const [name, data, message] of BAD) {
    test(`the build fails on ${name}, with a message that says what to fix`, () => {
      const b = build(data);
      expect(b.code, b.log).toBe(1);
      expect(b.log).toContain("Build failed");
      expect(b.log).toContain(message);
      expect(b.log, "no stack trace").not.toMatch(/\n\s+at .*\.mjs:\d+/);
    });
  }
});
