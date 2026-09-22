# Desktop distribution — Option 3 (unsigned Mac DMG + Releases + landing CTA)

**Decision:** Ship an **unsigned** Apple Silicon `.dmg` via **GitHub Releases**, and link it from the logged-out landing as **Download for Mac**. No Apple Developer ID / notarization / auto-update in this slice.

## Why option 3

| Option | Tradeoff |
|--------|----------|
| 1. Notarized DMG | Needs paid Apple Developer account + notarization secrets; slower first ship |
| 2. Mac App Store | Review friction; sandbox limits for CLI harnesses |
| **3. Unsigned DMG + Releases + landing CTA** | **Chosen** — free, fast, Gatekeeper “Open Anyway” once; good enough for founder/demo |

## Artifact contract

- File name (stable): `Tvashtr-mac.dmg`
- Landing / docs URL:  
  `https://github.com/lazyxgenius/Tvashtr/releases/latest/download/Tvashtr-mac.dmg`
- Arch: `arm64` (Apple Silicon)
- Code signing: **none** (`identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false`)

## Build locally (on a Mac)

```bash
cd desktop
npm ci
npm run pack:mac   # builds FE → dist-fe, then electron-builder DMG → desktop/release/
```

Output: `desktop/release/Tvashtr-mac.dmg`.

## Publish via GitHub Actions

Workflow: `.github/workflows/desktop-mac-release.yml`

```bash
# from a commit that includes this workflow + desktop packager
git tag desktop-v0.1.0
git push origin desktop-v0.1.0
```

Or run **Desktop Mac Release** → **workflow_dispatch** and pass a tag name.

The job runs on `macos-latest`, builds the unsigned DMG, and uploads it to a GitHub Release for that tag.

## User first-launch (Gatekeeper)

1. Download `Tvashtr-mac.dmg` from the landing CTA or Releases.
2. Open the DMG → drag **Tvashtr** to Applications.
3. First open: **right-click → Open** (or System Settings → Privacy & Security → Open Anyway).

## Landing CTA

`LandingPage` hero + closing sections link to `DESKTOP_MAC_DMG_URL` (`frontend/src/lib/desktopDownload.ts`). Auth CTAs are unchanged.

## Explicitly still not done

- Apple notarization / Developer ID signing
- Auto-update (electron-updater)
- Intel (`x64`) DMG
- Windows / Linux installers

## Enabling the GitHub Actions workflow (one-time)

Our bot token cannot push files under `.github/workflows/` (needs `workflow` scope).
Copy the checked-in template, then tag:

```bash
git fetch && git checkout feat/domains-eval-graph-polish && git pull
mkdir -p .github/workflows
cp docs/ci/desktop-mac-release.yml .github/workflows/desktop-mac-release.yml
git add .github/workflows/desktop-mac-release.yml
git commit -m "ci(desktop): enable unsigned Mac DMG Releases workflow"
git push origin feat/domains-eval-graph-polish

git tag desktop-v0.1.0
git push origin desktop-v0.1.0
# watch: https://github.com/lazyxgenius/Tvashtr/actions
```

Then fly-deploy this tip so landing **Download for Mac** is live.
