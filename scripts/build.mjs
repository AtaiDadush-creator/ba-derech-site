// Builds dist/ from src/:
// - copies the site (without owner.json and _partials/),
// - fills {{owner:key}} facts from src/owner.json (missing ones become a visible placeholder on previews),
// - expands <!--#include name--> from src/_partials/ and {{base}} (relative path to the site root),
// - turns each data-wa message into a wa.me link and tells screen readers that it opens WhatsApp,
// - turns each data-share message into a WhatsApp share link with no number (the visitor picks the recipient),
// - renders quotes (src/testimonials.json) and teacher cards (src/teachers.json) into <!--#if key--> blocks,
//   drops a block and every link inside such markers when it has fewer than 3 approved items, and fails on a doubtful item,
// - fills {{home}}, and aria-current from data-route,
// - adds noindex until the real domain is set (src/CNAME), points share previews at the preview address meanwhile,
//   and refuses a real-domain build with missing facts,
// - fails on known content problems.
import { cp, mkdir, readdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { join, extname, relative, sep } from "node:path";

const SRC = "src";
const DIST = process.env.SITE_DIST || "dist"; // tests build fixtures into a temporary folder
const DATA = process.env.SITE_DATA || SRC;    // where testimonials.json and teachers.json are read from
const PHONE = "972559897869";
const SHARE = "https://wa.me/?text=";
const problems = [];
const missing = new Set();

const owner = JSON.parse(await readFile(join(SRC, "owner.json"), "utf8"));
const live = await access(join(SRC, "CNAME")).then(() => true, () => false);
const PREVIEW = "https://ataidadush-creator.github.io/ba-derech-site/";

// Hebrew placeholder shown on previews while a fact is missing.
const LABELS = {
  legalName: "שם בעל העסק", businessType: "עוסק מורשה / עוסק פטור / חברה", businessId: "מספר עוסק", address: "כתובת למכתבים",
  email: "מייל העסק", annualMonths: "מספר חודשים", lessonsPerMonth: "מספר שיעורים בחודש", paymentMethod: "אמצעי ומועד החיוב",
  cancelledLesson: "השלמה או זיכוי", onceWeeklyPlans: "באילו מסלולים",
  cancellationFee: "דמי ביטול: כן או לא", retention: "כמה זמן שומרים",
  processors: "ספקי שירות", accessibilityContact: "אחראי נגישות", accessibilityReplyDays: "מספר", accessibilityTested: "איך ומתי נבדק",
  studentsAsOf: "חודש ושנה", updated: "תאריך",
};

function fact(key) {
  const v = owner[key];
  if (v !== null && v !== undefined && v !== "") return esc(v); // owner.json text never becomes markup
  missing.add(key);
  return `<mark class="todo">[${LABELS[key] || key}]</mark>`;
}

function special(name) {
  if (name === "vat") {
    if (!owner.businessType) { missing.add("businessType"); return `<mark class="todo">[המחירים כוללים מע״מ / עוסק פטור]</mark>`; }
    return owner.businessType.includes("פטור") ? "עוסק פטור, אין תוספת מע״מ." : "המחירים כוללים מע״מ.";
  }
  problems.push(`unknown token {{${name}}}`);
  return "";
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

function checkHtml(file, html) {
  if (html.includes("\u2014")) problems.push(`${file}: em dash (U+2014)`);
  if (html.includes("נסיון")) problems.push(`${file}: spelling "נסיון" (use "ניסיון")`);
  if (/\{\{[^}]*\}\}|<!--#include/.test(html)) problems.push(`${file}: unexpanded token`);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) problems.push(`${file}: duplicate ids ${[...new Set(dup)].join(", ")}`);
  for (const [, target] of html.matchAll(/href="#([^"]*)"/g)) {
    if (target && !ids.includes(target)) problems.push(`${file}: link to missing #${target}`);
  }
  for (const [, ref] of html.matchAll(/aria-controls="([^"]+)"/g)) {
    if (!ids.includes(ref)) problems.push(`${file}: aria-controls points to missing #${ref}`);
  }
  const msgs = [...html.matchAll(/data-wa="([^"]*)"/g)].map((m) => m[1]);
  const dupMsg = msgs.filter((m, i) => msgs.indexOf(m) !== i);
  if (dupMsg.length) problems.push(`${file}: the same WhatsApp message is used twice: ${dupMsg[0]}`);
  if (/<!--#if |<!--\/if |<!--items /.test(html)) problems.push(`${file}: unmatched data block marker`);
  if (/\sdata-route=/.test(html)) problems.push(`${file}: data-route left in the page`);
}

function addWhatsAppLinks(html) {
  return html.replace(/<a ([^>]*?)data-wa="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (whole, before, msg, after, inner) => {
    const href = /\shref=/.test(" " + before + after) ? "" : `href="https://wa.me/${PHONE}?text=${encodeURIComponent(msg)}" `;
    return `<a ${before}${href}data-wa="${msg}"${after}>${inner}<span class="sr"> (נפתח בוואטסאפ)</span></a>`;
  });
}

// A share link: WhatsApp opens with the text and lets the visitor choose who gets it. No phone number, ours or anyone's.
function addShareLinks(html) {
  return html.replace(/<a ([^>]*?)data-share="([^"]*)"([^>]*)>([\s\S]*?)<\/a>/g, (whole, before, msg, after, inner) => {
    if (/\shref=|\sdata-wa=/.test(" " + before + after)) { problems.push(`a data-share link must not have href or data-wa: ${msg}`); return whole; }
    return `<a ${before}href="${SHARE}${encodeURIComponent(msg)}" data-share="${msg}"${after}>${inner}<span class="sr"> (נפתח בוואטסאפ)</span></a>`;
  });
}

const partials = {};
for (const f of await readdir(join(SRC, "_partials")).catch(() => [])) {
  partials[f.replace(/\.html$/, "")] = await readFile(join(SRC, "_partials", f), "utf8");
}

// ---------- Quotes and teacher cards ----------
// The repo is public and git keeps history: these files hold only what may appear on the site.
// Names, screenshots and the written consent stay in the owner's private sheet, by ref.
const MIN_ITEMS = 3;
// Quotes come from WhatsApp or email only.
const SOURCES = { whatsapp: "בוואטסאפ", email: "במייל" };
// One fixed label per audience, shown with the year only: a gender, a grade or a month could identify a child.
// An old per-item "who" is accepted and ignored.
const LABEL = { parent: "הורה לתלמיד או לתלמידה בכיתות ו׳ עד ט׳", teacher: "מורה בבדרך הנכונה" };
// A parent quote never carries health or diagnosis details, nor a result claim (a number, a grade, an improvement).
const SENSITIVE = /אבחון|אבחנה|ADHD|קשב|דיסלקצ|לקות|תרופ|ריטלין|חרדה|אוטיז|פסיכולוג/i;
const RESULTS = /\d|%|ציון|שיפור|קפיצה|מצטיין/;
// Teacher cards and teacher quotes never claim credentials, years, rank or pay.
const CLAIMS = /מוסמכ|תואר|בוגר|מומחה|מצטיין|הטוב|שנות|שכר|הכנסה|מרוויח|\d/;
const T_KEYS = ["ref", "audience", "quote", "who", "date", "source", "consent", "consentDate", "shortened", "rewarded", "rewardNote"];
const M_KEYS = ["ref", "name", "role", "grades", "line", "photo", "photoConsent", "consent"];
const GRADES = ["ו", "ז", "ח", "ט"];
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function readItems(name) {
  const raw = await readFile(join(DATA, name), "utf8").catch(() => null);
  if (raw === null) { problems.push(`${name}: missing (an empty list is {"items": []})`); return []; }
  let json;
  try { json = JSON.parse(raw); } catch (e) { problems.push(`${name}: not valid JSON (${e.message})`); return []; }
  if (!json || !Array.isArray(json.items)) { problems.push(`${name}: needs {"items": [...]}`); return []; }
  return json.items;
}

function checkText(where, s, min, max) {
  if (typeof s !== "string") return [`${where}: must be text`];
  const t = s.trim(), out = [];
  if (t.length < min || t.length > max) out.push(`${where}: ${t.length} characters, allowed ${min} to ${max}`);
  if (t.includes("\u2014")) out.push(`${where}: em dash (U+2014)`);
  if (t.includes("נסיון")) out.push(`${where}: spelling "נסיון" (use "ניסיון")`);
  if (/\d[\d\s-]{6,}\d/.test(t)) out.push(`${where}: looks like a phone number`);
  if (/₪|ש[״"]ח/.test(t)) out.push(`${where}: a price`);
  if (/@|https?:|www\./i.test(t)) out.push(`${where}: an email address or a link`);
  if (/[<>{}]/.test(t)) out.push(`${where}: < > { or }`);
  return out;
}

const unknownKeys = (where, item, allowed) =>
  Object.keys(item).filter((k) => !allowed.includes(k)).map((k) => `${where}: unknown field "${k}" (personal details never go in the repo)`);

// A real calendar day in YYYY-MM-DD, not after today.
const pastDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s && s <= new Date().toISOString().slice(0, 10);

function validTestimonials(items) {
  const ok = [], refs = new Set(), now = new Date().toISOString().slice(0, 7);
  items.forEach((t, i) => {
    const w = `testimonials.json item ${i + 1}${t && t.ref ? ` (${t.ref})` : ""}`;
    if (!t || typeof t !== "object" || Array.isArray(t)) { problems.push(`${w}: not an object`); return; }
    const quote = typeof t.quote === "string" ? t.quote : "";
    const p = [
      ...unknownKeys(w, t, T_KEYS),
      ...(/^T\d{2,3}$/.test(t.ref || "") ? [] : [`${w}: ref must look like T01`]),
      ...(refs.has(t.ref) ? [`${w}: duplicate ref`] : []),
      ...(has(LABEL, t.audience) ? [] : [`${w}: audience must be parent or teacher`]),
      ...checkText(`${w} quote`, t.quote, 20, 320),
      ...(t.audience === "parent" && SENSITIVE.test(quote) ? [`${w} quote: a diagnosis, health or therapy detail (never in a quote)`] : []),
      ...(t.audience === "parent" && RESULTS.test(quote) ? [`${w} quote: a result claim (a digit, %, ציון, שיפור, קפיצה or מצטיין)`] : []),
      ...(t.audience === "teacher" && CLAIMS.test(quote) ? [`${w} quote: a credential, rank, years, pay or a number`] : []),
      ...(/^\d{4}-(0[1-9]|1[0-2])$/.test(t.date || "") && t.date <= now ? [] : [`${w}: date must be YYYY-MM and not in the future`]),
      ...(has(SOURCES, t.source) ? [] : [`${w}: source must be whatsapp or email`]),
      ...(t.consent === true ? [] : [`${w}: consent must be true (the proof stays private, by ref)`]),
      ...(pastDay(t.consentDate) ? [] : [`${w}: consentDate must be the day of the written consent, YYYY-MM-DD, not in the future`]),
      ...(typeof t.shortened === "boolean" ? [] : [`${w}: shortened must be true or false (true shows "(בקיצור)")`]),
      ...(typeof t.rewarded === "boolean" ? [] : [`${w}: rewarded must be true or false`]),
      ...(t.rewarded === true ? checkText(`${w} rewardNote`, t.rewardNote, 5, 80) : []),
    ];
    refs.add(t.ref);
    if (p.length) problems.push(...p); else ok.push(t);
  });
  return ok;
}

async function validTeachers(items) {
  const ok = [], refs = new Set();
  for (const [i, m] of items.entries()) {
    const w = `teachers.json item ${i + 1}${m && m.ref ? ` (${m.ref})` : ""}`;
    if (!m || typeof m !== "object" || Array.isArray(m)) { problems.push(`${w}: not an object`); continue; }
    const p = [
      ...unknownKeys(w, m, M_KEYS),
      ...(/^M\d{2}$/.test(m.ref || "") ? [] : [`${w}: ref must look like M01`]),
      ...(refs.has(m.ref) ? [`${w}: duplicate ref`] : []),
      ...checkText(`${w} name`, m.name, 2, 30),
      ...(/^[א-ת'׳".\s-]+$/.test(m.name || "") ? [] : [`${w}: name in Hebrew letters`]),
      ...checkText(`${w} role`, m.role, 4, 40),
      ...(typeof m.role === "string" && CLAIMS.test(m.role) ? [`${w} role: a credential, rank, years, pay or a number`] : []),
      ...(Array.isArray(m.grades) && m.grades.length && m.grades.every((g) => GRADES.includes(g)) && new Set(m.grades).size === m.grades.length
        ? [] : [`${w}: grades must be a list like ["ז", "ח"]`]),
      ...checkText(`${w} line`, m.line, 20, 160),
      ...(typeof m.line === "string" && CLAIMS.test(m.line) ? [`${w} line: a credential, rank, years, pay or a number`] : []),
      ...(m.consent === true ? [] : [`${w}: consent must be true (the proof stays private, by ref)`]),
      ...(m.photoConsent === undefined || typeof m.photoConsent === "boolean" ? [] : [`${w}: photoConsent must be true or false`]),
    ];
    if (m.photo !== undefined && m.photo !== null) {
      if (m.photoConsent !== true) p.push(`${w}: a photo needs photoConsent: true (a separate, written consent to the photo)`);
      if (!/^[a-z0-9-]+\.(jpg|webp)$/.test(String(m.photo))) p.push(`${w}: photo must be a file name like dana.jpg`);
      else if (!(await access(join(SRC, "assets", "img", "teachers", m.photo)).then(() => true, () => false))) p.push(`${w}: photo not found in src/assets/img/teachers/`);
    }
    refs.add(m.ref);
    if (p.length) problems.push(...p); else ok.push(m);
  }
  return ok;
}

function gradesLabel(gs) {
  const idx = gs.map((g) => GRADES.indexOf(g)).sort((a, b) => a - b);
  const names = idx.map((i) => GRADES[i] + "׳");
  if (names.length === 1) return `כיתה ${names[0]}`;
  const run = idx.every((v, k) => k === 0 || v === idx[k - 1] + 1);
  return run ? `כיתות ${names[0]} עד ${names[names.length - 1]}` : `כיתות ${names.slice(0, -1).join(", ")} ו${names[names.length - 1]}`;
}

const voiceCard = (t) =>
  `<li class="voice rv"><figure><blockquote><p>${esc(t.quote.trim())}</p></blockquote>` +
  `<figcaption><b>${LABEL[t.audience]}</b><span>${t.date.slice(0, 4)}, ${SOURCES[t.source]}${t.shortened ? " (בקיצור)" : ""}</span>` +
  `${t.rewarded ? `<span>${esc(t.rewardNote.trim())}</span>` : ""}</figcaption></figure></li>`;

// A photo only with photoConsent (validation already fails a photo without it); otherwise the first letter of the name.
const teacherCard = (m) =>
  `<li class="tcard rv">` +
  (m.photo && m.photoConsent === true
    ? `<img class="tcard-img" src="{{base}}assets/img/teachers/${m.photo}" alt="" width="480" height="480" loading="lazy">`
    : `<span class="tcard-img tcard-init" aria-hidden="true">${esc(m.name.trim()[0])}</span>`) +
  `<h3>${esc(m.name.trim())}</h3><p class="tcard-role">${esc(m.role.trim())}, ${gradesLabel(m.grades)}</p><p>${esc(m.line.trim())}</p></li>`;

const quotes = validTestimonials(await readItems("testimonials.json"));
const team = await validTeachers(await readItems("teachers.json"));
const BLOCKS = {
  "voices-parent": quotes.filter((t) => t.audience === "parent").map(voiceCard),
  "voices-teacher": quotes.filter((t) => t.audience === "teacher").map(voiceCard),
  team: team.map(teacherCard),
};

// <!--#if key-->...<!--/if key-->: kept (with <!--items key--> filled) only when the key has MIN_ITEMS or more.
// Runs before checkHtml, so a link left pointing at a dropped section fails the build.
function expandBlocks(file, html) {
  return html.replace(/<!--#if ([\w-]+)-->([\s\S]*?)<!--\/if \1-->/g, (m, key, inner) => {
    if (!has(BLOCKS, key)) { problems.push(`${file}: unknown block ${key}`); return ""; }
    if (BLOCKS[key].length < MIN_ITEMS) return "";
    return inner.split(`<!--items ${key}-->`).join(BLOCKS[key].join(""));
  });
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
const PRIVATE = ["owner.json", "testimonials.json", "teachers.json"];
await cp(SRC, DIST, {
  recursive: true,
  filter: (p) => !PRIVATE.some((f) => p.endsWith(sep + f)) && !p.split(sep).includes("_partials"),
});
await writeFile(join(DIST, ".nojekyll"), "");

for (const file of await walk(DIST)) {
  if (extname(file) !== ".html") continue;
  const parts = relative(DIST, file).split(sep);
  // 404.html is served at whatever path was asked for (/a/b/c/), so its links start from the site root.
  // That works on the real domain, where the site sits at the root.
  const base = parts.join("/") === "404.html" ? "/" : parts.length > 1 ? "../".repeat(parts.length - 1) : "";
  const route = parts.slice(0, -1).map((s) => s + "/").join(""); // "" for home, "method/" for method/index.html
  let html = await readFile(file, "utf8");
  // Partials may include other partials, so expand a few levels deep.
  for (let level = 0; level < 3 && html.includes("<!--#include "); level++) {
    html = html.replace(/<!--#include ([\w-]+)-->/g, (m, name) => {
      if (!(name in partials)) { problems.push(`${file}: missing partial ${name}`); return ""; }
      return partials[name].trim();
    });
  }
  html = expandBlocks(file, html);
  html = html
    .replace(/\{\{base\}\}/g, base)
    .replace(/\{\{home\}\}/g, base || "./")
    .replace(/\{\{owner:(\w+)\}\}/g, (m, key) => fact(key))
    .replace(/\{\{(vat)\}\}/g, (m, name) => special(name))
    .replace(/ data-route="([^"]*)"/g, (m, r) => (r === route ? ' aria-current="page"' : ""));
  if (!live && !html.includes('name="robots"')) {
    html = html.replace("</title>", '</title>\n<meta name="robots" content="noindex">');
  }
  // Until the domain points here, a shared link must preview from the address that actually serves the image.
  if (!live) html = html.replace(/(<meta (?:property|name)="(?:og:url|og:image|twitter:image)" content=")https:\/\/ba-derech\.com\//g, `$1${PREVIEW}`);
  checkHtml(file, html);
  await writeFile(file, addShareLinks(addWhatsAppLinks(html)));
}

if (missing.size) {
  const list = [...missing].map((k) => `${k} (${LABELS[k] || k})`).join(", ");
  if (live) problems.push(`src/CNAME is set (real domain) but owner facts are missing: ${list}`);
  else console.warn(`Preview build: owner facts still missing, shown as yellow placeholders: ${list}`);
}
if (problems.length) {
  console.error("Build failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`Data: ${BLOCKS["voices-parent"].length} parent quotes, ${BLOCKS["voices-teacher"].length} teacher quotes, ${BLOCKS.team.length} teacher cards (each block shows at ${MIN_ITEMS} or more).`);
console.log(`Built dist/ (${live ? "real domain" : "preview, noindex"})`);
