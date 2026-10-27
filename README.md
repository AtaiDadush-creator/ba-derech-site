# ba-derech.com

The brand site of בדרך הנכונה: small-group math lessons on Zoom for grades ו׳ to ט׳, for parents and for teachers. Static HTML, CSS and JavaScript, published with GitHub Pages. Contact links open WhatsApp with a prefilled message; the share link (data-share) opens WhatsApp with no number.

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

## Publish

Every push runs the tests and Lighthouse on GitHub Actions. A push to `main` that passes is published to GitHub Pages. `scripts/og.mjs` re-renders the link-share image from `scripts/og.html`.

## Domain

ba-derech.com is registered at Squarespace, which also serves its DNS. The business email (Google Workspace) uses its MX and SPF records: never change those. Pointing the site at GitHub Pages means only the apex A records and the www CNAME (see docs/OWNER-TODO.md).
