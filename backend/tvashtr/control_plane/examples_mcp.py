"""M2 — the examples server (``tvashtr-examples``): the tools an Example builder agent hands in,
lists and reviews drafts with. Built like the Domains server (``domain_mcp``): a request is honoured
only with an examples run token (``node_tools.read_examples_token``) — never a key or a login — and
only while its run is live and drafts for a model. The token's permission decides the tools:
``read`` (brief, list), ``write`` (+ add, update, remove), ``review`` (+ review). Every refusal is a
tool error with one plain sentence the agent can act on."""

from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import Context, FastMCP
from starlette.requests import Request

from tvashtr.control_plane import model_examples
from tvashtr.control_plane import model_examples_pure as pure
from tvashtr.control_plane.node_tools import read_examples_token

NO_TOKEN = "authentication required — no valid run token"
# A tool parameter can't be named ``kind``: an agent's SDK builds a pydantic Action from each tool's
# schema and its base already has a ``kind`` field. So a draft's kind is ``example_type`` here.
CANT_WRITE = "This agent can't hand in examples. Only the team's writer can."
CANT_REVIEW = "This agent can't review examples. Only the team's reviewer can."


class ExamplesToolError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def grant_from_ctx(ctx: Context) -> dict:
    """The token's grant (owner, run, node, permission, batch) from ``Authorization: Bearer``."""
    request: Request | None = None
    try:
        request = ctx.request_context.request  # type: ignore[attr-defined]
    except Exception:
        request = None
    if request is None:
        raise ExamplesToolError(NO_TOKEN)
    scheme, _, token = (request.headers.get("authorization") or "").partition(" ")
    grant = read_examples_token(token.strip()) if scheme.lower() == "bearer" else None
    if grant is None:
        raise ExamplesToolError(NO_TOKEN)
    return grant


def _need(grant: dict, permission: str) -> None:
    if grant["permission"] != permission:
        raise ExamplesToolError(CANT_WRITE if permission == "write" else CANT_REVIEW)


def _run(call) -> str:
    try:
        return json.dumps(call(), ensure_ascii=False)
    except pure.Refused as exc:
        raise ExamplesToolError(str(exc)) from exc


def create_examples_fastmcp() -> FastMCP:
    mcp = FastMCP("tvashtr-examples")

    @mcp.tool(name="examples_brief")
    def examples_brief(ctx: Context) -> str:
        """Start here. The job, the kind of answer (and its choices), how many tests and training
        examples were asked for and handed in so far, and the Domain's file names."""
        grant = grant_from_ctx(ctx)
        return _run(lambda: model_examples.agent_brief(grant["batch_id"]))

    @mcp.tool(name="examples_list")
    def examples_list(ctx: Context, example_type: str = "", review: str = "") -> str:
        """The drafts handed in so far, with their ids. ``example_type`` "test" or "training" and
        ``review`` "none", "ok" or "flagged" narrow the list."""
        grant = grant_from_ctx(ctx)
        return _run(
            lambda: model_examples.agent_list(
                grant["batch_id"], example_type or None, review or None
            )
        )

    @mcp.tool(name="examples_add")
    def examples_add(
        example_type: str,
        input: str,  # noqa: A002 — the product's word for it
        answer: str,
        source_file: str,
        quote: str,
        ctx: Context,
        must_contain: list[str] | None = None,
    ) -> str:
        """Hand in one draft. ``example_type`` "test" or "training". ``input``: a realistic case
        a real user would send (not a quote from the file). ``answer``: the right answer according
        to the file. ``source_file``: the Domain file's name. ``quote``: the file's own words,
        copied exactly (20 to 600 characters), that support the answer. ``must_contain``: for a
        model that writes text, 1 to 5 key phrases the answer contains. A refusal says what to
        fix."""
        grant = grant_from_ctx(ctx)
        _need(grant, "write")
        fields: dict[str, Any] = {
            "kind": example_type,
            "input": input,
            "answer": answer,
            "source_file": source_file,
            "quote": quote,
            "must_contain": must_contain,
        }
        return _run(lambda: model_examples.agent_add(grant["batch_id"], fields))

    @mcp.tool(name="examples_update")
    def examples_update(
        id: int,  # noqa: A002 — the draft's number, as examples_list shows it
        ctx: Context,
        example_type: str = "",
        input: str = "",  # noqa: A002
        answer: str = "",
        source_file: str = "",
        quote: str = "",
        must_contain: list[str] | None = None,
    ) -> str:
        """Correct a draft (by its id from examples_list). Give only what changes. It is checked
        again like a new draft and its review mark is cleared."""
        grant = grant_from_ctx(ctx)
        _need(grant, "write")
        fields: dict[str, Any] = {
            k: v
            for k, v in {
                "kind": example_type,
                "input": input,
                "answer": answer,
                "source_file": source_file,
                "quote": quote,
            }.items()
            if v
        }
        if must_contain is not None:
            fields["must_contain"] = must_contain
        return _run(lambda: model_examples.agent_update(grant["batch_id"], id, fields))

    @mcp.tool(name="examples_remove")
    def examples_remove(id: int, ctx: Context) -> str:  # noqa: A002
        """Remove a draft (by its id from examples_list), to make room for a better one."""
        grant = grant_from_ctx(ctx)
        _need(grant, "write")
        return _run(lambda: model_examples.agent_remove(grant["batch_id"], id))

    @mcp.tool(name="examples_review")
    def examples_review(id: int, verdict: str, note: str, ctx: Context) -> str:  # noqa: A002
        """Record your review of one draft (by its id from examples_list): ``verdict`` "ok" when
        the quote supports the answer and the input is a realistic case for the job, else
        "flagged"; ``note`` one sentence why."""
        grant = grant_from_ctx(ctx)
        _need(grant, "review")
        return _run(
            lambda: model_examples.agent_review(
                grant["batch_id"], id, verdict, note, grant["node_id"]
            )
        )

    return mcp
