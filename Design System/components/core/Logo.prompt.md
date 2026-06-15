Brand lockup — the rosette mark with an optional serif wordmark. Use in headers/nav, app icons, and sparse loading/empty-state motifs.

```jsx
<Logo tone="coral" size={32} />
<Logo tone="charcoal" showWordmark={false} />
<Logo tone="cream" inverse markSrc="../assets/logo/mark-cream.png" />
```

- `tone`: `coral` (default brand), `charcoal` (quiet mono), `cream` (on dark/coral). Color is the ONLY change allowed to the mark — never redraw it.
- Set `markSrc` to the correct relative path to the PNG from wherever you render. Use `inverse` for the wordmark color on dark surfaces.
