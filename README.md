# ba-derech.com

The brand site of בדרך הנכונה: small-group math lessons on Zoom for grades ו׳ to ט׳, for parents and for teachers. Static HTML, CSS and JavaScript, published with GitHub Pages. There is no form (owner's decision): every contact link opens WhatsApp with a prefilled message, or email; the share link (data-share) opens WhatsApp with no number. People who write in get replies only, never marketing.

- Plan and decisions (Hebrew): [docs/PLAN.md](docs/PLAN.md)
- Waiting on the owner: [docs/OWNER-TODO.md](docs/OWNER-TODO.md)

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

`src/testimonials.json` (quotes) and `src/teachers.json` (teacher cards) hold only what may appear on the site. The repo is public and git keeps every past version, so an item goes in only after written consent: deleting it later does not erase it from history. The original text, a screenshot of the consent and its date stay 7 years in the owner's private sheet, matched by `ref`, never in the repo. Both files start as `{"items": []}`, and their `_note` holds the consent request to send.

A quote (`testimonials.json`):
- `ref`: T and 2 or 3 digits, unique.
- `audience`: `parent` (shown on the home page) or `teacher` (shown on the teach page).
- `quote`: 20 to 320 characters, as written. No em dash (U+2014), no "נסיון", no phone number, price, email, link, `<`, `>`, `{` or `}`.
  - A parent quote also has no diagnosis, health or therapy detail (אבחון, אבחנה, ADHD, קשב, דיסלקציה, לקות, תרופה, ריטלין, חרדה, אוטיזם, פסיכולוג) and no result claim: no digit, %, ציון, שיפור, קפיצה or מצטיין.
  - A teacher quote has no credential, rank, years, pay or number (מוסמך, תואר, בוגר, מומחה, מצטיין, הטוב, שנות, שכר, הכנסה, מרוויח, any digit).
- The label is fixed, not per item: every parent quote shows "הורה לתלמיד או לתלמידה בכיתות ו׳ עד ט׳", every teacher quote "מורה בבדרך הנכונה". An old `who` field is ignored.
- `date`: `YYYY-MM` of the message, not in the future. Shown as the year only.
- `source`: `whatsapp` or `email`. Shown as "בוואטסאפ" or "במייל".
- `consent`: `true`. `consentDate`: the day of the written consent, `YYYY-MM-DD`, not in the future.
- `shortened`: `true` or `false`. If `true`, "(בקיצור)" shows next to the year.
- `rewarded`: `true` or `false`, true for any discount, free lesson, gift or draw given for the quote. If `true`, `rewardNote` (5 to 80 characters) is required and shown next to the quote.
- Any other field (a name, a child's name, video, phone) fails the build. The site has no Review or Rating structured data.

A teacher card (`teachers.json`):
- `ref`: M and 2 digits, unique.
- `name`: 2 to 30 characters, Hebrew letters, space, geresh, period or hyphen. First or full name, as the teacher approved.
- `role`: 4 to 40 characters, no credential, rank, years, pay or number (the teacher-quote rule above).
- `grades`: a non-empty list from ו, ז, ח, ט, no repeats. Shown as "כיתה ח׳", "כיתות ז׳ עד ט׳" or "כיתות ו׳ וח׳".
- `line`: 20 to 160 characters, same text rules as a teacher quote.
- `photo`: optional, and only with `photoConsent: true` (a separate consent to the photo); a photo without it fails the build. A file name in lowercase letters, digits and hyphens, `.jpg` or `.webp`, that exists in `src/assets/img/teachers/`. Square, at least 480 by 480, no children and no lesson screen. Without a photo the card shows the first letter of the name.
- `consent`: `true`.
- No age, degrees, years of experience or rating: any other field fails the build.

A block (parent quotes, teacher quotes, teacher cards) shows only with 3 or more approved items; with fewer, the section and every link to it are left out.
Any doubtful item fails the build with a message that says what to fix.
To remove an item: delete it from the file and push.

## Publish

Every push runs the tests and Lighthouse on GitHub Actions. A push to `main` that passes is published to GitHub Pages. `scripts/og.mjs` re-renders the link-share image from `scripts/og.html`.

## Domain

ba-derech.com is registered at Squarespace, which also serves its DNS. The business email (Google Workspace) uses its MX and SPF records: never change those. Pointing the site at GitHub Pages means only the apex A records and the www CNAME (see docs/OWNER-TODO.md).
