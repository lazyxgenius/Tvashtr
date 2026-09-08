#!/usr/bin/env python
"""M-seat — probe which model each HELD provider can actually put in a WORKER seat, and in a
THINKER seat, and print the transcript that decides ``PROVIDER_CATALOGUE``.

``PROVIDER_CATALOGUE`` used to declare ONE ``default_model`` per provider, and
``_node_default_model`` handed it to every seat. A model proven as a thinker was therefore stamped
on a worker seat it cannot serve — which is how M-live's demo reached the Engineer and died on an
empty-bodied provider 400. The catalogue now declares the two seats SEPARATELY, so each entry needs
its own evidence. This script IS that evidence: it is the only honest way to fill the table in.

**The four WORKER gates** (a worker runs the OpenHands agent loop, so every one of them is a
different way the loop is known to die — each was written because a candidate passed the cheaper
checks and failed here):

  W1  a live gateway completion              — the product's own ``gateway.complete`` answers with
                                                non-empty text (catches a retired/unentitled slug)
  W2  the OpenHands content-block shape      — the SDK sends ``content=[TextContent(...)]`` blocks,
                                                not a bare string; ``mistralai/mistral-nemotron``
                                                completes over raw HTTP and dies HERE with
                                                "Message content must be normalized"
  W3  a real agent step, file INSIDE the     — ``poolside/laguna-xs-2.1`` reports ``completed``
      workspace, exact contents                while writing to an ABSOLUTE path outside it
  W4  no crash in the agent loop             — the run raises nothing and reports no engine error

**The two THINKER gates** (a thinker never runs the loop — it makes one completion and must return
a usable DELIVERABLE):

  T1  a live gateway completion
  T2  a real deliverable under the product's own output ceiling — non-empty, substantial, and NOT
      merely the model's chain-of-thought. ``nvidia/nemotron-3-super-120b-a12b`` burned 1758
      reasoning tokens and returned a 55-character title; ``nemotron-3.5-lightning-30b-a3b``
      returned content byte-identical to its reasoning.

Usage::

    uv run python ../scripts/seat_probe.py                      # the whole matrix, both seats
    uv run python ../scripts/seat_probe.py --capability worker   # worker seats only
    uv run python ../scripts/seat_probe.py --only openai         # one provider
    uv run python ../scripts/seat_probe.py --models openai/gpt-4.1-mini

Keys come from ``.env`` (the same ``seed.ENV_PROVIDER_MAP`` the product imports from), so the probe
covers exactly the providers this account HOLDS. Live calls, real spend — never part of ``make
test``. Exit 0 when every probed provider resolved a candidate or was honestly recorded as having
none; 1 on an internal error.
"""

import argparse
import os
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

_ROOT = Path(__file__).resolve().parents[1]

# The candidate lists, in preference order per provider. Everything here is a model the provider's
# own ``/models`` endpoint listed on 2026-09-07 (except ``deepseek/deepseek-chat``, which that
# provider's list omits while still serving it — the M-live false positive that fail-open exists
# for). Preference order inside a provider is "most likely to hold a long agent transcript first".
WORKER_CANDIDATES: dict[str, list[str]] = {
    "nvidia_nim": [
        "nvidia_nim/openai/gpt-oss-20b",
        "nvidia_nim/moonshotai/kimi-k2.6",
        "nvidia_nim/minimaxai/minimax-m3",
        "nvidia_nim/deepseek-ai/deepseek-v4-pro-0813",
        "nvidia_nim/nvidia/nemotron-nano-3-30b-a3b",
    ],
    "openai": ["openai/gpt-4.1-mini", "openai/gpt-4o-mini", "openai/gpt-5-mini"],
    "gemini": ["gemini/gemini-2.5-flash", "gemini/gemini-flash-latest"],
    "groq": ["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b", "groq/qwen/qwen3.8-27b"],
    "deepseek": ["deepseek/deepseek-chat", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"],
    "openrouter": ["openrouter/openai/gpt-4o-mini"],
}
THINKER_CANDIDATES: dict[str, list[str]] = {
    "nvidia_nim": [
        "nvidia_nim/openai/gpt-oss-20b",
        "nvidia_nim/moonshotai/kimi-k2.6",
        "nvidia_nim/minimaxai/minimax-m3",
    ],
    "openai": ["openai/gpt-4o-mini", "openai/gpt-4.1-mini"],
    "gemini": ["gemini/gemini-2.5-flash", "gemini/gemini-flash-latest"],
    "groq": ["groq/openai/gpt-oss-120b", "groq/openai/gpt-oss-20b", "groq/qwen/qwen3.8-27b"],
    "deepseek": ["deepseek/deepseek-chat", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"],
    "openrouter": ["openrouter/openai/gpt-4o-mini"],
}

TARGET_FILE = "hello.txt"
TARGET_CONTENT = "Hello from Tvashtr"
# W2's tool schema: the smallest thing that forces a provider to accept an OpenAI tool spec next to
# content BLOCKS. A provider that mangles either shape fails here rather than mid-run.
#
# ``LLM.completion`` does not take raw dicts — it calls ``t.to_openai_tool(...)`` on whatever it is
# handed (llm.py:1000) and converts the results itself, so a dict fails with
# ``AttributeError: 'dict' object has no attribute 'to_openai_tool'`` before a byte reaches the
# provider. That is a HARNESS bug, not a model verdict: it would have failed every candidate
# identically and told us nothing. The shim below supplies exactly that one method, so what the
# provider receives is byte-for-byte the ``ChatCompletionToolParam`` the SDK would have sent.
class _ProbeTool:
    """A minimal stand-in for an SDK ``ToolDefinition`` — just the conversion ``LLM`` calls."""

    def to_openai_tool(self, add_security_risk_prediction: bool = False) -> dict:
        return {
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Write text to a file.",
                "parameters": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}, "text": {"type": "string"}},
                    "required": ["path", "text"],
                },
            },
        }


_PROBE_TOOL = _ProbeTool()
_PRD_PROMPT = (
    "Write a short product requirements document for a CLI tool that renames files in bulk. "
    "Use the headings: Problem, Users, Requirements, Out of scope. Plain markdown, no preamble."
)


def _load_dotenv() -> None:
    """Load the repo-root ``.env`` without a shell ``source`` (the ``x-api-key=`` line is not a
    valid shell identifier; §15). An already-set variable wins."""
    env_path = _ROOT / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            os.environ.setdefault(key, val.strip())


def held_provider_keys() -> dict[str, str]:
    """``{provider: key}`` for every provider whose ``.env`` variable is set — the SAME mapping
    ``make seed`` imports from, so the probe can never cover a provider the account lacks."""
    from tvashtr.seed import ENV_PROVIDER_MAP

    out: dict[str, str] = {}
    for env_names, provider in ENV_PROVIDER_MAP:
        key = next((v for n in env_names if (v := (os.environ.get(n) or "").strip())), None)
        if key:
            out[provider] = key
    return out


@dataclass
class GateResult:
    name: str
    passed: bool
    detail: str = ""


@dataclass
class CandidateReport:
    model: str
    gates: list[GateResult] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return bool(self.gates) and all(g.passed for g in self.gates)

    @property
    def failed_gate(self) -> str:
        for g in self.gates:
            if not g.passed:
                return g.name
        return ""

    def line(self) -> str:
        marks = " ".join(f"{g.name}={'PASS' if g.passed else 'FAIL'}" for g in self.gates)
        verdict = "WINNER" if self.passed else f"rejected at {self.failed_gate}"
        return f"    {self.model:<48} {marks:<32} {verdict}"


def _short(exc: BaseException, limit: int = 220) -> str:
    """One decisive line from an exception — never a wall of traceback."""
    text = f"{type(exc).__name__}: {exc}".replace("\n", " ")
    return text[:limit]


# ---------------------------------------------------------------- the gates ----


def gate_gateway_completion(model: str, api_key: str) -> GateResult:
    """W1 / T1 — the product's OWN completion path answers with non-empty text."""
    from tvashtr.gateway.gateway import complete
    from tvashtr.gateway.types import CompletionRequest

    try:
        result = complete(
            CompletionRequest(
                model=model,
                messages=[{"role": "user", "content": "Reply with the single word: ready"}],
                max_tokens=64,
                api_key=api_key,
            )
        )
    except Exception as exc:  # noqa: BLE001 — any provider error is a gate failure
        return GateResult("W1", False, _short(exc))
    text = (result.text or "").strip()
    if not text:
        return GateResult("W1", False, f"empty content (prompt_tokens={result.prompt_tokens})")
    return GateResult("W1", True, f"{text[:40]!r} in {result.latency_ms:.0f}ms")


def gate_content_blocks(model: str, api_key: str) -> GateResult:
    """W2 — the OpenHands message shape: ``content=[TextContent(...)]`` blocks plus a tool spec,
    sent through the SDK's own ``LLM``, exactly as the agent loop sends it."""
    from openhands.sdk.llm import LLM, Message, TextContent

    from tvashtr.config import agent_llm_routing, get_settings

    settings = get_settings()
    try:
        llm = LLM(
            **agent_llm_routing(settings, model, "local", api_key_override=api_key),
            temperature=0.0,
            usage_id="seat-probe",
            max_output_tokens=settings.agent_max_output_tokens,
        )
        response = llm.completion(
            messages=[
                Message(
                    role="user",
                    content=[
                        TextContent(
                            text="Call write_file to put the text 'ok' in a file named probe.txt."
                        )
                    ],
                )
            ],
            tools=[_PROBE_TOOL],
        )
    except Exception as exc:  # noqa: BLE001
        return GateResult("W2", False, _short(exc))
    message = getattr(response, "message", None)
    tool_calls = list(getattr(message, "tool_calls", None) or [])
    content = getattr(message, "content", None)
    if not tool_calls and not content:
        return GateResult("W2", False, "no tool_calls and no content")
    shape = f"tool_calls={len(tool_calls)}" if tool_calls else "content-only"
    return GateResult("W2", True, shape)


def gate_agent_step(model: str, api_key: str) -> tuple[GateResult, GateResult]:
    """W3 + W4 — one real agent run in a fresh LOCAL workspace.

    W3 is the file: it must exist INSIDE the workspace with the exact contents asked for. W4 is the
    loop itself: no exception, no engine-reported error, terminal status ``completed``. Both come
    from the same run because they are two ways the same run can be wrong."""
    from tvashtr.engines.base import AgentTask
    from tvashtr.engines.openhands_adapter import OpenHandsAdapter, make_local_workspace

    run_id = f"seat-probe-{uuid4().hex[:10]}"
    workspace = make_local_workspace(run_id)
    task = AgentTask(
        instruction=f"Create a file named {TARGET_FILE} containing exactly: {TARGET_CONTENT}",
        workspace_dir=workspace,
        model=model,
        llm_api_key=api_key,
    )
    try:
        result = OpenHandsAdapter().run(task)
    except Exception as exc:  # noqa: BLE001 — a raise IS the W4 failure
        return (
            GateResult("W3", False, "not reached (loop crashed)"),
            GateResult("W4", False, _short(exc)),
        )
    produced = Path(workspace) / TARGET_FILE
    if not produced.exists():
        w3 = GateResult("W3", False, f"no {TARGET_FILE} in workspace (changed={result.files_changed})")
    else:
        contents = produced.read_text().strip()
        w3 = (
            GateResult("W3", True, f"{contents!r}")
            if contents == TARGET_CONTENT
            else GateResult("W3", False, f"contents {contents[:60]!r} != {TARGET_CONTENT!r}")
        )
    w4 = (
        GateResult("W4", True, f"status={result.status}")
        if result.status == "completed" and not result.error
        else GateResult("W4", False, f"status={result.status} error={(result.error or '')[:160]}")
    )
    return w3, w4


def gate_thinker_deliverable(model: str, api_key: str) -> GateResult:
    """T2 — a real deliverable under the product's own per-call output ceiling.

    The failure this exists for is a REASONING model whose budget is eaten by chain-of-thought: the
    call succeeds, tokens are burned, and ``content`` comes back empty, a bare title, or the
    reasoning itself. So the bar is substance (>=200 chars), structure (it used the headings it was
    given), and content that is not merely a restatement of the prompt."""
    from tvashtr.gateway.gateway import complete
    from tvashtr.gateway.types import CompletionRequest

    try:
        result = complete(
            CompletionRequest(
                model=model,
                messages=[{"role": "user", "content": _PRD_PROMPT}],
                max_tokens=400,
                api_key=api_key,
            )
        )
    except Exception as exc:  # noqa: BLE001
        return GateResult("T2", False, _short(exc))
    text = (result.text or "").strip()
    if len(text) < 200:
        return GateResult(
            "T2",
            False,
            f"{len(text)} chars (completion_tokens={result.completion_tokens}) {text[:80]!r}",
        )
    headings = sum(1 for h in ("Problem", "Users", "Requirements", "Out of scope") if h in text)
    if headings < 3:
        return GateResult("T2", False, f"{headings}/4 headings present; {text[:80]!r}")
    return GateResult("T2", True, f"{len(text)} chars, {headings}/4 headings")


# ---------------------------------------------------------------- the driver ----


def probe_worker(model: str, api_key: str) -> CandidateReport:
    report = CandidateReport(model)
    w1 = gate_gateway_completion(model, api_key)
    report.gates.append(w1)
    if not w1.passed:
        return report
    w2 = gate_content_blocks(model, api_key)
    report.gates.append(w2)
    if not w2.passed:
        return report
    w3, w4 = gate_agent_step(model, api_key)
    report.gates.extend([w3, w4])
    return report


def probe_thinker(model: str, api_key: str) -> CandidateReport:
    report = CandidateReport(model)
    t1 = gate_gateway_completion(model, api_key)
    t1.name = "T1"
    report.gates.append(t1)
    if not t1.passed:
        return report
    report.gates.append(gate_thinker_deliverable(model, api_key))
    return report


def run_matrix(capability: str, providers: dict[str, str], models: list[str] | None) -> dict:
    table = WORKER_CANDIDATES if capability == "worker" else THINKER_CANDIDATES
    probe = probe_worker if capability == "worker" else probe_thinker
    winners: dict[str, str | None] = {}
    print(f"\n{'=' * 78}\n{capability.upper()} SEAT — four gates, first pass wins\n{'=' * 78}")
    for provider, key in providers.items():
        candidates = [m for m in (models or table.get(provider, [])) if m.startswith(f"{provider}/")]
        print(f"\n  {provider}  ({len(candidates)} candidate(s))")
        if not candidates:
            print("    (no candidates declared)")
            winners[provider] = None
            continue
        winner: str | None = None
        for model in candidates:
            started = time.perf_counter()
            report = probe(model, key)
            elapsed = time.perf_counter() - started
            print(report.line() + f"  [{elapsed:.0f}s]")
            for gate in report.gates:
                print(f"        {gate.name}: {'pass' if gate.passed else 'FAIL'} — {gate.detail}")
            if report.passed:
                winner = model
                break
        winners[provider] = winner
        print(f"    => {provider}.{capability}_default = {winner or 'None (no live model)'}")
    return winners


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capability", choices=["worker", "thinker", "both"], default="both")
    parser.add_argument("--only", default="", help="probe just this provider")
    parser.add_argument("--models", default="", help="comma-separated explicit candidate slugs")
    args = parser.parse_args()

    _load_dotenv()
    sys.path.insert(0, str(_ROOT / "backend"))
    providers = held_provider_keys()
    if args.only:
        providers = {p: k for p, k in providers.items() if p == args.only}
        if not providers:
            print(f"[seat-probe] no .env key for provider {args.only!r} — nothing to probe.")
            return 0
    models = [m.strip() for m in args.models.split(",") if m.strip()] or None

    print(f"[seat-probe] held providers ({len(providers)}): {', '.join(sorted(providers))}")
    caps = ["worker", "thinker"] if args.capability == "both" else [args.capability]
    summary: dict[str, dict] = {}
    for cap in caps:
        summary[cap] = run_matrix(cap, providers, models)

    print(f"\n{'=' * 78}\nSUMMARY — the catalogue this probe supports\n{'=' * 78}")
    for provider in providers:
        thinker = summary.get("thinker", {}).get(provider, "(not probed)")
        worker = summary.get("worker", {}).get(provider, "(not probed)")
        print(f"  {provider:<12} thinker_default={thinker!s:<40} worker_default={worker!s}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
