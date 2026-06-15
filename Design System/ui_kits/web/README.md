# Web app — UI kit

The Tvashtr **marketing web app** — a quiet, editorial landing page for the suite.

`index.html` renders the full page: sticky nav, hero, product-surfaces grid, an editorial quote band on charcoal, and a footer.

### Parts (all in `WebKit.jsx`)
- `WebNav` — blurred sticky nav with brand, links, sign-in + primary CTA.
- `WebHero` — large serif headline, lead, CTAs, trust line.
- `WebSurfaces` — three-column grid of `SurfaceCard`s for the five surfaces + field notes.
- `WebQuote` — charcoal editorial band with the mark.
- `WebFooter` — brand blurb + link columns + base row.

### Composes
`window.DesignSystem_dbaa69`: `Button`, `Card`, `Badge`. Icons from `../_shared/Icons.jsx`; mark from `assets/logo/`.

> Interpretation, not a recreation — copy and structure are a calm default to build on.
