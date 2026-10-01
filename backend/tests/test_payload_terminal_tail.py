"""M2: a long terminal result keeps its end — the test summary and exit code the run view reads.

``engines/openhands_adapter.py::_payload_of`` caps an observation at 2000 characters; a terminal
tool's longer result keeps its first and last 1000, joined by "\\n…\\n".
"""

from types import SimpleNamespace

from tvashtr.control_plane import activity
from tvashtr.engines.openhands_adapter import _payload_of


def _observed(tool: str, text: str) -> str:
    event = SimpleNamespace(tool_name=tool, observation=text)
    return _payload_of(event, "observation")["observation"]


def test_a_long_terminal_result_keeps_its_head_and_its_tail():
    output = "".join(f"tests/test_{i}.py ........\\n" for i in range(200)) + "41 passed in 3.2s"
    text = (
        f"content=[TextContent(cache_prompt=False, type='text', text='{output}')] is_error=False "
        "command='python -m pytest -q' exit_code=0 timeout=False kind='TerminalObservation'"
    )
    kept = _observed("terminal", text)
    assert kept == text[:1000] + "\n…\n" + text[-1000:]
    facts = activity._parse("observation", "terminal", kept)
    assert facts["summary"] == (41, 0) and facts["exit_code"] == 0
    assert facts["tail"][-1] == "41 passed in 3.2s"
    assert len(facts["tail"]) <= 12


def test_short_results_and_other_tools_are_unchanged():
    short = "x" * 2000
    assert _observed("terminal", short) == short
    assert _observed("Bash", "y" * 1999) == "y" * 1999
    assert _observed("file_editor", "z" * 5000) == "z" * 2000


def test_the_tail_never_starts_on_an_escaped_character():
    # Cutting between a backslash and the quote it escapes would end the text field early.
    text = "a" * 2999 + "\\'" + "b" * 999
    assert _observed("terminal", text) == "a" * 1000 + "\n…\n" + "b" * 999
