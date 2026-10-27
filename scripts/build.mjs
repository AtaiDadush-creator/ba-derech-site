// Builds dist/ from src/:
// - copies the site (without owner.json and _partials/),
// - fills {{owner:key}} facts from src/owner.json (missing ones become a visible placeholder on previews),
// - expands <!--#include name--> from src/_partials/ and {{base}} (relative path to the site root),
// - turns each data-wa message into a wa.me link and tells screen readers that it opens WhatsApp,
// - turns each data-share message into a WhatsApp share link with no number (the visitor picks the recipient),
// - adds noindex until the real domain is set (src/CNAME), points share previews at the preview address meanwhile,
//   and refuses a real-domain build with missing facts,
// - fails on known content problems.
import { cp, mkdir, readdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { join, extname, relative, sep } from "node:path";

const SRC = "src";
const DIST = "dist";
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
  if (v !== null && v !== undefined && v !== "") return String(v);
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

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(SRC, DIST, {
  recursive: true,
  filter: (p) => !p.endsWith("owner.json") && !p.split(sep).includes("_partials"),
});
await writeFile(join(DIST, ".nojekyll"), "");

for (const file of await walk(DIST)) {
  if (extname(file) !== ".html") continue;
  const depth = relative(DIST, file).split(sep).length - 1;
  const base = depth ? "../".repeat(depth) : "";
  let html = await readFile(file, "utf8");
  // Partials may include other partials, so expand a few levels deep.
  for (let level = 0; level < 3 && html.includes("<!--#include "); level++) {
    html = html.replace(/<!--#include ([\w-]+)-->/g, (m, name) => {
      if (!(name in partials)) { problems.push(`${file}: missing partial ${name}`); return ""; }
      return partials[name].trim();
    });
  }
  html = html
    .replace(/\{\{base\}\}/g, base)
    .replace(/\{\{owner:(\w+)\}\}/g, (m, key) => fact(key))
    .replace(/\{\{(vat)\}\}/g, (m, name) => special(name));
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
console.log(`Built dist/ (${live ? "real domain" : "preview, noindex"})`);
