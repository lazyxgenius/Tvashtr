Calm, paper-friendly button — use for any action; reserve `primary` (solid coral) for the single most important action on a surface.

```jsx
<Button variant="primary" size="md" onClick={save}>Save changes</Button>
<Button variant="secondary">Cancel</Button>
<Button variant="ghost" iconLeft={<PlusIcon/>}>New thread</Button>
<Button variant="tint" loading>Working…</Button>
```

- `variant`: `primary` solid coral (one per view), `secondary` charcoal outline, `ghost` text-only, `tint` soft coral fill.
- `size`: `sm` 32px · `md` 40px · `lg` 48px.
- `iconLeft` / `iconRight` take icon nodes; `loading` swaps in a spinner; `fullWidth` stretches; pass `href` to render an `<a>`.
- Never stack two `primary` buttons together — calm hierarchy, not competing accents.
