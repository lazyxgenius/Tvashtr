# caveman — vendored, not fetched

`SKILL.md` in this directory is a VERBATIM copy of `skills/caveman/SKILL.md` from
<https://github.com/JuliusBrussee/caveman>, pinned at commit `0574b85a19ab7b2b7f42cc3b3838e20f24ab85eb`
(retrieved 2026-09-05). `LICENSE` is that repository's root MIT license.

**License.** The upstream repository is split-licensed (see its `LICENSING.md`): `skills/` is
**MIT**; the compression `engine/`, `proxy/`, `rewriter/` and `browse/` directories are BSL-1.1.
Only the MIT `skills/caveman/SKILL.md` is vendored here. No engine, binary or BSL-licensed code is
included, and Tvashtr links to none of it.

**Why vendored and not fetched.** The agent runs inside a Fly microVM behind an egress firewall
(M-h3), so a runtime fetch of a skill would either fail closed or require punching a hole in that
fence. The content is stamped into each worker node's `skills` column at team-creation time, from
this file, read once at import. There is no network call on any path.

**Updating.** Re-copy the upstream file and bump the commit above. The one behaviour Tvashtr
depends on is that compression never rewrites literal output: the reviewer node's contract
(`REVIEW_VERDICT.json`, the exact verdict strings `approved` / `changes_requested`, and the
command `python -B -m unittest`) is asserted against the vendored text in
`backend/tests/test_thrift.py` and proven live by `make loop-run`.
