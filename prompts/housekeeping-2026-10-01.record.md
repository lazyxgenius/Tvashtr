# Housekeeping record — 2026-10-01

Session: worktree `/Users/adimac/Desktop/Tvashtr/.claude/worktrees/tvashtr-housekeeping-07c107` (branch `claude/tvashtr-housekeeping-07c107`), brief `prompts/housekeeping-branches-neon.md` v2. Started 2026-10-01 18:26:49 IST; deadline 18:56:49 IST.

## Plan (written before any deletion)

After `git -c maintenance.auto=false -c gc.auto=0 fetch --no-write-fetch-head origin` at 18:26:49 IST: `origin/main` = `7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5`. GitHub: 42 branches; local: 35. Worktrees: main checkout on `fix/connectors-parity`, this worktree on `claude/tvashtr-housekeeping-07c107`. Dates are committer dates (IST); 24-hour cutoff = 2026-09-30 18:26 IST.

| branch | where | tip sha | merged? | ahead of origin/main | last commit | action |
|---|---|---|---|---|---|---|
| `claude/tender-maxwell-0wxvan` | both | `9c40a1314a2f69d7ff8adf8709c506f4aca6215d` | yes | 0 | 2026-09-25 16:00 | delete |
| `claude/tvashtr-housekeeping-07c107` | local | `7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5` | yes | 0 | 2026-10-01 17:50 | KEEP (checked out) |
| `claude/tvashtr-revamp-e2e-setup-533a4e` | local | `ec9202b6f3aecde00663a437d508c0f1a27b0135` | yes | 0 | 2026-09-26 09:20 | delete |
| `docs/polyrag-phase1-plan` | GitHub | `0d435d262675dd42406d018aea3de5a9ee8646c4` | no | 2 | 2026-09-15 13:54 | archive+delete |
| `docs/polyrag-tvashtr-design` | GitHub | `7a0c8e44c93f9df5a76cfa8681755620ee3918fd` | no | 1 | 2026-09-15 13:45 | archive+delete |
| `docs/spike-hosted-subscription-apis` | GitHub | `06275f444047d129f168b19fd007bc3a76787b20` | no | 2 | 2026-09-15 11:52 | archive+delete |
| `feat/connectors` | local | `ac2073da6229ce368da3551277d08daa65e64cf1` | yes | 0 | 2026-09-30 21:07 | KEEP (tip <24h) |
| `feat/connectors-b1` | local | `fba13f2843e774a945685624a373e0aad427f8a2` | yes | 0 | 2026-09-30 17:18 | delete |
| `feat/connectors-b2` | local | `b793d26e25dc235ec8f8cec7dce0cc285917fd81` | yes | 0 | 2026-09-30 16:42 | delete |
| `feat/connectors-b3` | local | `2df6cde92d171bafc3b2642177378093b29ec78e` | yes | 0 | 2026-09-30 16:43 | delete |
| `feat/connectors-d` | local | `a64eee9ef74b33ea4c51fada77629cdf26ddf4d2` | yes | 0 | 2026-09-30 15:27 | delete |
| `feat/connectors-f1` | local | `eb4d653cbf4cbfd2cd7b037aece96d1b308aab2c` | yes | 0 | 2026-09-30 16:46 | delete |
| `feat/connectors-f2` | local | `45f397ef8adb2e11dffe0446e2153e05572af7a9` | yes | 0 | 2026-09-30 16:06 | delete |
| `feat/dashboard-split-nav` | GitHub | `eaacdf746512ac749e34e233612bf7a74144443b` | yes | 0 | 2026-09-15 12:57 | delete |
| `feat/domains-ask-discoverability` | GitHub | `00db2b494c07a23190ec799b9a129cebd22c9a26` | yes | 0 | 2026-09-22 09:53 | delete |
| `feat/domains-eval-graph-polish` | both | `f20664a3611be0efb59822a6ac0b6a8b3a9882e8` | yes | 0 | 2026-09-22 15:03 | delete |
| `feat/domains-groq-embed` | GitHub | `35a1f9a05796d608e93bdcfaa3ac8bb5162aca8e` | yes | 0 | 2026-09-22 09:39 | delete |
| `feat/domains-guided-path` | GitHub | `f117d2306ac397fded4a9dbf132744db3495c93d` | yes | 0 | 2026-09-22 09:47 | delete |
| `feat/domains-hf-free-embed` | GitHub | `49c590731368dcc308b4d959460c4af3e2f0c600` | yes | 0 | 2026-09-22 13:25 | delete |
| `feat/domains-multi-embed` | both | `c27da815c1319e875b7e5b8ca557ba2fcc9ca4a0` | yes | 0 | 2026-09-22 01:30 | delete |
| `feat/engines-hosted-clarity` | GitHub | `1607af8aead7ad94827c50b9f941c16776f65aff` | yes | 0 | 2026-09-22 09:50 | delete |
| `feat/free-tools-skills-catalog` | both | `974bc5197e09d4ac8741b6d441dfa250ebfe0def` | yes | 0 | 2026-09-22 00:55 | delete — local 26b13ef != GitHub 974bc51 (both in origin/main) |
| `feat/harness-real-cli-auth` | GitHub | `71fa43454b6b2bf1d1c7e6a9a9eb7d28ab21f492` | yes | 0 | 2026-09-15 11:59 | delete |
| `feat/polyrag-domains-phase1` | both | `383405ea69aac800277c3f7c826cdb8cb98a4edc` | yes | 0 | 2026-09-15 14:21 | delete |
| `feat/polyrag-domains-phase2` | both | `71128db7a19c44c2055afb8c5f1f49b80b8ae998` | yes | 0 | 2026-09-15 16:18 | delete — local 034a36a != GitHub 71128db (both in origin/main) |
| `feat/polyrag-domains-phase3` | GitHub | `717d7df947f5ef30c426e49c09f50ba6e15ccaa6` | yes | 0 | 2026-09-15 16:38 | delete |
| `feat/polyrag-domains-phase4a` | GitHub | `f8ee495f0ed2687a53d20f2a8c58ea1448f14ecf` | yes | 0 | 2026-09-15 16:49 | delete |
| `feat/polyrag-domains-phase4b` | GitHub | `62cc9b5c10b63daf8de61157ba9f7c4db9fc5ac1` | yes | 0 | 2026-09-15 17:01 | delete |
| `feat/revamp-desktop-app` | both | `9e2aaa02b877e8144063df5550ff04239144a1f9` | yes | 0 | 2026-09-29 22:43 | delete |
| `feat/revamp-domains` | both | `389ab84124eff1d882c90a196469560c475afabc` | yes | 0 | 2026-09-30 09:45 | delete |
| `feat/revamp-f2-engines` | both | `6acc7262299f05d34fce905b31fd7e1aabd882f6` | yes | 0 | 2026-09-26 18:24 | delete |
| `feat/revamp-f3-tools-secrets` | both | `c1a01723d4dbe28902e46c42355ba7acd428aed7` | yes | 0 | 2026-09-26 18:44 | delete |
| `feat/revamp-f4-skills-memory` | both | `055671adef5e933862addc27b78b00b422964640` | yes | 0 | 2026-09-26 19:21 | delete |
| `feat/revamp-f5-panel` | both | `b33c630b2de6b37494ca39be30b23b55906f0ffd` | yes | 0 | 2026-09-27 05:51 | delete |
| `feat/revamp-f6-focus-docs` | both | `dc8fe9ce775da4e974c515643e34ec4b54647e13` | yes | 0 | 2026-09-30 00:34 | delete |
| `feat/revamp-website` | both | `c7848be5fb082c72cf5d2a3b5fe9dfc950f75ee3` | yes | 0 | 2026-09-29 23:24 | delete |
| `feat/subscription-connect-dual-engine` | GitHub | `ef6f5f2310ed6726121fbd9edeea92b4e9bfee48` | yes | 0 | 2026-09-15 10:08 | delete |
| `feat/ux-polish-remove-ab` | GitHub | `78e60e5341a0d0ef5ea804d18f4edb6ecbff1739` | yes | 0 | 2026-09-15 12:20 | delete |
| `fix/connectors-parity` | both | `2e5deea175c25397335e7b926579df1368020cdd` | no | 2 | 2026-10-01 18:13 | KEEP (by name) — in use by the main-checkout session; local a70aaaa, GitHub 2e5deea |
| `fix/desktop-harness-path-detect` | GitHub | `f20664a3611be0efb59822a6ac0b6a8b3a9882e8` | yes | 0 | 2026-09-22 15:03 | delete |
| `fix/desktop-subscription-runs` | both | `7d86f454ca07c67d1ef3f53c7d4bb8ece84c5781` | yes | 0 | 2026-09-24 12:20 | delete |
| `fix/domains-ask-discoverability-visibility` | GitHub | `49c307abeecb81647d47f07398ea7310b5645927` | yes | 0 | 2026-09-22 10:25 | delete |
| `fix/entry-report` | both | `007019d191c7aa850c880fd6be8fa0ffd976cf0f` | yes | 0 | 2026-09-26 12:08 | delete |
| `fix/fly-create-app-403` | local | `a69988b369baf8e670b92556d6df2cadfe3053c0` | no | 1 | 2026-09-05 11:40 | archive+delete |
| `fix/groq-embed-litellm-route` | GitHub | `dc8328001e28e38e7ef450e975764082d649fdac` | yes | 0 | 2026-09-22 10:21 | delete |
| `fix/hosted-credential-cta` | GitHub | `c27da815c1319e875b7e5b8ca557ba2fcc9ca4a0` | yes | 0 | 2026-09-22 01:30 | delete |
| `fix/integration-review` | both | `573055e79baeb13ceef61f2e09198ecc8737c182` | yes | 0 | 2026-09-26 23:26 | delete |
| `fix/security-s1` | both | `7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5` | yes | 0 | 2026-10-01 17:50 | KEEP (by name) |
| `fix/ship-identity` | both | `f6e1d4e43fa3341e8a9544018b87409de1a1c08a` | yes | 0 | 2026-09-26 19:05 | delete |
| `fix/ship-sidecars` | both | `bad8ed37f52e5cd8293d590e05c30645fe5274a2` | yes | 0 | 2026-09-26 18:24 | delete |
| `fix/subs-fly-replay` | both | `4e86abc130135bda1ae1e34bc90a94c8d9092811` | yes | 0 | 2026-09-24 21:20 | delete |
| `main` | both | `7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5` | yes | 0 | 2026-10-01 17:50 | KEEP (by name) |
| `ship/revamp-r1` | local | `ec9202b6f3aecde00663a437d508c0f1a27b0135` | yes | 0 | 2026-09-26 09:20 | delete |
| `wip/revamp-r1-e2e-rest` | local | `3a42343ea880a5812e9e7bc74fd09d13a8490912` | yes | 0 | 2026-09-25 22:35 | delete |

Totals planned: GitHub deletions 39 (36 merged + 3 archived); local deletions 30 (29 merged + 1 archived); archive tags 4 (`archive/docs/polyrag-phase1-plan`, `archive/docs/polyrag-tvashtr-design`, `archive/docs/spike-hosted-subscription-apis`, `archive/fix/fly-create-app-403`). Kept: `main`, `fix/security-s1`, `fix/connectors-parity`, `claude/tvashtr-housekeeping-07c107`, `feat/connectors` (merged but tip 2026-09-30 21:07 IST, <24h).

Neon plan (project `billowing-mud-37479513`, CLI `neon` 7.0.1 from the npx cache — `neonctl` not installed): no branch created today → create `snap-2026-10-01` (parent `production`, `--no-compute`); then delete `before-revamp-r1` (`br-silent-grass-azxb9rk2`, parent production, created 2026-09-26T04:30:29Z; its idle endpoint `ep-morning-mud-az6zkinp` goes with it) and `pre-0042-2026-09-30` (`br-spring-night-azbi4vfk`, parent production, created 2026-09-30T03:56:20Z), each re-matched on name + parent + created date first.

Neon branches before:

| name | id | parent | created (UTC) | compute |
|---|---|---|---|---|
| production (default) | br-square-voice-azhmb3cg | – | 2026-07-20T09:21:16Z | ep-steep-fog-azzyw1me (read_write, idle) |
| pre-0042-2026-09-30 | br-spring-night-azbi4vfk | production | 2026-09-30T03:56:20Z | none |
| before-revamp-r1 | br-silent-grass-azxb9rk2 | production | 2026-09-26T04:30:29Z | ep-morning-mud-az6zkinp (read_write, idle) |

## Handover (appended 2026-10-01 ~18:30 IST; run 18:26:49–18:28:47 IST, well inside the 30 minutes)

### Done

The plan above was carried out exactly. Right before each deletion, every tip was checked again against the plan: 39/39 GitHub tips and 30/30 local tips matched, and none was checked out.

**Archive tags (4).** These were created with `git tag -a archive/<b> <sha> -m "Archived by housekeeping 2026-10-01: <b> @ <sha>, never merged"`; each `exit=0`.

```
$ git push origin refs/tags/archive/docs/polyrag-phase1-plan refs/tags/archive/docs/polyrag-tvashtr-design refs/tags/archive/docs/spike-hosted-subscription-apis refs/tags/archive/fix/fly-create-app-403
To https://github.com/lazyxgenius/Tvashtr.git
 * [new tag]         archive/docs/polyrag-phase1-plan -> archive/docs/polyrag-phase1-plan
 * [new tag]         archive/docs/polyrag-tvashtr-design -> archive/docs/polyrag-tvashtr-design
 * [new tag]         archive/docs/spike-hosted-subscription-apis -> archive/docs/spike-hosted-subscription-apis
 * [new tag]         archive/fix/fly-create-app-403 -> archive/fix/fly-create-app-403
exit=0
```
`git ls-remote origin refs/tags/archive/<b>` confirmed each tag before any deletion. Every peeled tag pointed at the branch's tip sha (the output is under "Verified" below).

**GitHub deletions (39).** These are the 36 merged branches plus the 3 archived ones.
```
$ git push origin --delete claude/tender-maxwell-0wxvan docs/polyrag-phase1-plan docs/polyrag-tvashtr-design docs/spike-hosted-subscription-apis feat/dashboard-split-nav feat/domains-ask-discoverability feat/domains-eval-graph-polish feat/domains-groq-embed feat/domains-guided-path feat/domains-hf-free-embed feat/domains-multi-embed feat/engines-hosted-clarity feat/free-tools-skills-catalog feat/harness-real-cli-auth feat/polyrag-domains-phase1 feat/polyrag-domains-phase2 feat/polyrag-domains-phase3 feat/polyrag-domains-phase4a feat/polyrag-domains-phase4b feat/revamp-desktop-app feat/revamp-domains feat/revamp-f2-engines feat/revamp-f3-tools-secrets feat/revamp-f4-skills-memory feat/revamp-f5-panel feat/revamp-f6-focus-docs feat/revamp-website feat/subscription-connect-dual-engine feat/ux-polish-remove-ab fix/desktop-harness-path-detect fix/desktop-subscription-runs fix/domains-ask-discoverability-visibility fix/entry-report fix/groq-embed-litellm-route fix/hosted-credential-cta fix/integration-review fix/ship-identity fix/ship-sidecars fix/subs-fly-replay
To https://github.com/lazyxgenius/Tvashtr.git
 - [deleted]         claude/tender-maxwell-0wxvan
 - [deleted]         docs/polyrag-phase1-plan
 - [deleted]         docs/polyrag-tvashtr-design
 - [deleted]         docs/spike-hosted-subscription-apis
 - [deleted]         feat/dashboard-split-nav
 - [deleted]         feat/domains-ask-discoverability
 - [deleted]         feat/domains-eval-graph-polish
 - [deleted]         feat/domains-groq-embed
 - [deleted]         feat/domains-guided-path
 - [deleted]         feat/domains-hf-free-embed
 - [deleted]         feat/domains-multi-embed
 - [deleted]         feat/engines-hosted-clarity
 - [deleted]         feat/free-tools-skills-catalog
 - [deleted]         feat/harness-real-cli-auth
 - [deleted]         feat/polyrag-domains-phase1
 - [deleted]         feat/polyrag-domains-phase2
 - [deleted]         feat/polyrag-domains-phase3
 - [deleted]         feat/polyrag-domains-phase4a
 - [deleted]         feat/polyrag-domains-phase4b
 - [deleted]         feat/revamp-desktop-app
 - [deleted]         feat/revamp-domains
 - [deleted]         feat/revamp-f2-engines
 - [deleted]         feat/revamp-f3-tools-secrets
 - [deleted]         feat/revamp-f4-skills-memory
 - [deleted]         feat/revamp-f5-panel
 - [deleted]         feat/revamp-f6-focus-docs
 - [deleted]         feat/revamp-website
 - [deleted]         feat/subscription-connect-dual-engine
 - [deleted]         feat/ux-polish-remove-ab
 - [deleted]         fix/desktop-harness-path-detect
 - [deleted]         fix/desktop-subscription-runs
 - [deleted]         fix/domains-ask-discoverability-visibility
 - [deleted]         fix/entry-report
 - [deleted]         fix/groq-embed-litellm-route
 - [deleted]         fix/hosted-credential-cta
 - [deleted]         fix/integration-review
 - [deleted]         fix/ship-identity
 - [deleted]         fix/ship-sidecars
 - [deleted]         fix/subs-fly-replay
exit=0
```

**Local deletions (30).** `git branch -d` removed the 29 merged branches and `git branch -D` removed the 1 archived branch.
```
$ git branch -d claude/tender-maxwell-0wxvan claude/tvashtr-revamp-e2e-setup-533a4e feat/connectors-b1 feat/connectors-b2 feat/connectors-b3 feat/connectors-d feat/connectors-f1 feat/connectors-f2 feat/domains-eval-graph-polish feat/domains-multi-embed feat/free-tools-skills-catalog feat/polyrag-domains-phase1 feat/polyrag-domains-phase2 feat/revamp-desktop-app feat/revamp-domains feat/revamp-f2-engines feat/revamp-f3-tools-secrets feat/revamp-f4-skills-memory feat/revamp-f5-panel feat/revamp-f6-focus-docs feat/revamp-website fix/desktop-subscription-runs fix/entry-report fix/integration-review fix/ship-identity fix/ship-sidecars fix/subs-fly-replay ship/revamp-r1 wip/revamp-r1-e2e-rest
Deleted branch claude/tender-maxwell-0wxvan (was 9c40a13).
Deleted branch claude/tvashtr-revamp-e2e-setup-533a4e (was ec9202b).
Deleted branch feat/connectors-b1 (was fba13f2).
Deleted branch feat/connectors-b2 (was b793d26).
Deleted branch feat/connectors-b3 (was 2df6cde).
Deleted branch feat/connectors-d (was a64eee9).
Deleted branch feat/connectors-f1 (was eb4d653).
Deleted branch feat/connectors-f2 (was 45f397e).
Deleted branch feat/domains-eval-graph-polish (was f20664a).
Deleted branch feat/domains-multi-embed (was c27da81).
Deleted branch feat/free-tools-skills-catalog (was 26b13ef).
Deleted branch feat/polyrag-domains-phase1 (was 383405e).
Deleted branch feat/polyrag-domains-phase2 (was 034a36a).
Deleted branch feat/revamp-desktop-app (was 9e2aaa0).
Deleted branch feat/revamp-domains (was 389ab84).
Deleted branch feat/revamp-f2-engines (was 6acc726).
Deleted branch feat/revamp-f3-tools-secrets (was c1a0172).
Deleted branch feat/revamp-f4-skills-memory (was 055671a).
Deleted branch feat/revamp-f5-panel (was b33c630).
Deleted branch feat/revamp-f6-focus-docs (was dc8fe9c).
Deleted branch feat/revamp-website (was c7848be).
Deleted branch fix/desktop-subscription-runs (was 7d86f45).
Deleted branch fix/entry-report (was 007019d).
Deleted branch fix/integration-review (was 573055e).
Deleted branch fix/ship-identity (was f6e1d4e).
Deleted branch fix/ship-sidecars (was bad8ed3).
Deleted branch fix/subs-fly-replay (was 4e86abc).
Deleted branch ship/revamp-r1 (was ec9202b).
Deleted branch wip/revamp-r1-e2e-rest (was 3a42343).
exit=0
$ git branch -D fix/fly-create-app-403
Deleted branch fix/fly-create-app-403 (was a69988b).
exit=0
```

**Neon (project `billowing-mud-37479513`, CLI `neon` 7.0.1 at `~/.npm/_npx/7f657307477966ff/node_modules/.bin/neon`).** No branch had been created on 2026-10-01.
```
$ neon branches create --project-id billowing-mud-37479513 --name snap-2026-10-01 --parent production --no-compute --no-secrets -o json
exit=0
{'id': 'br-dark-silence-az7oq6eg', 'name': 'snap-2026-10-01', 'parent_id': 'br-square-voice-azhmb3cg', 'parent_lsn': '0/7E13FD0', 'parent_timestamp': None, 'created_at': '2026-10-01T12:58:12Z', 'current_state': 'init'}
endpoints: None
```
Each target was re-matched before deleting it:
```
before-revamp-r1 id=br-silent-grass-azxb9rk2 parent=production created=2026-09-26T04:30:29Z -> MATCH
pre-0042-2026-09-30 id=br-spring-night-azbi4vfk parent=production created=2026-09-30T03:56:20Z -> MATCH
```
```
$ neon branches delete br-silent-grass-azxb9rk2 --project-id billowing-mud-37479513 -o json
{'id': 'br-silent-grass-azxb9rk2', 'name': 'before-revamp-r1', 'parent_id': 'br-square-voice-azhmb3cg', 'created_at': '2026-09-26T04:30:29Z', 'current_state': 'ready', 'pending_state': 'storage_deleted'}
exit=0
$ neon branches delete br-spring-night-azbi4vfk --project-id billowing-mud-37479513 -o json
{'id': 'br-spring-night-azbi4vfk', 'name': 'pre-0042-2026-09-30', 'parent_id': 'br-square-voice-azhmb3cg', 'created_at': '2026-09-30T03:56:20Z', 'current_state': 'ready', 'pending_state': 'storage_deleted'}
exit=0
```
`before-revamp-r1`'s idle endpoint `ep-morning-mud-az6zkinp` was removed along with the branch. No endpoint was touched directly. `production` and its endpoint `ep-steep-fog-azzyw1me` are unchanged.

### Restore commands (every deleted branch)

The local-only branches were never on GitHub; their commits are kept by `main` (merged) or by `archive/*` (unmerged). The command below re-creates any of them on GitHub.

| branch | sha | restore |
|---|---|---|
| `claude/tender-maxwell-0wxvan` | `9c40a1314a2f69d7ff8adf8709c506f4aca6215d` | `git push origin 9c40a1314a2f69d7ff8adf8709c506f4aca6215d:refs/heads/claude/tender-maxwell-0wxvan` |
| `claude/tvashtr-revamp-e2e-setup-533a4e` | `ec9202b6f3aecde00663a437d508c0f1a27b0135` | `git push origin ec9202b6f3aecde00663a437d508c0f1a27b0135:refs/heads/claude/tvashtr-revamp-e2e-setup-533a4e` |
| `docs/polyrag-phase1-plan` | `0d435d262675dd42406d018aea3de5a9ee8646c4` | `git push origin 0d435d262675dd42406d018aea3de5a9ee8646c4:refs/heads/docs/polyrag-phase1-plan` |
| `docs/polyrag-tvashtr-design` | `7a0c8e44c93f9df5a76cfa8681755620ee3918fd` | `git push origin 7a0c8e44c93f9df5a76cfa8681755620ee3918fd:refs/heads/docs/polyrag-tvashtr-design` |
| `docs/spike-hosted-subscription-apis` | `06275f444047d129f168b19fd007bc3a76787b20` | `git push origin 06275f444047d129f168b19fd007bc3a76787b20:refs/heads/docs/spike-hosted-subscription-apis` |
| `feat/connectors-b1` | `fba13f2843e774a945685624a373e0aad427f8a2` | `git push origin fba13f2843e774a945685624a373e0aad427f8a2:refs/heads/feat/connectors-b1` |
| `feat/connectors-b2` | `b793d26e25dc235ec8f8cec7dce0cc285917fd81` | `git push origin b793d26e25dc235ec8f8cec7dce0cc285917fd81:refs/heads/feat/connectors-b2` |
| `feat/connectors-b3` | `2df6cde92d171bafc3b2642177378093b29ec78e` | `git push origin 2df6cde92d171bafc3b2642177378093b29ec78e:refs/heads/feat/connectors-b3` |
| `feat/connectors-d` | `a64eee9ef74b33ea4c51fada77629cdf26ddf4d2` | `git push origin a64eee9ef74b33ea4c51fada77629cdf26ddf4d2:refs/heads/feat/connectors-d` |
| `feat/connectors-f1` | `eb4d653cbf4cbfd2cd7b037aece96d1b308aab2c` | `git push origin eb4d653cbf4cbfd2cd7b037aece96d1b308aab2c:refs/heads/feat/connectors-f1` |
| `feat/connectors-f2` | `45f397ef8adb2e11dffe0446e2153e05572af7a9` | `git push origin 45f397ef8adb2e11dffe0446e2153e05572af7a9:refs/heads/feat/connectors-f2` |
| `feat/dashboard-split-nav` | `eaacdf746512ac749e34e233612bf7a74144443b` | `git push origin eaacdf746512ac749e34e233612bf7a74144443b:refs/heads/feat/dashboard-split-nav` |
| `feat/domains-ask-discoverability` | `00db2b494c07a23190ec799b9a129cebd22c9a26` | `git push origin 00db2b494c07a23190ec799b9a129cebd22c9a26:refs/heads/feat/domains-ask-discoverability` |
| `feat/domains-eval-graph-polish` | `f20664a3611be0efb59822a6ac0b6a8b3a9882e8` | `git push origin f20664a3611be0efb59822a6ac0b6a8b3a9882e8:refs/heads/feat/domains-eval-graph-polish` |
| `feat/domains-groq-embed` | `35a1f9a05796d608e93bdcfaa3ac8bb5162aca8e` | `git push origin 35a1f9a05796d608e93bdcfaa3ac8bb5162aca8e:refs/heads/feat/domains-groq-embed` |
| `feat/domains-guided-path` | `f117d2306ac397fded4a9dbf132744db3495c93d` | `git push origin f117d2306ac397fded4a9dbf132744db3495c93d:refs/heads/feat/domains-guided-path` |
| `feat/domains-hf-free-embed` | `49c590731368dcc308b4d959460c4af3e2f0c600` | `git push origin 49c590731368dcc308b4d959460c4af3e2f0c600:refs/heads/feat/domains-hf-free-embed` |
| `feat/domains-multi-embed` | `c27da815c1319e875b7e5b8ca557ba2fcc9ca4a0` | `git push origin c27da815c1319e875b7e5b8ca557ba2fcc9ca4a0:refs/heads/feat/domains-multi-embed` |
| `feat/engines-hosted-clarity` | `1607af8aead7ad94827c50b9f941c16776f65aff` | `git push origin 1607af8aead7ad94827c50b9f941c16776f65aff:refs/heads/feat/engines-hosted-clarity` |
| `feat/free-tools-skills-catalog` | `974bc5197e09d4ac8741b6d441dfa250ebfe0def` (local copy was 26b13ef, an ancestor) | `git push origin 974bc5197e09d4ac8741b6d441dfa250ebfe0def:refs/heads/feat/free-tools-skills-catalog` |
| `feat/harness-real-cli-auth` | `71fa43454b6b2bf1d1c7e6a9a9eb7d28ab21f492` | `git push origin 71fa43454b6b2bf1d1c7e6a9a9eb7d28ab21f492:refs/heads/feat/harness-real-cli-auth` |
| `feat/polyrag-domains-phase1` | `383405ea69aac800277c3f7c826cdb8cb98a4edc` | `git push origin 383405ea69aac800277c3f7c826cdb8cb98a4edc:refs/heads/feat/polyrag-domains-phase1` |
| `feat/polyrag-domains-phase2` | `71128db7a19c44c2055afb8c5f1f49b80b8ae998` (local copy was 034a36a, an ancestor) | `git push origin 71128db7a19c44c2055afb8c5f1f49b80b8ae998:refs/heads/feat/polyrag-domains-phase2` |
| `feat/polyrag-domains-phase3` | `717d7df947f5ef30c426e49c09f50ba6e15ccaa6` | `git push origin 717d7df947f5ef30c426e49c09f50ba6e15ccaa6:refs/heads/feat/polyrag-domains-phase3` |
| `feat/polyrag-domains-phase4a` | `f8ee495f0ed2687a53d20f2a8c58ea1448f14ecf` | `git push origin f8ee495f0ed2687a53d20f2a8c58ea1448f14ecf:refs/heads/feat/polyrag-domains-phase4a` |
| `feat/polyrag-domains-phase4b` | `62cc9b5c10b63daf8de61157ba9f7c4db9fc5ac1` | `git push origin 62cc9b5c10b63daf8de61157ba9f7c4db9fc5ac1:refs/heads/feat/polyrag-domains-phase4b` |
| `feat/revamp-desktop-app` | `9e2aaa02b877e8144063df5550ff04239144a1f9` | `git push origin 9e2aaa02b877e8144063df5550ff04239144a1f9:refs/heads/feat/revamp-desktop-app` |
| `feat/revamp-domains` | `389ab84124eff1d882c90a196469560c475afabc` | `git push origin 389ab84124eff1d882c90a196469560c475afabc:refs/heads/feat/revamp-domains` |
| `feat/revamp-f2-engines` | `6acc7262299f05d34fce905b31fd7e1aabd882f6` | `git push origin 6acc7262299f05d34fce905b31fd7e1aabd882f6:refs/heads/feat/revamp-f2-engines` |
| `feat/revamp-f3-tools-secrets` | `c1a01723d4dbe28902e46c42355ba7acd428aed7` | `git push origin c1a01723d4dbe28902e46c42355ba7acd428aed7:refs/heads/feat/revamp-f3-tools-secrets` |
| `feat/revamp-f4-skills-memory` | `055671adef5e933862addc27b78b00b422964640` | `git push origin 055671adef5e933862addc27b78b00b422964640:refs/heads/feat/revamp-f4-skills-memory` |
| `feat/revamp-f5-panel` | `b33c630b2de6b37494ca39be30b23b55906f0ffd` | `git push origin b33c630b2de6b37494ca39be30b23b55906f0ffd:refs/heads/feat/revamp-f5-panel` |
| `feat/revamp-f6-focus-docs` | `dc8fe9ce775da4e974c515643e34ec4b54647e13` | `git push origin dc8fe9ce775da4e974c515643e34ec4b54647e13:refs/heads/feat/revamp-f6-focus-docs` |
| `feat/revamp-website` | `c7848be5fb082c72cf5d2a3b5fe9dfc950f75ee3` | `git push origin c7848be5fb082c72cf5d2a3b5fe9dfc950f75ee3:refs/heads/feat/revamp-website` |
| `feat/subscription-connect-dual-engine` | `ef6f5f2310ed6726121fbd9edeea92b4e9bfee48` | `git push origin ef6f5f2310ed6726121fbd9edeea92b4e9bfee48:refs/heads/feat/subscription-connect-dual-engine` |
| `feat/ux-polish-remove-ab` | `78e60e5341a0d0ef5ea804d18f4edb6ecbff1739` | `git push origin 78e60e5341a0d0ef5ea804d18f4edb6ecbff1739:refs/heads/feat/ux-polish-remove-ab` |
| `fix/desktop-harness-path-detect` | `f20664a3611be0efb59822a6ac0b6a8b3a9882e8` | `git push origin f20664a3611be0efb59822a6ac0b6a8b3a9882e8:refs/heads/fix/desktop-harness-path-detect` |
| `fix/desktop-subscription-runs` | `7d86f454ca07c67d1ef3f53c7d4bb8ece84c5781` | `git push origin 7d86f454ca07c67d1ef3f53c7d4bb8ece84c5781:refs/heads/fix/desktop-subscription-runs` |
| `fix/domains-ask-discoverability-visibility` | `49c307abeecb81647d47f07398ea7310b5645927` | `git push origin 49c307abeecb81647d47f07398ea7310b5645927:refs/heads/fix/domains-ask-discoverability-visibility` |
| `fix/entry-report` | `007019d191c7aa850c880fd6be8fa0ffd976cf0f` | `git push origin 007019d191c7aa850c880fd6be8fa0ffd976cf0f:refs/heads/fix/entry-report` |
| `fix/fly-create-app-403` | `a69988b369baf8e670b92556d6df2cadfe3053c0` | `git push origin a69988b369baf8e670b92556d6df2cadfe3053c0:refs/heads/fix/fly-create-app-403` |
| `fix/groq-embed-litellm-route` | `dc8328001e28e38e7ef450e975764082d649fdac` | `git push origin dc8328001e28e38e7ef450e975764082d649fdac:refs/heads/fix/groq-embed-litellm-route` |
| `fix/hosted-credential-cta` | `c27da815c1319e875b7e5b8ca557ba2fcc9ca4a0` | `git push origin c27da815c1319e875b7e5b8ca557ba2fcc9ca4a0:refs/heads/fix/hosted-credential-cta` |
| `fix/integration-review` | `573055e79baeb13ceef61f2e09198ecc8737c182` | `git push origin 573055e79baeb13ceef61f2e09198ecc8737c182:refs/heads/fix/integration-review` |
| `fix/ship-identity` | `f6e1d4e43fa3341e8a9544018b87409de1a1c08a` | `git push origin f6e1d4e43fa3341e8a9544018b87409de1a1c08a:refs/heads/fix/ship-identity` |
| `fix/ship-sidecars` | `bad8ed37f52e5cd8293d590e05c30645fe5274a2` | `git push origin bad8ed37f52e5cd8293d590e05c30645fe5274a2:refs/heads/fix/ship-sidecars` |
| `fix/subs-fly-replay` | `4e86abc130135bda1ae1e34bc90a94c8d9092811` | `git push origin 4e86abc130135bda1ae1e34bc90a94c8d9092811:refs/heads/fix/subs-fly-replay` |
| `ship/revamp-r1` | `ec9202b6f3aecde00663a437d508c0f1a27b0135` | `git push origin ec9202b6f3aecde00663a437d508c0f1a27b0135:refs/heads/ship/revamp-r1` |
| `wip/revamp-r1-e2e-rest` | `3a42343ea880a5812e9e7bc74fd09d13a8490912` | `git push origin 3a42343ea880a5812e9e7bc74fd09d13a8490912:refs/heads/wip/revamp-r1-e2e-rest` |

### Verified (after, 18:28:47 IST)

```
$ git ls-remote --heads origin
df57ba14572037fc7c2aab787e17a61d37933c76	refs/heads/fix/connectors-parity
7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5	refs/heads/fix/security-s1
df57ba14572037fc7c2aab787e17a61d37933c76	refs/heads/main
count=3

$ git for-each-ref refs/heads
7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5 refs/heads/claude/tvashtr-housekeeping-07c107
ac2073da6229ce368da3551277d08daa65e64cf1 refs/heads/feat/connectors
df57ba14572037fc7c2aab787e17a61d37933c76 refs/heads/fix/connectors-parity
7a7f6fd5e5f272da0e7b3d13f444d031d6a283f5 refs/heads/fix/security-s1
df57ba14572037fc7c2aab787e17a61d37933c76 refs/heads/main
count=5

$ git ls-remote --tags origin 'archive/*'
89b39260fd44f57bb548db3b2d9cd8d2fefb9e86	refs/tags/archive/docs/polyrag-phase1-plan
0d435d262675dd42406d018aea3de5a9ee8646c4	refs/tags/archive/docs/polyrag-phase1-plan^{}
0178ad90723adf8947e061dc2c714c178798db48	refs/tags/archive/docs/polyrag-tvashtr-design
7a0c8e44c93f9df5a76cfa8681755620ee3918fd	refs/tags/archive/docs/polyrag-tvashtr-design^{}
cb6575ac77491e1d4196900d416124fd966918e8	refs/tags/archive/docs/spike-hosted-subscription-apis
06275f444047d129f168b19fd007bc3a76787b20	refs/tags/archive/docs/spike-hosted-subscription-apis^{}
28ff4cb8bdab92473b86c504a980b0bfadac52a2	refs/tags/archive/fix/fly-create-app-403
a69988b369baf8e670b92556d6df2cadfe3053c0	refs/tags/archive/fix/fly-create-app-403^{}

$ git ls-remote --tags origin (count, all tags — none removed)
count=17

$ neon branches list (after)
production (default) | br-square-voice-azhmb3cg | – | 2026-07-20T09:21:16Z | ep-steep-fog-azzyw1me (read_write, idle)
snap-2026-10-01 | br-dark-silence-az7oq6eg | production | 2026-10-01T12:58:12Z | none
```
GitHub now has 3 branches (`main`, `fix/security-s1`, `fix/connectors-parity`); this Mac has 5 (those three plus `feat/connectors` and `claude/tvashtr-housekeeping-07c107`). The 13 `desktop-v*` tags plus the 4 new `archive/*` tags make 17 tags on origin; no tag delete was run. `main` on GitHub moved from `7a7f6fd` to `df57ba1` during the run. That was the other session merging and pushing `fix/connectors-parity`; this job never wrote to `main`.

### Skipped or blocked

- Nothing failed: no lock-file errors and no retries.
- `feat/connectors` (local, merged, `ac2073d`) was kept by rule 1 because its tip (2026-09-30 21:07 IST) was under 24 hours old at plan time. It can go in the next sweep with `git branch -d feat/connectors`.
- Tooling: `neonctl` isn't installed and the Neon MCP server isn't authorized. The newer `neon` CLI 7.0.1 from the npx cache, still signed in from 09-30, was used instead.

### Left for later

- `fix/security-s1` and `fix/connectors-parity`, which are in use today. Both are now at or merged into `main`, so the next sweep can delete them.
- `feat/connectors`, once it is past 24 hours.
- `claude/tvashtr-housekeeping-07c107` (this worktree's branch, at `7a7f6fd`, merged). Remove it when the worktree is removed.
- Neon `snap-2026-10-01` (`br-dark-silence-az7oq6eg`), to delete once prod has run clean for a while.
