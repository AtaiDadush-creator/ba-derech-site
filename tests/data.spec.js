// Quotes and teacher cards: shown only with 3+ approved items, hidden with fewer, and a doubtful item fails the build.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-chromium", "build checks run once"));

// Test texts start with "טקסט בדיקה" so nobody takes them for real quotes. No digits: a parent quote may not carry one.
const N = ["א", "ב", "ג"];
const PARENT_LABEL = "הורה לתלמיד או לתלמידה בכיתות ו׳ עד ט׳";
const TEACHER_LABEL = "מורה בבדרך הנכונה";
const parent = (n, extra = {}) => ({ ref: `T0${n}`, audience: "parent", quote: `טקסט בדיקה ${N[n - 1]}: הילד מגיע לשיעור בשמחה, ושואל יותר בכיתה.`, date: "2026-09", source: "whatsapp", consent: true, consentDate: "2026-09-20", shortened: false, rewarded: false, ...extra });
const tquote = (n, extra = {}) => ({ ...parent(n), ref: `T1${n}`, audience: "teacher", ...extra });
const teacher = (n, extra = {}) => ({ ref: `M0${n}`, name: ["דנה", "רון", "מיכל"][n - 1], role: "מורה למתמטיקה", grades: ["ז", "ח", "ט"], line: `טקסט בדיקה ${N[n - 1]}: אוהבת לראות ילד שמבין סוף סוף שברים.`, consent: true, ...extra });
const FULL = { t: [1, 2, 3].map((n) => parent(n)).concat([1, 2, 3].map((n) => tquote(n))), m: [1, 2, 3].map((n) => teacher(n)) };

function build({ t = [], m = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bdnh-site-"));
  const data = join(dir, "data"), out = join(dir, "dist");
  mkdirSync(data);
  writeFileSync(join(data, "testimonials.json"), JSON.stringify({ items: t }));
  writeFileSync(join(data, "teachers.json"), JSON.stringify({ items: m }));
  const r = spawnSync(process.execPath, ["scripts/build.mjs"], { env: { ...process.env, SITE_DATA: data, SITE_DIST: out }, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, log: `${r.stdout}\n${r.stderr}`, out, read: (p) => readFileSync(join(out, p), "utf8") };
}

test("empty data: no quotes, no teacher cards, and no link to #voices on any page", () => {
  const b = build();
  expect(b.code, b.log).toBe(0);
  expect(b.read("index.html")).not.toContain('id="voices"');
  expect(b.read("teach/index.html")).not.toContain('id="voices"');
  expect(b.read("teachers/index.html")).not.toContain('id="team"');
  for (const p of ["index.html", "method/index.html", "contact/index.html", "privacy/index.html"]) expect(b.read(p), p).not.toContain("#voices");
  expect(existsSync(join(b.out, "testimonials.json"))).toBe(false);
  expect(existsSync(join(b.out, "teachers.json"))).toBe(false);
});

test("two approved quotes are still hidden", () => {
  const b = build({ t: [parent(1), parent(2)] });
  expect(b.code, b.log).toBe(0);
  expect(b.read("index.html")).not.toContain('id="voices"');
});

test("three of each: the sections render with the footer link, one fixed label per audience, the year only, and grades", () => {
  const b = build(FULL);
  expect(b.code, b.log).toBe(0);
  const home = b.read("index.html");
  expect(home.match(/class="voice rv"/g)).toHaveLength(3);
  expect(home.split(`<b>${PARENT_LABEL}</b>`)).toHaveLength(4);
  expect(home).toContain("<span>2026, בוואטסאפ</span>");
  expect(home, "no month name").not.toContain("ספטמבר");
  expect(home, "not shortened").not.toContain("(בקיצור)");
  expect(home).toContain('href="#voices"');
  expect(b.read("method/index.html")).toContain('href="../#voices"');
  const teach = b.read("teach/index.html");
  expect(teach.match(/class="voice rv"/g)).toHaveLength(3);
  expect(teach.split(`<b>${TEACHER_LABEL}</b>`)).toHaveLength(4);
  const team = b.read("teachers/index.html");
  expect(team.match(/class="tcard rv"/g)).toHaveLength(3);
  expect(team).toContain("מורה למתמטיקה, כיתות ז׳ עד ט׳");
  expect(team).toContain("tcard-init");
  // No review or rating markup, ever.
  for (const p of ["index.html", "teach/index.html", "teachers/index.html"]) expect(b.read(p), p).not.toMatch(/"Review"|AggregateRating|ratingValue|itemprop="review/);
});

test("a shortened quote shows (בקיצור); an old per-item who label is ignored, never shown", () => {
  const b = build({ t: [parent(1, { shortened: true, who: "דנה, אמא של יואב בכיתה ח׳" }), parent(2), parent(3)] });
  expect(b.code, b.log).toBe(0);
  const home = b.read("index.html");
  expect(home.match(/\(בקיצור\)/g)).toHaveLength(1);
  expect(home).not.toContain("יואב");
  expect(home.split(`<b>${PARENT_LABEL}</b>`)).toHaveLength(4);
});

const BAD = [
  ["no consent", { t: [parent(1, { consent: false }), parent(2), parent(3)] }, "consent must be true"],
  ["an em dash", { t: [parent(1, { quote: "טקסט בדיקה: מורה מצוינת \u2014 ממליצה בחום לכולם" })] }, "em dash"],
  ["a child's name field", { t: [parent(1, { childName: "יואב" })] }, 'unknown field "childName"'],
  ["a date in the future", { t: [parent(1, { date: "2099-01" })] }, "not in the future"],
  ["a phone number", { t: [parent(1, { quote: "טקסט בדיקה: התקשרו אליי 050-1234567 בכל שעה" })] }, "phone number"],
  ["a price", { t: [parent(1, { quote: "טקסט בדיקה: שווה כל 300 ₪ שמשלמים בחודש" })] }, "a price"],
  ["a reward with no note", { t: [parent(1, { rewarded: true })] }, "rewardNote"],
  ["a diagnosis in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: מאז האבחון הוא מרגיש בטוח יותר בכיתה" })] }, "a diagnosis, health or therapy detail"],
  ["ADHD in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: עם ה-adhd שלו זה המקום הראשון שעבד" })] }, "a diagnosis, health or therapy detail"],
  ["medication in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: גם בלי ריטלין הוא מצליח להתרכז בשיעור" })] }, "a diagnosis, health or therapy detail"],
  ["a number in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: עלה מ-60 ל-90 במבחן האחרון שלו" })] }, "a result claim"],
  ["a percent sign in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: מאה % מרוצים מהמורה ומהקבוצה" })] }, "a result claim"],
  ["a grade word in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: הציון האחרון שלו ממש שימח אותנו" })] }, "a result claim"],
  ["an improvement claim in a parent quote", { t: [parent(1, { quote: "טקסט בדיקה: רואים אצלו שיפור גדול בהבנה של החומר" })] }, "a result claim"],
  ["the site form as a source", { t: [parent(1, { source: "form" })] }, "source must be whatsapp or email"],
  ["a quote with no consentDate", { t: [parent(1, { consentDate: undefined })] }, "consentDate must be"],
  ["a consentDate in the future", { t: [parent(1, { consentDate: "2099-01-01" })] }, "consentDate must be"],
  ["a consentDate that is not a real day", { t: [parent(1, { consentDate: "2026-02-30" })] }, "consentDate must be"],
  ["a quote with no shortened flag", { t: [parent(1, { shortened: undefined })] }, "shortened must be true or false"],
  ["a teacher quote that states pay", { t: [tquote(1, { quote: "טקסט בדיקה: כאן אני מרוויח יותר מבכל מקום אחר" })] }, "a credential, rank, years, pay or a number"],
  ["a teacher with no consent", { m: [teacher(1, { consent: undefined })] }, "consent must be true"],
  ["a teacher photo that does not exist", { m: [teacher(1, { photo: "nobody.jpg", photoConsent: true })] }, "photo not found"],
  ["a teacher photo without photoConsent", { m: [teacher(1, { photo: "nobody.jpg" })] }, "a photo needs photoConsent: true"],
  ["a teacher photo with photoConsent false", { m: [teacher(1, { photo: "nobody.jpg", photoConsent: false })] }, "a photo needs photoConsent: true"],
  ["a credential in a teacher role", { m: [teacher(1, { role: "מורה מוסמכת למתמטיקה" })] }, "role: a credential"],
  ["years in a teacher line", { m: [teacher(1, { line: "טקסט בדיקה: מלמדת כבר הרבה שנות לימוד בבתי ספר" })] }, "line: a credential"],
  ["a number in a teacher line", { m: [teacher(1, { line: "טקסט בדיקה: מלמדת שלוש קבוצות, ועוד 2 בקיץ" })] }, "line: a credential"],
  ["a teacher's age", { m: [teacher(1, { age: 34 })] }, 'unknown field "age"'],
];
for (const [name, data, message] of BAD) {
  test(`the build fails on ${name}`, () => {
    const b = build(data);
    expect(b.code, b.log).toBe(1);
    expect(b.log).toContain("Build failed");
    expect(b.log).toContain(message);
  });
}

test("filled sections pass axe in light and dark", async ({ page }) => {
  const b = build(FULL);
  expect(b.code, b.log).toBe(0);
  const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2" };
  await page.route("http://localhost:4173/**", (route) => {
    let p = decodeURIComponent(new URL(route.request().url()).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = join(b.out, p);
    if (!existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, body: readFileSync(f), headers: { "content-type": TYPES[extname(f)] || "application/octet-stream" } });
  });
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    for (const path of ["/", "/teachers/", "/teach/"]) {
      await page.goto(path);
      const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(r.violations.map((v) => v.id), `${path} ${colorScheme}`).toEqual([]);
    }
  }
});
