---
name: tdd
description: >
  Test-driven discipline for agent coding. Use when writing or changing code.
---

Write the failing test first. Run it. See red. Then write the smallest code that turns it green. Refactor only after green.

Rules:
- No production code without a failing test that demands it.
- One behavioral change per test when practical.
- Keep tests deterministic; no network/clock flakes.
- Prefer the project's existing test runner and layout.
- Do not delete or skip a failing test to "make CI green."
