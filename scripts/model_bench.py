#!/usr/bin/env python
"""C9 — model bench: race the candidate worker/reviewer models through the existing
LiteLLM→NIM path (the ``tvashtr.gateway`` completion seam — the codebase's ONLY litellm
importer) against fixed tasks, scoring per candidate: task success, tokens in/out, cost,
wall-clock latency, and 429 count.

Two seats, scored separately (the D4 finding — a 70b rubber-stamps spec violations, so the
reviewer seat needs its OWN success measure, not the worker's):
  • WORKER   — a small deterministic coding task; success = the produced function actually
               behaves per the spec (a safe, restricted ``exec`` of the extracted function).
  • REVIEWER — the SAME spec plus a deliberately-WRONG submission; success = the model correctly
               REJECTS it (a rubber-stamp "APPROVE" is a fail). This is exactly the seat measure
               D4 asked for.

Output: a flat JSON list (``schema=tvashtr.model_bench.v1``) the future trajectory ledger can
consume, plus a compact TABLE echoed to the terminal.

Offline vs live:
  • ``--dry-run`` — canned, deterministic responses; NO network, NO keys. Proves the whole harness
    (routing shape, scoring, both success checks, table + JSON) with no NVIDIA quota. This is what
    the offline smoke test exercises.
  • default (live) — resolves each candidate's provider key from the environment and calls the
    gateway. Skips cleanly (exit 0, NOT a failure) if no candidate has a resolvable key — mirrors
    ``make smoke``. When NIM is throttled it reports a PARTIAL table + reason, not blocking.

The candidate slugs are best-known NIM slugs and are overridable with ``TVASHTR_BENCH_MODELS``
(comma-separated) so the operator can correct a slug for the live run without a code change; an
unknown/unavailable slug is recorded as a per-candidate failure row, never a crash. Run via
``make model-bench`` (live) or ``python scripts/model_bench.py --dry-run`` (offline).
"""

import argparse
import json
import os
import re
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass

_SCHEMA = "tvashtr.model_bench.v1"

# Best-known NIM slugs for the candidate pool (baseline + the two Nemotron-3 sizes + Kimi-K2),
# overridable via TVASHTR_BENCH_MODELS. All four run through BOTH seats so the table shows each
# model's worker-success AND reviewer-success (the "which model for which seat" question).
_DEFAULT_MODELS = (
    "nvidia_nim/meta/llama-3.3-70b-instruct",  # baseline (the proven live-loop worker)
    "nvidia_nim/nvidia/llama-3.3-nemotron-super-49b-v1",  # Nemotron-3 super
    "nvidia_nim/nvidia/llama-3.1-nemotron-nano-8b-v1",  # Nemotron-3 nano
    "nvidia_nim/moonshotai/kimi-k2-instruct",  # Kimi-K2 (NIM-hosted)
)

# Provider prefix → the env var(s) holding its key, tried in order. A standalone bench is NOT a
# run with an owner, so (unlike the BYOK agent path) it resolves keys from the environment here —
# the pre-M-accounts provider→env mapping, kept local to this script (config.py is untouched).
_PROVIDER_ENV: dict[str, tuple[str, ...]] = {
    "nvidia_nim": ("NVIDIA_BUILD_API_KEY", "NVIDIA_NIM_API_KEY"),
    "gemini": ("GEMINI_API_KEY",),
    "groq": ("GROQ_CLOUD_API_KEY", "GROQ_API_KEY"),
    "openai": ("OPENAI_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "moonshot": ("MOONSHOT_API_KEY",),
}

# Per-call output ceiling for the bench (small = cheap + fast + comparable). Overridable.
_DEFAULT_MAX_TOKENS = int(os.environ.get("TVASHTR_BENCH_MAX_TOKENS", "512"))

_RATE_LIMIT_SIGNATURES = ("429", "rate limit", "ratelimit", "rate_limit", "too many requests")


@dataclass
class Attempt:
    """One candidate's single completion, normalized away from the gateway's result type so the
    live and dry-run paths share a shape. ``ok`` = the REQUESTED model itself served (a gateway
    fallback serving instead ⇒ ``ok=False`` + ``served_by`` names the fallback)."""

    ok: bool
    text: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cost_usd: float
    latency_s: float
    http_429: int
    served_by: str
    error: str | None


@dataclass
class BenchTask:
    """A fixed seat task: the prompt messages + a deterministic success check on the output."""

    seat: str
    name: str
    messages: list[dict[str, str]]
    check: Callable[[str], bool]


# ---------------------------------------------------------------------------
# The fixed tasks + their deterministic success checks
# ---------------------------------------------------------------------------

# One coherent spec shared by both seats: a bulk-discount rule with a threshold, so the reviewer's
# WRONG submission (always discounts, ignoring the threshold) is an unambiguous spec violation.
_SPEC = (
    "Implement `def bulk_discount(price, qty)` returning the order total for `qty` units at "
    "`price` each, applying a 10% discount to the WHOLE order ONLY when `qty >= 12` (otherwise "
    "no discount)."
)

_WORKER_MESSAGES = [
    {
        "role": "system",
        "content": "You are a precise coding worker. Output ONLY one Python function inside a "
        "```python fenced block — no prose, no tests, no explanation.",
    },
    {"role": "user", "content": _SPEC + " Reply with only the function."},
]

# A deliberately-WRONG submission for the reviewer seat: it applies the discount unconditionally,
# violating the `qty >= 12` threshold. The correct verdict is REJECT.
_WRONG_SUBMISSION = (
    "def bulk_discount(price, qty):\n    return price * qty * 0.9  # 10% off, always\n"
)
_REVIEWER_MESSAGES = [
    {
        "role": "system",
        "content": "You are a strict, literal code reviewer. Reply on the FIRST line with exactly "
        "APPROVE or REJECT, then one short line of reason. Reject any submission that does not "
        "match the spec exactly.",
    },
    {
        "role": "user",
        "content": f"SPEC: {_SPEC}\n\nSUBMISSION:\n```python\n{_WRONG_SUBMISSION}```\n\n"
        "Does the submission satisfy the spec?",
    },
]

_CODE_FENCE = re.compile(r"```(?:python)?\s*(.*?)```", re.DOTALL | re.IGNORECASE)
# A tiny, restricted builtins set for exec-checking the worker's function. `exec` here runs only
# short functions from trusted coding models, in a namespace with NO import/open/eval (so the
# obvious escapes are gone); any error/timeout-shaped failure just scores the candidate as a miss.
_SAFE_BUILTINS = {
    "round": round,
    "min": min,
    "max": max,
    "abs": abs,
    "float": float,
    "int": int,
    "len": len,
    "sum": sum,
    "range": range,
}


def _extract_code(text: str) -> str:
    """The first ```python fenced block, else the whole response (some models skip the fence)."""
    match = _CODE_FENCE.search(text)
    return (match.group(1) if match else text).strip()


def worker_success(text: str) -> bool:
    """True iff the produced ``bulk_discount`` behaves per the spec at the boundary + below it."""
    code = _extract_code(text)
    if "def bulk_discount" not in code:
        return False
    namespace: dict = {}
    try:
        exec(code, {"__builtins__": _SAFE_BUILTINS}, namespace)
        fn = namespace.get("bulk_discount")
        if not callable(fn):
            return False
        # qty >= 12 ⇒ 10% off the whole order (120 → 108); qty < 12 ⇒ no discount (50 stays 50).
        return abs(fn(10.0, 12) - 108.0) < 1e-9 and abs(fn(10.0, 5) - 50.0) < 1e-9
    except Exception:
        return False


def reviewer_success(text: str) -> bool:
    """True iff the model correctly REJECTS the wrong build (a rubber-stamp APPROVE is a miss)."""
    for line in text.strip().splitlines():
        token = line.strip().upper()
        if not token:
            continue
        if token.startswith("REJECT"):
            return True
        if token.startswith("APPROVE"):
            return False
    upper = text.upper()
    return "REJECT" in upper and "APPROVE" not in upper


WORKER_TASK = BenchTask("worker", "bulk_discount", _WORKER_MESSAGES, worker_success)
REVIEWER_TASK = BenchTask("reviewer", "reject_wrong_build", _REVIEWER_MESSAGES, reviewer_success)
TASKS = (WORKER_TASK, REVIEWER_TASK)


# ---------------------------------------------------------------------------
# Completion backends: live (gateway) + dry-run (canned)
# ---------------------------------------------------------------------------


def bench_models() -> list[str]:
    """The candidate pool — ``TVASHTR_BENCH_MODELS`` (comma-separated) overrides the defaults."""
    override = os.environ.get("TVASHTR_BENCH_MODELS", "").strip()
    if override:
        return [m.strip() for m in override.split(",") if m.strip()]
    return list(_DEFAULT_MODELS)


def resolve_api_key(model: str) -> str | None:
    """The provider key for ``model`` from the environment (bench-local mapping), or None."""
    provider = model.split("/", 1)[0]
    for env_name in _PROVIDER_ENV.get(provider, ("OPENROUTER_API_KEY",)):
        value = os.environ.get(env_name)
        if value:
            return value
    return None


def _is_rate_limit(exc: BaseException) -> int:
    """1 if a 429 / rate-limit signature appears anywhere in the exception's cause chain, else 0."""
    parts: list[str] = []
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen and len(parts) < 20:
        seen.add(id(current))
        parts.append(str(current))
        current = current.__cause__ or current.__context__
    blob = " ".join(parts).lower()
    return 1 if any(sig in blob for sig in _RATE_LIMIT_SIGNATURES) else 0


def _err_attempt(message: str, http_429: int = 0) -> Attempt:
    return Attempt(
        ok=False,
        text="",
        prompt_tokens=0,
        completion_tokens=0,
        total_tokens=0,
        cost_usd=0.0,
        latency_s=0.0,
        http_429=http_429,
        served_by="",
        error=message,
    )


def make_live_complete(max_tokens: int) -> Callable[[str, list[dict[str, str]]], Attempt]:
    """A live completion fn over the gateway (the LiteLLM→NIM seam), imported lazily so a bare
    import / ``--dry-run`` never pays the gateway+litellm import cost (like ``smoke_gateway``)."""
    from tvashtr.gateway import CompletionRequest, GatewayError, complete

    def _complete(model: str, messages: list[dict[str, str]]) -> Attempt:
        api_key = resolve_api_key(model)
        if not api_key:
            return _err_attempt(f"no API key for provider {model.split('/', 1)[0]!r}")
        request = CompletionRequest(
            model=model,
            messages=messages,
            temperature=0.0,
            max_tokens=max_tokens,
            api_key=api_key,
        )
        try:
            result = complete(request)
        except GatewayError as exc:
            return _err_attempt(str(exc)[:300], http_429=_is_rate_limit(exc))
        except Exception as exc:  # one bad candidate must never crash the whole bench
            return _err_attempt(
                f"{type(exc).__name__}: {str(exc)[:200]}", http_429=_is_rate_limit(exc)
            )
        # The gateway fails a down/throttled model over to `model_fallbacks`; a fallback serving
        # the request means the REQUESTED candidate was unavailable — score it, never credit it.
        served_the_request = result.model_used == model
        return Attempt(
            ok=served_the_request,
            text=result.text,
            prompt_tokens=result.prompt_tokens,
            completion_tokens=result.completion_tokens,
            total_tokens=result.total_tokens,
            cost_usd=result.cost_usd,
            latency_s=result.latency_ms / 1000.0,
            http_429=0,
            served_by=result.model_used,
            error=None if served_the_request else f"unavailable; fell back to {result.model_used}",
        )

    return _complete


# Canned responses for --dry-run. A slug containing "nano" (the smallest model) returns a WRONG
# answer, so the offline table exercises BOTH a passing and a failing row through the real checks.
_GOOD_WORKER_CODE = (
    "```python\ndef bulk_discount(price, qty):\n    total = price * qty\n"
    "    if qty >= 12:\n        total = total * 0.9\n    return total\n```"
)
_WRONG_WORKER_CODE = "```python\ndef bulk_discount(price, qty):\n    return price * qty * 0.9\n```"


def dry_run_complete(model: str, messages: list[dict[str, str]]) -> Attempt:
    """Deterministic offline stand-in for a real completion — no network, no keys."""
    joined = "\n".join(m.get("content", "") for m in messages)
    is_reviewer = "APPROVE" in joined and "REJECT" in joined
    weak = "nano" in model
    if is_reviewer:
        text = (
            "APPROVE — looks fine."
            if weak
            else "REJECT — discount applied unconditionally, but the spec requires qty >= 12."
        )
    else:
        text = _WRONG_WORKER_CODE if weak else _GOOD_WORKER_CODE
    prompt_tokens = max(1, len(joined) // 4)
    completion_tokens = max(1, len(text) // 4)
    return Attempt(
        ok=True,
        text=text,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        cost_usd=0.0,
        latency_s=0.0,
        http_429=0,
        served_by=model,
        error=None,
    )


# ---------------------------------------------------------------------------
# Scoring + reporting
# ---------------------------------------------------------------------------


def run_candidate(
    task: BenchTask, model: str, complete_fn: Callable[[str, list[dict[str, str]]], Attempt]
) -> dict:
    """Score one (seat, model): call the completion, run the success check, return a flat row."""
    started = time.perf_counter()
    attempt = complete_fn(model, task.messages)
    wall_s = round(time.perf_counter() - started, 3)
    # `ok` short-circuits: a fell-back / errored candidate is never credited a success.
    success = bool(attempt.ok and task.check(attempt.text))
    return {
        "seat": task.seat,
        "task": task.name,
        "model": model,
        "served_by": attempt.served_by or model,
        "ok": attempt.ok,
        "success": success,
        "prompt_tokens": attempt.prompt_tokens,
        "completion_tokens": attempt.completion_tokens,
        "total_tokens": attempt.total_tokens,
        "cost_usd": round(attempt.cost_usd, 6),
        # Prefer the provider-reported latency (from the Attempt); fall back to the wall clock.
        "latency_s": round(attempt.latency_s, 3) if attempt.latency_s else wall_s,
        "http_429": attempt.http_429,
        "error": attempt.error,
    }


def run_bench(
    models: list[str],
    tasks: tuple[BenchTask, ...],
    complete_fn: Callable[[str, list[dict[str, str]]], Attempt],
) -> list[dict]:
    """Every (seat, model) pair, scored — the flat rows the ledger + the table consume."""
    return [run_candidate(task, model, complete_fn) for task in tasks for model in models]


def build_payload(results: list[dict], *, dry_run: bool, models: list[str]) -> dict:
    """The trajectory-ledger-shaped envelope around the flat result rows."""
    return {
        "schema": _SCHEMA,
        "generated_by": "scripts/model_bench.py",
        "dry_run": dry_run,
        "candidates": models,
        "results": results,
    }


def _short(model: str) -> str:
    """Trailing slug segment, width-capped for the table (the full slug stays in the JSON)."""
    tail = model.split("/")[-1]
    return tail if len(tail) <= 34 else tail[:31] + "..."


def format_table(results: list[dict]) -> str:
    """A compact, aligned ASCII summary table of the flat rows."""
    headers = ["SEAT", "MODEL", "OK", "SUCCESS", "P_TOK", "C_TOK", "COST_USD", "LAT_S", "429"]
    rows = [
        [
            r["seat"],
            _short(r["model"]),
            "yes" if r["ok"] else "no",
            "PASS" if r["success"] else "FAIL",
            str(r["prompt_tokens"]),
            str(r["completion_tokens"]),
            f"{r['cost_usd']:.6f}",
            f"{r['latency_s']:.2f}",
            str(r["http_429"]),
        ]
        for r in results
    ]
    widths = [
        max(len(headers[i]), *(len(row[i]) for row in rows)) if rows else len(headers[i])
        for i in range(len(headers))
    ]

    def _fmt(cols: list[str]) -> str:
        return "  ".join(col.ljust(widths[i]) for i, col in enumerate(cols))

    lines = [_fmt(headers), _fmt(["-" * w for w in widths])]
    lines.extend(_fmt(row) for row in rows)
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Race worker/reviewer candidate models (C9 bench)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="offline: canned responses, no network/keys (proves the harness).",
    )
    parser.add_argument("--json", dest="json_path", default=None, help="write the flat JSON here.")
    parser.add_argument(
        "--max-tokens", type=int, default=_DEFAULT_MAX_TOKENS, help="per-call output ceiling."
    )
    args = parser.parse_args(argv)

    models = bench_models()

    if args.dry_run:
        complete_fn: Callable[[str, list[dict[str, str]]], Attempt] = dry_run_complete
        mode = "dry-run (offline; canned responses)"
    else:
        if not any(resolve_api_key(m) for m in models):
            print(
                "[model-bench] no provider API key found for any candidate; set "
                "NVIDIA_BUILD_API_KEY etc. in .env. Skipping the live bench (not a failure)."
            )
            print(
                "[model-bench] prove the harness offline with: "
                "python scripts/model_bench.py --dry-run"
            )
            return 0
        complete_fn = make_live_complete(args.max_tokens)
        mode = "live (LiteLLM→NIM gateway)"

    print(f"[model-bench] mode: {mode}")
    print(f"[model-bench] candidates: {models}")
    results = run_bench(models, TASKS, complete_fn)
    print(format_table(results))

    payload = build_payload(results, dry_run=args.dry_run, models=models)
    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        print(f"[model-bench] wrote {len(results)} result rows → {args.json_path}")

    served = sum(1 for r in results if r["ok"])
    n_429 = sum(r["http_429"] for r in results)
    if not args.dry_run and served < len(results):
        print(
            f"[model-bench] PARTIAL: {served}/{len(results)} calls served by the requested model; "
            f"{n_429} explicit 429(s). Unserved rows are throttled/unavailable/fell-back "
            "(see each row's 'error'). Re-run when NVIDIA quota frees up for the full table."
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
