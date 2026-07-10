"""M-robust regression: the frozen engine event sink must serialize a reasoning model's thought.

Mutation-real, driven through the REAL paths — the SDK's ``Message.from_llm_chat_message`` (which
produces the ``Sequence[TextContent]`` an ActionEvent carries as its ``thought``) and the FROZEN
``engines/openhands_adapter.py::_payload_of`` — plus the stdlib ``json.dumps`` the sink runs on the
``run_events``. Pre-fix, ``_payload_of`` left the raw ``TextContent`` list in the payload
and ``json.dumps`` raised ``TypeError: TextContent is not JSON serializable``. The fix
stringifies the thought inside ``_payload_of`` (joining the parts' ``.text``), so the payload
serializes for ANY provider in BOTH local and docker modes — both adapters share ``_payload_of``.
Reverting the stringify makes the ``*_serializ*`` tests FAIL (json.dumps raises), so this is not a
smoke assert.
"""

import json

import pytest
from litellm.types.utils import ChatCompletionMessageToolCall, Function, Message
from openhands.sdk.llm.message import Message as OHMessage
from openhands.sdk.llm.message import TextContent

from tvashtr.engines.openhands_adapter import _payload_of

_ARGS = '{"path": "greeting.txt", "text": "hi"}'


def _llm_tool_call_message(content) -> Message:
    """A litellm assistant message like a reasoning provider's tool-call turn: a ``write_file``
    tool call plus an assistant ``content`` set EXACTLY to ``content`` (bypassing coercion)."""
    msg = Message(
        role="assistant",
        tool_calls=[
            ChatCompletionMessageToolCall(
                id="call_1",
                type="function",
                function=Function(name="write_file", arguments=_ARGS),
            )
        ],
    )
    msg.content = content
    return msg


def _thought_from_llm_content(content):
    """Replay the SDK path: a litellm assistant message -> ``from_llm_chat_message`` -> the
    ``Sequence[TextContent]`` OpenHands hands an ActionEvent as its ``thought``. A reasoning model's
    ``content`` (even ``""``) becomes ``[TextContent(...)]``; ``None`` (plain model) -> ``[]``."""
    oh_msg = OHMessage.from_llm_chat_message(_llm_tool_call_message(content))
    return [c for c in oh_msg.content if isinstance(c, TextContent)]


class _FakeActionEvent:
    """Minimal stand-in carrying the attributes the frozen ``_payload_of('action')`` reads."""

    def __init__(self, thought) -> None:
        self.tool_name = "write_file"
        self.thought = thought
        self.action = "write_file(path='greeting.txt', text='hi')"


def test_raw_textcontent_thought_is_not_json_serializable():
    # Anchors the root cause the fix defends against: a raw TextContent in the payload crashes the
    # run_events json.dumps. This is exactly the shape the pre-fix _payload_of leaked.
    thought = _thought_from_llm_content("")
    assert thought and all(isinstance(part, TextContent) for part in thought)
    with pytest.raises(TypeError, match="TextContent is not JSON serializable"):
        json.dumps({"thought": thought})


def test_payload_of_serializes_empty_text_thought_and_keeps_the_action():
    # deepseek-chat's verified live shape: content='' -> [TextContent(text='')] thought.
    payload = _payload_of(_FakeActionEvent(_thought_from_llm_content("")), "action")
    out = json.dumps(payload)  # RAISES against the pre-fix _payload_of -> mutation-real
    assert payload["thought"] == ""
    assert payload["tool_name"] == "write_file"
    assert "write_file(path='greeting.txt'" in payload["action"]
    assert '"tool_name": "write_file"' in out


def test_payload_of_serializes_and_joins_a_nonempty_preamble_thought():
    # Robustness for ANY reasoning model: a preamble alongside the tool call leaks the same way;
    # it must serialize as the joined text, with the tool-call action intact.
    thought = _thought_from_llm_content("Let me create that file.")
    payload = _payload_of(_FakeActionEvent(thought), "action")
    assert json.dumps(payload)  # no raise
    assert payload["thought"] == "Let me create that file."
    assert payload["tool_name"] == "write_file"


def test_payload_of_preserves_a_plain_str_thought():
    # A plain-string thought (the pre-existing, plain-model shape) is kept verbatim.
    payload = _payload_of(_FakeActionEvent("just a plain string thought"), "action")
    assert payload["thought"] == "just a plain string thought"
    assert json.dumps(payload)


def test_payload_of_maps_empty_and_list_thoughts_to_empty_string():
    # None, "" and [] (a plain model's falsy thought) all normalize to "" and stay serializable.
    for empty in (None, "", []):
        payload = _payload_of(_FakeActionEvent(empty), "action")
        assert payload["thought"] == ""
        assert json.dumps(payload)


def test_payload_of_truncates_a_long_joined_thought_to_1000_chars():
    # The [:1000] truncation is preserved and applied to the joined string.
    payload = _payload_of(_FakeActionEvent([TextContent(text="x" * 5000)]), "action")
    assert payload["thought"] == "x" * 1000
    assert json.dumps(payload)
