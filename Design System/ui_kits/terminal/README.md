# Weave CLI — UI kit

The Tvashtr **terminal / CLI developer tool**, "weave". A paper window chrome wrapping a charcoal terminal: coral prompt, sage success, blue agent voice, IBM Plex Mono throughout.

`index.html` is interactive — type commands at the prompt:
- `help` · `weave build` · `threads` · `status` · `chat "…"` · `clear`

### Parts
- `TerminalKit.jsx` — the whole surface: title bar (window lights + tabs), scrolling body, live input prompt, and status bar. `runCommand()` holds the fake command responses.

### Composes
Icons from `../_shared/Icons.jsx` and tokens from `styles.css`. This kit is intentionally token-only (no React DS components) since a terminal is mostly type + color.

> Interpretation, not a recreation. Dark surface uses the brand charcoal `--ink-900`, never pure black.
