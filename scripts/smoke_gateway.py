#!/usr/bin/env python
"""Opt-in *live* smoke test for the model gateway.

Makes exactly ONE real completion against the configured default model — but
only if ``OPENROUTER_API_KEY`` is present in the environment. With no key it
skips cleanly (exit 0): a skip is NOT a failure, so CI never depends on a paid
endpoint. A ``cost_usd`` of ``0.0`` is also valid (free tier) and must not read
as an error — token counts are the meaningful signal.

Run via ``make smoke``.
"""

import os
import sys


def main() -> int:
    if not os.environ.get("OPENROUTER_API_KEY"):
        print(
            "[smoke] OPENROUTER_API_KEY not set — skipping live gateway smoke.\n"
            "        Set it in .env to exercise a real provider call. (Not a failure.)"
        )
        return 0

    # Import lazily so the no-key skip above never pays the litellm import cost.
    from tvashtr.config import get_settings
    from tvashtr.gateway import CompletionRequest, complete

    settings = get_settings()
    print(
        f"[smoke] gateway.complete() default_model={settings.default_model!r} "
        f"fallbacks={settings.model_fallbacks}"
    )
    request = CompletionRequest(
        model=settings.default_model,
        messages=[{"role": "user", "content": "Reply with exactly the word: pong"}],
        temperature=0.0,
        max_tokens=16,
    )
    result = complete(request)

    print("[smoke] OK — one live completion returned:")
    print(f"  model_requested   = {result.model_requested}")
    print(f"  model_used        = {result.model_used}")
    print(f"  provider          = {result.raw_provider}")
    print(f"  prompt_tokens     = {result.prompt_tokens}")
    print(f"  completion_tokens = {result.completion_tokens}")
    print(f"  total_tokens      = {result.total_tokens}")
    print(f"  cost_usd          = {result.cost_usd}   (0.0 is valid on a free tier)")
    print(f"  latency_ms        = {result.latency_ms:.1f}")
    print(f"  text              = {result.text!r}")

    if result.total_tokens <= 0:
        print(
            "[smoke] WARNING: provider returned no token usage (total_tokens=0).",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
