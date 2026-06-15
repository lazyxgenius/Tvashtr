Paper or panel surface — hairline border, large radius, generous padding. Prefer borders over shadows; reach for `raised` only when a card must float.

```jsx
<Card>Quiet paper card with a hairline border.</Card>
<Card variant="panel" pad="lg">Light-gray panel for grouped settings.</Card>
<Card variant="raised">Softly floating card.</Card>
<Card variant="inverse">Charcoal card with cream text.</Card>
<Card interactive onClick={open}>Clickable card.</Card>
```

- `variant`: `paper` (default), `panel`, `raised`, `inverse`. `pad`: `sm`/`md`/`lg`. `interactive` adds hover/press.
