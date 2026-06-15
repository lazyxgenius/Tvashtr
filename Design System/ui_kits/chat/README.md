# Chat app — UI kit

A faithful interpretation of the Tvashtr desktop **chat app**: a calm, thread-based conversation surface.

`index.html` is an interactive click-through: sign in → land in the workspace → pick a thread or start a new one → send a message and get a (fake) reply.

### Screens / parts
- `ChatLogin.jsx` — centered sign-in card (logo, email/password, SSO).
- `ChatSidebar.jsx` — brand, "New thread", search, date-grouped thread list, account row.
- `ChatConversation.jsx` — thread header, message list (with empty state + suggestions), and the composer (`ChatComposer`) + message bubble (`ChatMessage`).
- `ChatApp.jsx` — stateful shell wiring login → app, thread switching, and send/reply.

### Composes
Design-system components via `window.DesignSystem_dbaa69`: `Button`, `IconButton`, `Input`, `Avatar`. Icons from `../_shared/Icons.jsx`. The brand mark is rendered from `assets/logo/`.

> Interpretation, not a recreation — no product source was provided. Treat layout and copy as a starting point.
