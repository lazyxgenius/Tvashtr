# What Tvashtr stores

A plain list of what Tvashtr keeps and who else handles it. It is not a legal privacy policy.

## On Tvashtr's servers

Tvashtr keeps your work on its servers, most of it in its database, so it is there on every device
you sign in from.

- **Your account.** Your email address (for a GitHub sign-in: your GitHub email, or
  `<login>@users.noreply.github.com` when GitHub keeps it private), your GitHub user id and login,
  and a bcrypt hash of your password if you made one. Your session is a signed cookie; no session
  table is kept.
- **Your GitHub App installations.** Which installation ids belong to your account. GitHub access
  tokens are made on demand and never stored.
- **Your API keys.** Keys you add in Engines, encrypted at rest (Fernet); only their last four
  characters are kept readable, to show you which key it is. A key is decrypted only
  when Tvashtr calls that provider for you: to run your teams, read and answer from your Domains,
  learn and look up memories, answer questions about a run, and check at launch that a model still
  exists. Secrets you add for tools are stored the same way.
- **Your teams and runs.** Team graphs (agents, prompts, models, connections), runs, their event
  logs, the documents agents write (specs, reports), approvals, costs and warnings. Also, for a
  run without a repository, the files it produced (its diff); for each step that ran on your Mac,
  the diff it sent back; and for a run on a folder from Tvashtr Desktop, a git bundle of the result
  branch with its history. These stay with the run's record. A run on a GitHub repository leaves
  its changes on a branch and a pull request there.
- **Working copies of your code.** While a run is going, a copy of the code it works on sits on
  the server's disk. It is deleted when the run ends, except the files of a run without a
  repository that didn't ship, which are kept.
- **Your Domains.** Files you upload to a Domain (kept on the server's disk), and, in the database,
  the pieces and embeddings made from them, the questions you ask and their answers, and the
  evaluations you run.
- **Your toolkit and memory.** Tools and skills you save, and your memories: the ones you add and
  the lessons Tvashtr learns from your runs.
- **Plan status from Tvashtr Desktop.** Whether your Claude, Grok or Codex plan is connected on
  Desktop, when it last checked in, and a short account hint: your Claude plan's name (or "Signed
  in with an API key"), "Grok subscription" for Grok, and for Codex the email or sign-in method
  that `codex login status` prints. Never the login itself.
- **Work sent to or from Tvashtr Desktop.** When a step runs on your Mac, the step's workspace is
  sent to Desktop and its changes (a git diff) come back. When a team works in a folder on your Mac,
  a git bundle of the branch you chose, with its whole history, is uploaded for that run, and the
  folder's path (shown like `~/code/app`) is kept on the run. The upload is emptied once the run
  has copied it, or deleted after 24 hours if no run uses it.

## On your Mac (Tvashtr Desktop)

Stored in Tvashtr Desktop's own application-data folder:

- the last account that signed in on this Mac (its login and display name, and whether that login
  is a GitHub login), so the app can say "Last signed in as …" when a session ends;
- this Mac's first-run setup for each account that signed in here, keyed by your Tvashtr account id:
  the step you reached, when you agreed to use your plans on this Mac, and the project you chose (a
  GitHub repository name or a folder path);
- your Tvashtr session cookie;
- which plans you turned on or off;
- each plan's last status (encrypted with the Mac's keychain through Electron's `safeStorage`, or
  as plain text if that isn't available);
- the folders you recently chose for runs (their paths);
- a downloaded update, until it is installed;
- in the app page's own storage: the last team and run target you picked (which can be a folder
  path) and small view choices such as a list's sort order or a dismissed notice;
- GitHub's own sign-in cookies, if you connect GitHub from inside the app ("Connect GitHub" opens
  GitHub's pages in Tvashtr's window).

Step workspaces the Desktop runner uses are temporary and removed when the app starts.

## What Tvashtr never sees

- **Your Claude Code and Grok logins.** You sign in inside those tools, in Terminal. Tvashtr runs
  the tool you installed and never reads its login files.
- **Your GitHub password.** You type it only on GitHub's own page — in your browser, or in
  Tvashtr's window when you connect GitHub from Tvashtr Desktop. Tvashtr's code doesn't read it.

## Who else handles your data

Tvashtr hands your data to these services to do what you ask.

- **The model providers you add keys or plans for.** When an agent runs, Tvashtr sends its
  instructions, your idea, the spec, the other documents and memories it is given, and the code
  and files it works on to the provider of the model you picked for it (for example OpenAI, Anthropic, Google Gemini, xAI, Groq, DeepSeek or
  OpenRouter), using your key for that provider. Steps that run on your Claude or Grok plan go to
  Anthropic or xAI through the Claude Code or Grok you installed on your Mac. When you ask about a
  run, that run's record goes to the node's model.
- **Fly.io, where Tvashtr is hosted.** Tvashtr's server runs on Fly.io in Singapore. Steps that
  run on Tvashtr's servers work in a Fly.io machine made for that run: Tvashtr clones your code
  onto its own server and copies each step's files into that machine, which is deleted when the
  run ends. Agents in that machine can reach the internet (web and DNS ports only), so package registries
  and sites they contact see those requests. Tvashtr tries Singapore first, then Virginia (US), then
  Frankfurt.
- **Neon, where the database runs.** Tvashtr's database is a Postgres database run by Neon.
- **GitHub.** You sign in with GitHub. On the repositories where you install the Tvashtr GitHub
  App, Tvashtr clones the code for a run, pushes the run's branch and opens a pull request.
  Tvashtr Desktop downloads its updates from GitHub's release page.
- **The embeddings providers for Domains and memory.** The text of files you add to a Domain goes
  to that Domain's reading model (OpenAI, OpenRouter, Google Gemini or Hugging Face), and your
  questions go to its reading model and, with the matching passages from your files, to its answer
  model, with your keys. To learn lessons from a run, Tvashtr sends the run's activity to OpenAI
  (`gpt-4o-mini`) and stores each lesson with an OpenAI embedding (`text-embedding-3-small`), using
  your OpenAI key, or Tvashtr's own OpenAI key when you have none (if that call fails, Tvashtr
  retries through OpenRouter, Google Gemini Flash 1.5, with its own key). Memories you add or edit
  yourself are embedded with Tvashtr's own OpenAI key. While a run is going, when you have
  memories that could apply, each step's task (your idea, the agent's instructions and the spec's
  title) is sent to OpenAI to find them, with your OpenAI key.
- **Tools you add.** A tool server you give an agent receives the secrets you set for it and what
  the agent sends it when it calls that tool.
- **Google Fonts.** The website and Tvashtr Desktop load their fonts from Google's font servers,
  which see your IP address and browser.
