"""M-ctx0 (C9): the model-bench harness proves its plumbing OFFLINE — it imports, runs its full
scoring pipeline over canned (dry-run) completions, and emits a well-formed flat-JSON envelope +
summary table with NO live NIM. Also pins the deterministic success checks (crucially the reviewer
seat must correctly REJECT a deliberately-wrong build — the D4 measure) and the 429 detection.

``scripts/model_bench.py`` is a CLI script (not a package module), so it is loaded by file path —
no conftest/sys.path wiring needed. This satisfies acceptance #2: imports + runs its plumbing +
emits a well-formed table, with no live NIM required.
"""

import importlib.util
import json
from pathlib import Path

_BENCH_PATH = Path(__file__).resolve().parents[2] / "scripts" / "model_bench.py"

# A fixed 2-model pool (baseline + a 'nano') so the tests are independent of the default pool AND of
# any TVASHTR_BENCH_MODELS override in the environment. The dry-run makes 'nano' fail, others pass.
_MODELS = [
    "nvidia_nim/meta/llama-3.3-70b-instruct",
    "nvidia_nim/nvidia/llama-3.1-nemotron-nano-8b-v1",
]

_REQUIRED_ROW_KEYS = {
    "seat",
    "task",
    "model",
    "served_by",
    "ok",
    "success",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cost_usd",
    "latency_s",
    "http_429",
    "error",
}


def _load_bench():
    spec = importlib.util.spec_from_file_location("model_bench_under_test", _BENCH_PATH)
    assert spec and spec.loader, "could not create a spec for scripts/model_bench.py"
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bench = _load_bench()


def test_bench_module_loads_and_exposes_the_harness():
    for attr in ("run_bench", "format_table", "build_payload", "dry_run_complete", "TASKS", "main"):
        assert hasattr(bench, attr), f"model_bench must expose {attr}"
    # both seats present, scored by their own task
    seats = {task.seat for task in bench.TASKS}
    assert seats == {"worker", "reviewer"}


def test_dry_run_rows_are_wellformed_for_every_seat_and_model():
    results = bench.run_bench(_MODELS, bench.TASKS, bench.dry_run_complete)
    assert len(results) == len(bench.TASKS) * len(_MODELS)
    for row in results:
        missing = sorted(_REQUIRED_ROW_KEYS - set(row))
        assert not missing, f"row missing keys {missing}: {row}"
        assert isinstance(row["success"], bool)
        assert isinstance(row["ok"], bool)
        assert isinstance(row["prompt_tokens"], int)
        assert isinstance(row["completion_tokens"], int)
        assert isinstance(row["total_tokens"], int)
        assert isinstance(row["cost_usd"], float)
        assert isinstance(row["latency_s"], float)
        assert isinstance(row["http_429"], int)


def test_dry_run_table_is_wellformed():
    results = bench.run_bench(_MODELS, bench.TASKS, bench.dry_run_complete)
    table = bench.format_table(results)
    lines = table.splitlines()
    # header + separator rule + one line per row
    assert len(lines) == 2 + len(results)
    for column in ("SEAT", "MODEL", "OK", "SUCCESS", "COST_USD", "LAT_S", "429"):
        assert column in lines[0], f"table header missing {column}"


def test_build_payload_is_ledger_shaped_and_json_serializable():
    results = bench.run_bench(_MODELS, bench.TASKS, bench.dry_run_complete)
    payload = bench.build_payload(results, dry_run=True, models=_MODELS)
    assert payload["schema"] == "tvashtr.model_bench.v1"
    assert payload["dry_run"] is True
    assert payload["candidates"] == _MODELS
    assert payload["results"] == results
    # the future trajectory ledger consumes this — it must round-trip through JSON
    assert json.loads(json.dumps(payload))["results"] == results


def test_dry_run_exercises_both_a_pass_and_a_fail():
    results = bench.run_bench(_MODELS, bench.TASKS, bench.dry_run_complete)
    successes = [r for r in results if r["success"]]
    failures = [r for r in results if not r["success"]]
    assert successes, "dry-run should include passing rows (baseline model)"
    assert failures, "dry-run should include failing rows (the 'nano' model misses both seats)"


def test_worker_success_check_is_behavioural_and_discriminates():
    good = (
        "```python\n"
        "def bulk_discount(price, qty):\n"
        "    return price * qty * 0.9 if qty >= 12 else price * qty\n"
        "```"
    )
    wrong = "```python\ndef bulk_discount(price, qty):\n    return price * qty * 0.9\n```"
    assert bench.worker_success(good) is True
    assert bench.worker_success(wrong) is False  # always-discounts → wrong below the threshold
    assert bench.worker_success("there is no function here") is False


def test_reviewer_success_requires_a_correct_reject():
    # the D4 measure: correctly REJECT the wrong build; a rubber-stamp APPROVE is a miss
    assert bench.reviewer_success("REJECT — it ignores the qty >= 12 threshold") is True
    assert bench.reviewer_success("APPROVE\nlooks good to me") is False


def test_rate_limit_signature_detection():
    throttled = RuntimeError("all models failed: litellm.RateLimitError: 429 Too Many Requests")
    assert bench._is_rate_limit(throttled) == 1
    assert bench._is_rate_limit(RuntimeError("connection reset by peer")) == 0


def test_fallback_served_request_is_not_credited_as_success():
    # if a gateway fallback (not the requested model) serves the call, the candidate is unavailable
    # → ok=False and success stays False even though the (fallback's) text would pass the check.
    good_worker_text = bench._GOOD_WORKER_CODE

    def _fell_back(model, messages):
        return bench.Attempt(
            ok=False,
            text=good_worker_text,
            prompt_tokens=10,
            completion_tokens=10,
            total_tokens=20,
            cost_usd=0.0,
            latency_s=0.1,
            http_429=0,
            served_by="openrouter/google/gemini-flash-1.5",
            error="unavailable; fell back",
        )

    results = bench.run_bench(
        ["nvidia_nim/meta/llama-3.3-70b-instruct"], (bench.WORKER_TASK,), _fell_back
    )
    assert results[0]["ok"] is False
    assert results[0]["success"] is False
    assert results[0]["served_by"] == "openrouter/google/gemini-flash-1.5"


def test_resolve_api_key_maps_nim_and_returns_none_when_absent(monkeypatch):
    monkeypatch.setenv("NVIDIA_BUILD_API_KEY", "nim-key")
    assert bench.resolve_api_key("nvidia_nim/meta/llama-3.3-70b-instruct") == "nim-key"
    monkeypatch.delenv("NVIDIA_BUILD_API_KEY", raising=False)
    monkeypatch.delenv("NVIDIA_NIM_API_KEY", raising=False)
    assert bench.resolve_api_key("nvidia_nim/meta/llama-3.3-70b-instruct") is None
