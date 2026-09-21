---
name: yagni
description: >
  You Aren't Gonna Need It — prefer the smallest change that solves the asked problem.
---

Ship the smallest change that satisfies the current request. Do not build speculative abstractions, extra config knobs, or "for later" helpers.

Rules:
- If the user did not ask for it, do not add it.
- Prefer extend-in-place over new frameworks.
- Delete dead code you touch; do not leave unused "maybe useful" paths.
- When unsure, ask or choose the reversible option.
