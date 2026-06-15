Square icon-only button for toolbars, message composers, and dense controls — always pass `aria-label`.

```jsx
<IconButton aria-label="Attach file"><PaperclipIcon/></IconButton>
<IconButton variant="outline" aria-label="Settings"><GearIcon/></IconButton>
<IconButton variant="solid" aria-label="Send"><ArrowUpIcon/></IconButton>
<IconButton active aria-label="Pin"><PinIcon/></IconButton>
```

- `variant`: `ghost` (default), `outline`, `solid` (coral). `active` gives a coral tint for toggles.
- Sizes `sm`/`md`/`lg` match Button heights (32/40/48px).
