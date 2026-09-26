# What Tvashtr stores

> **Interim page — not a privacy policy.** This is a factual list written from Tvashtr's code
> (September 2026) so the "Privacy" link in Tvashtr Desktop points somewhere true. The operator's
> privacy statement replaces it.

## On Tvashtr's servers

Tvashtr keeps your work in its database so it is there on every device you sign in from.

- **Your account.** Your email address (for a GitHub sign-in: your GitHub email, or
  `<login>@users.noreply.github.com` when GitHub keeps it private), your GitHub user id and login,
  and a bcrypt hash of your password if you made one. Your session is a signed cookie; no session
  table is kept.
- **Your GitHub App installations.** Which installation ids belong to your account. GitHub access
  tokens are made on demand and never stored.
- **Your API keys.** Keys you add in Engines, encrypted at rest (Fernet), and only decrypted to run
  your own teams. Secrets you add for tools are stored the same way.
- **Your teams and runs.** Team graphs (agents, prompts, models, connections), runs, their event
  logs, the documents agents write (specs, reports), approvals, costs and warnings.
- **Your Domains.** Files you upload to a Domain, the pieces and embeddings made from them, and
  the questions and evaluations you run.
- **Your toolkit and memory.** Tools, skills and memories you save.
- **Plan status from Tvashtr Desktop.** Whether your Claude or Grok plan is connected on Desktop
  and when it last checked in — never the login itself.
- **Work sent to or from Tvashtr Desktop.** When a step runs on your Mac, the step's workspace is
  sent to Desktop and its changes (a git diff) come back. When a team works in a folder on your Mac,
  a git bundle of the branch you chose is uploaded for that run.

## On your Mac (Tvashtr Desktop)

Stored in Tvashtr Desktop's own application-data folder:

- the last account that signed in on this Mac (GitHub login and display name only), so the app
  can say "Last signed in as …" when a session ends;
- your Tvashtr session cookie;
- which plans you turned on or off;
- each plan's last status (encrypted with the Mac's keychain through Electron's `safeStorage`);
- the folders you recently chose for runs (their paths).

Step workspaces the Desktop runner uses are temporary and removed when the app starts.

## What Tvashtr never sees

- **Your Claude Code and Grok logins.** You sign in inside those tools, in Terminal. Tvashtr runs
  the tool you installed and never reads its login files.
- **Your browser's GitHub password.** Signing in happens on GitHub's own page.
