# ba-derech.com

The brand site of בדרך הנכונה: small-group math lessons on Zoom for grades ו׳ to ט׳, for parents and for teachers. Static HTML, CSS and JavaScript, published with GitHub Pages. Contact links open WhatsApp with a prefilled message; the share link (data-share) opens WhatsApp with no number.

- Plan and decisions (Hebrew): [docs/PLAN.md](docs/PLAN.md)
- Waiting on the owner: [docs/OWNER-TODO.md](docs/OWNER-TODO.md)
- The contact form's Apps Script and how to deploy it (Hebrew): [docs/LEADS-SETUP.md](docs/LEADS-SETUP.md), code in `tools/leads-apps-script/Code.gs`

## Work on it

```bash
npm ci
npx playwright install chromium webkit
npm run build      # src/ -> dist/, adds the wa.me links, fails on known content problems
npm run serve      # http://localhost:4173
npm test           # build + browser tests (phones, tablet, desktop; Chromium and Safari; light and dark)
npm run validate   # HTML validation of dist/
```

Edit files in `src/` only. WhatsApp links are written as `<a class="btn wa" data-wa="the message">` and get their `href` at build time. Each message must be distinct: the wording tells the owner which button brought the lead.

## Quotes and teacher cards

`src/testimonials.json` (quotes) and `src/teachers.json` (teacher cards) hold only what may appear on the site: the repo is public. Real names, screenshots and the written consent stay in the owner's private sheet, matched by `ref`. Both files start as `{"items": []}`.

A quote (`testimonials.json`):
- `ref`: T and 2 or 3 digits, unique.
- `audience`: `parent` (shown on the home page) or `teacher` (shown on the teach page).
- `quote`: 20 to 320 characters, as written (shortened only without changing the meaning). No em dash (U+2014), no "נסיון", no phone number, price, email, link, `<`, `>`, `{` or `}`.
- `who`: for a parent only `(אמא|אבא|הורה|סבתא|סבא) של (תלמיד|תלמידה) בכיתה [וזחט]׳`; for a teacher only `מורה בבדרך הנכונה`.
- `date`: `YYYY-MM`, not in the future. Shown as "נובמבר 2026".
- `source`: `whatsapp`, `email` or `form`. Shown as "בוואטסאפ", "במייל", "בטופס באתר".
- `consent`: `true`.
- `rewarded`: `true` or `false`. If `true`, `rewardNote` (5 to 80 characters) is required and shown next to the quote.
- Any other field (a name, a child's name, video, phone) fails the build.

A teacher card (`teachers.json`):
- `ref`: M and 2 digits, unique.
- `name`: 2 to 30 characters, Hebrew letters, space, geresh, period or hyphen. First or full name, as the teacher approved.
- `role`: 4 to 40 characters.
- `grades`: a non-empty list from ו, ז, ח, ט, no repeats. Shown as "כיתה ח׳", "כיתות ז׳ עד ט׳" or "כיתות ו׳ וח׳".
- `line`: 20 to 160 characters, same text rules as `quote`.
- `photo`: optional. A file name in lowercase letters, digits and hyphens, `.jpg` or `.webp`, that exists in `src/assets/img/teachers/`. Square, at least 480 by 480, no children and no lesson screen. Without a photo the card shows the first letter of the name.
- `consent`: `true`.
- No age, degrees, years of experience or rating: any other field fails the build.

A block (parent quotes, teacher quotes, teacher cards) shows only with 3 or more approved items; with fewer, the section and every link to it are left out.
Any doubtful item fails the build with a message that says what to fix.
To remove an item: delete it from the file and push.

## Publish

Every push runs the tests and Lighthouse on GitHub Actions. A push to `main` that passes is published to GitHub Pages. `scripts/og.mjs` re-renders the link-share image from `scripts/og.html`.

## Domain

ba-derech.com is registered at Squarespace, which also serves its DNS. The business email (Google Workspace) uses its MX and SPF records: never change those. Pointing the site at GitHub Pages means only the apex A records and the www CNAME (see docs/OWNER-TODO.md).
