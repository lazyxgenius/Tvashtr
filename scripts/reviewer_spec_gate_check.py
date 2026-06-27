#!/usr/bin/env python
"""Opt-in *live* Item-C measurement (M-brownfield Slice 4): can the 70b reviewer gate on spec-met?

The §15 finding 2 is that the reviewer rubber-stamps tests-green (approves without verifying the
build meets the idea/PRD). The REVIEWER_PROMPT already forbids that ("approve ONLY IF … the
deliverable fulfills the ORIGINAL IDEA and the PRD … do not approve on assumption"), and Slice 4
added a literal-safe procedural nudge (state the required behavior + how you verified it). Prompt-
tuning a weak model is the trap the env gotcha warns about, so this is a MEASUREMENT, not a fix:
run the REAL NIM reviewer against a deliberately-WRONG-but-tests-pass build and RECORD whether it
catches the unmet spec (``changes_requested``) or rubber-stamps it (``approved``). The result
informs the rung-2 (D4) "use a stronger reviewer model" decision.

The negative fixture — a build where the tests pass but the SPEC is unmet:
  * idea/PRD: ``bulk_discount(price, quantity)`` = 10% off ONLY when ``quantity >= 10``, else the
    price unchanged.
  * the (wrong) build: ``bulk_discount`` applies 10% off ALWAYS, ignoring ``quantity``.
  * the shipped test covers ONLY the threshold case (``quantity == 10`` → discounted), which the
    wrong build passes — so ``pytest`` is GREEN while the ``quantity < 10`` branch (the spec) is
    both untested AND violated. A reviewer that gates on spec-met must say ``changes_requested``.

Drives ONE real reviewer node via the docker adapter (the same instruction ``agent_run_step`` builds
for an emitting node: REVIEWER_PROMPT + idea/PRD + brownfield grounding, scoped pull
``("REVIEW_VERDICT.json",)``), harvests the verdict, and records the outcome. Skips cleanly (exit
0) without ``NVIDIA_BUILD_API_KEY``. A NIM throttle / stuck is a retry on a clean roll, not a fail.
"""

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

_IDEA = (
    "Add a function `bulk_discount(price, quantity)` to the shop/discounts.py module. It returns "
    "`price` reduced by 10 percent when `quantity` is 10 or more, and returns `price` unchanged "
    "otherwise. Round money to 2 decimals like the other functions in that module. Keep the "
    "existing functions and the existing tests passing."
)

# A faithful stand-in for the PM's mini-PRD (the reviewer prompt says "the PRD below"): it restates
# the file path + the EXACT required behavior, including the quantity>=10 threshold the wrong build
# violates, so a spec-gating reviewer has the contract in hand.
_PRD = (
    "## Mini-PRD\n"
    "File: `shop/discounts.py`\n"
    "Add `bulk_discount(price, quantity)`:\n"
    "- WHEN `quantity >= 10`: return `price` reduced by 10 percent (rounded to 2 decimals).\n"
    "- OTHERWISE (`quantity < 10`): return `price` UNCHANGED.\n"
    "The quantity threshold is REQUIRED: a small-quantity order must NOT receive the discount.\n"
    "Keep `percentage_off` and the existing tests passing."
)

# The WRONG build: bulk_discount ignores `quantity` (always 10% off). The shipped test covers only
# the threshold case (quantity==10), which this wrong build passes -> pytest GREEN, spec UNMET.
_FILES = {
    "shop/__init__.py": '"""A tiny shop pricing package."""\n',
    "shop/discounts.py": (
        '"""Discount rules for the shop (pure money math; round to 2 decimals)."""\n\n\n'
        "def percentage_off(price, pct):\n"
        '    """Return ``price`` reduced by ``pct`` percent, rounded to 2 decimals."""\n'
        "    return round(price * (1 - pct / 100.0), 2)\n\n\n"
        "def bulk_discount(price, quantity):\n"
        '    """Return ``price`` reduced by 10 percent."""\n'
        "    # WRONG (deliberate negative fixture): ignores the quantity>=10 threshold — applies\n"
        "    # the discount ALWAYS. The spec requires the price unchanged when quantity < 10.\n"
        "    return round(price * 0.9, 2)\n"
    ),
    "shop/pricing.py": (
        '"""Cart pricing — composes the rules in :mod:`shop.discounts`."""\n\n'
        "from shop.discounts import percentage_off\n\n\n"
        "def cart_total(items):\n"
        '    """Sum ``items`` (each a ``(price, qty)`` pair); apply 5% loyalty discount."""\n'
        "    subtotal = sum(price * qty for price, qty in items)\n"
        "    return percentage_off(subtotal, 5)\n"
    ),
    "test_discounts.py": (
        "import unittest\n\n"
        "from shop.discounts import percentage_off, bulk_discount\n\n\n"
        "class TestDiscounts(unittest.TestCase):\n"
        "    def test_percentage_off(self):\n"
        "        self.assertEqual(percentage_off(100.0, 10), 90.0)\n\n"
        "    def test_bulk_discount_at_threshold(self):\n"
        "        # Only the threshold case is covered — the wrong build passes this.\n"
        "        self.assertEqual(bulk_discount(100.0, 10), 90.0)\n"
    ),
    "test_pricing.py": (
        "import unittest\n\n"
        "from shop.pricing import cart_total\n\n\n"
        "class TestPricing(unittest.TestCase):\n"
        "    def test_cart_total_applies_loyalty(self):\n"
        "        self.assertEqual(cart_total([(100.0, 2), (50.0, 1)]), 237.5)\n"
    ),
    "pyproject.toml": '[project]\nname = "shop"\nversion = "0.1.0"\n',
    "AGENTS.md": (
        "# Conventions\n\n"
        "- Keep functions small and pure; no side effects.\n"
        "- Money is rounded to 2 decimals (see `shop/discounts.py`).\n"
    ),
}


def _git(repo, *args, check=True):
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=check, capture_output=True, text=True
    )


def _make_wrong_build(root: str) -> Path:
    repo = Path(root) / "shop_repo"
    repo.mkdir(parents=True)
    for rel, content in _FILES.items():
        f = repo / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content, encoding="utf-8")
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "fixture@tvashtr.local")
    _git(repo, "config", "user.name", "Fixture User")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "shop package with a WRONG bulk_discount (tests pass, spec unmet)")
    return repo


def main() -> int:
    if not os.environ.get("NVIDIA_BUILD_API_KEY"):
        print("[reviewer-spec-gate] NVIDIA_BUILD_API_KEY not set — skipping. (Not a failure.)")
        return 0

    # Imported here (pulls openhands legitimately, like the live smokes) so the no-key skip stays
    # import-light and the offline suite is unaffected.
    from tvashtr.control_plane.team_run import _harvest_verdict
    from tvashtr.control_plane.teams import REVIEWER_PROMPT, reviewer_model
    from tvashtr.control_plane.worktree import build_repo_grounding
    from tvashtr.engines.base import AgentTask
    from tvashtr.engines.registry import resolve_adapter

    tmp = tempfile.mkdtemp(prefix="tvashtr-spec-gate-")
    repo: Path | None = None
    try:
        repo = _make_wrong_build(tmp)
        # Sanity: the wrong build's own tests are GREEN (so the reviewer can't gate on a red suite).
        pre = subprocess.run(
            ["python", "-m", "pytest", "-q"], cwd=str(repo), capture_output=True, text=True
        )
        print(
            f"[reviewer-spec-gate] wrong-build pytest exit={pre.returncode} "
            f"(0 = tests pass; the spec is still unmet for quantity < 10)"
        )

        # Build the reviewer instruction EXACTLY as agent_run_step does for an emitting node in a
        # brownfield run: REVIEWER_PROMPT + idea/PRD + grounding (orientation only; no protocol).
        grounding = build_repo_grounding(str(repo), repo.name)
        instruction = (
            REVIEWER_PROMPT
            + f"\n\n--- ORIGINAL IDEA ---\n{_IDEA}\n\n--- PRD ---\n{_PRD}"
            + f"\n\n{grounding}"
        )
        task = AgentTask(
            instruction=instruction,
            workspace_dir=str(repo),
            model=reviewer_model(),
            workspace_mode="brownfield",
            pull_paths=("REVIEW_VERDICT.json",),  # the Item-A read-only scope
        )
        print(
            f"[reviewer-spec-gate] running the REAL NIM reviewer ({reviewer_model()}) on the wrong "
            "build (docker+NIM)…"
        )
        adapter = resolve_adapter("openhands-docker")
        result = adapter.run(task)
        print(f"[reviewer-spec-gate] adapter status={result.status} changed={result.files_changed}")
        verdict = _harvest_verdict(str(repo))
        outcome = verdict.get("outcome")
        reasons = verdict.get("reasons")

        caught = outcome == "changes_requested"
        print("\n================= ITEM-C REVIEWER SPEC-GATE MEASUREMENT =================")
        print("negative fixture   = bulk_discount ignores quantity>=10 (tests pass, spec unmet)")
        print(f"reviewer outcome   = {outcome}")
        print(f"reviewer reasons   = {reasons}")
        label = "CAUGHT (changes_requested)" if caught else "RUBBER-STAMPED (approved)"
        print(f"\nITEM-C MEASUREMENT: {label}")
        if caught:
            print("  → the nudge + the prompt gate hold at rung 1 for this fixture (record it).")
        else:
            print(
                "  → finding 2 CONFIRMED: the 70b reviewer rubber-stamps tests-green even with the"
            )
            print(
                "    nudge. The D4 'recommend a stronger reviewer model for rung 2' lever stands."
            )
            print("    (Do NOT iterate the prompt to chase a pass — record and stop.)")
        print("========================================================================")
        # Either measured outcome is informative and PASSES (exit 0); non-zero only if the adapter
        # never produced a clean verdict to read (throttle/stuck -> retry on a clean roll).
        clean = result.status in ("completed", "failed") and outcome in (
            "approved",
            "changes_requested",
        )
        return 0 if clean else 2
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
