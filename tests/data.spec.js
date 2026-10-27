// Quotes and teacher cards: shown only with 3+ approved items, hidden with fewer, and a doubtful item fails the build.
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-chromium", "build checks run once"));

const parent = (n, extra = {}) => ({ ref: `T0${n}`, audience: "parent", quote: `טקסט בדיקה ${n}: הילד מגיע לשיעור בשמחה, ושואל יותר בכיתה.`, who: "אמא של תלמיד בכיתה ח׳", date: "2026-09", source: "whatsapp", consent: true, rewarded: false, ...extra });
const tquote = (n) => ({ ...parent(n), ref: `T1${n}`, audience: "teacher", who: "מורה בבדרך הנכונה" });
const teacher = (n, extra = {}) => ({ ref: `M0${n}`, name: ["דנה", "רון", "מיכל"][n - 1], role: "מורה למתמטיקה", grades: ["ז", "ח", "ט"], line: `טקסט בדיקה ${n}: אוהבת לראות ילד שמבין סוף סוף שברים.`, consent: true, ...extra });
const FULL = { t: [1, 2, 3].map((n) => parent(n)).concat([1, 2, 3].map(tquote)), m: [1, 2, 3].map((n) => teacher(n)) };

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

test("three of each: the sections render with the footer link, labels and grades", () => {
  const b = build(FULL);
  expect(b.code, b.log).toBe(0);
  const home = b.read("index.html");
  expect(home.match(/class="voice rv"/g)).toHaveLength(3);
  expect(home).toContain("ספטמבר 2026, בוואטסאפ");
  expect(home).toContain('href="#voices"');
  expect(b.read("method/index.html")).toContain('href="../#voices"');
  expect(b.read("teach/index.html").match(/class="voice rv"/g)).toHaveLength(3);
  const team = b.read("teachers/index.html");
  expect(team.match(/class="tcard rv"/g)).toHaveLength(3);
  expect(team).toContain("מורה למתמטיקה, כיתות ז׳ עד ט׳");
  expect(team).toContain("tcard-init");
});

const BAD = [
  ["no consent", { t: [parent(1, { consent: false }), parent(2), parent(3)] }, "consent must be true"],
  ["a name in the label", { t: [parent(1, { who: "דנה, אמא של יואב" })] }, "is not an allowed label"],
  ["an em dash", { t: [parent(1, { quote: "טקסט בדיקה: מורה מצוינת — ממליצה בחום לכולם" })] }, "em dash"],
  ["a child's name field", { t: [parent(1, { childName: "יואב" })] }, 'unknown field "childName"'],
  ["a date in the future", { t: [parent(1, { date: "2099-01" })] }, "not in the future"],
  ["a phone number", { t: [parent(1, { quote: "טקסט בדיקה: התקשרו אליי 050-1234567 בכל שעה" })] }, "phone number"],
  ["a price", { t: [parent(1, { quote: "טקסט בדיקה: שווה כל 300 ₪ שמשלמים בחודש" })] }, "a price"],
  ["a reward with no note", { t: [parent(1, { rewarded: true })] }, "rewardNote"],
  ["a teacher with no consent", { m: [teacher(1, { consent: undefined })] }, "consent must be true"],
  ["a teacher photo that does not exist", { m: [teacher(1, { photo: "nobody.jpg" })] }, "photo not found"],
  ["a teacher's age", { m: [teacher(1, { age: 34 })] }, 'unknown field "age"'],
];
for (const [name, data, message] of BAD) {
  test(`the build fails on ${name}`, () => {
    const b = build(data);
    expect(b.code, b.log).toBe(1);
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
