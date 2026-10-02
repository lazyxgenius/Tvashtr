"""M7 — Agent tests (rulings R6 R7 R12; contract ``docs/superpowers/plans/api/agent-tests.md``).
Every route is owner-scoped: another account's team, agent, test or replay is a 404."""

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from tvashtr.auth import UserOut, get_current_user
from tvashtr.control_plane import agent_test_runner, agent_tests

router = APIRouter()
CurrentUser = Annotated[UserOut, Depends(get_current_user)]
BASE = "/api/teams/{team_id}/nodes/{node_id}/tests"
Use = Literal["gets", "must_say", "must_name_file", "skip"]


def _owner(user: UserOut) -> uuid.UUID:
    return uuid.UUID(user.id)


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except agent_tests.TestsError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc


class CheckIn(BaseModel):
    kind: Literal["must_say", "must_not_say", "must_name_file", "ai"]
    value: str = Field(max_length=2000)
    from_round: bool | None = None


class CreateTestRequest(BaseModel):
    invocation_id: int
    name: str = Field(max_length=1000)
    checks: list[CheckIn] = Field(max_length=50)


class FileRequest(BaseModel):
    filename: str = Field(default="", max_length=300)
    content: str = Field(max_length=3_000_000)
    mapping: dict[str, Use] | None = None


class LabelIn(BaseModel):
    answer: str = Field(max_length=20_000)
    you: bool


class JudgeRequest(BaseModel):
    check: int
    labels: list[LabelIn] = Field(max_length=50)


@router.get(BASE)
def list_tests(team_id: str, node_id: str, current_user: CurrentUser) -> dict:
    return _call(agent_tests.tests_view, _owner(current_user), team_id, node_id)


@router.get(BASE + "/from-round")
def test_from_round(
    team_id: str, node_id: str, current_user: CurrentUser, invocation_id: Annotated[int, Query()]
) -> dict:
    return _call(agent_tests.from_round, _owner(current_user), team_id, node_id, invocation_id)


@router.post(BASE, status_code=201)
def create_test(
    team_id: str, node_id: str, body: CreateTestRequest, current_user: CurrentUser
) -> dict:
    return _call(
        agent_tests.create_from_round,
        _owner(current_user),
        team_id,
        node_id,
        body.model_dump(exclude_none=True),
    )


@router.delete(BASE + "/{test_id}", status_code=204)
def delete_test(team_id: str, node_id: str, test_id: str, current_user: CurrentUser) -> Response:
    _call(agent_tests.delete_test, _owner(current_user), team_id, node_id, test_id)
    return Response(status_code=204)


@router.post(BASE + "/file/check")
def check_test_file(
    team_id: str, node_id: str, body: FileRequest, current_user: CurrentUser
) -> dict:
    return _call(
        agent_tests.check_file,
        _owner(current_user),
        team_id,
        node_id,
        body.filename,
        body.content,
        body.mapping,
    )


@router.post(BASE + "/file", status_code=201)
def import_test_file(
    team_id: str, node_id: str, body: FileRequest, current_user: CurrentUser
) -> dict:
    return _call(
        agent_tests.import_file,
        _owner(current_user),
        team_id,
        node_id,
        body.filename,
        body.content,
        body.mapping,
    )


@router.post(BASE + "/run", status_code=202)
def run_tests(team_id: str, node_id: str, current_user: CurrentUser) -> dict:
    return {"run": _call(agent_test_runner.start, _owner(current_user), team_id, node_id)}


@router.post(BASE + "/stop")
def stop_tests(team_id: str, node_id: str, current_user: CurrentUser) -> dict:
    return {"run": _call(agent_test_runner.stop, _owner(current_user), team_id, node_id)}


@router.get(BASE + "/results/{result_id}")
def test_result(team_id: str, node_id: str, result_id: str, current_user: CurrentUser) -> dict:
    return _call(agent_tests.result_detail, _owner(current_user), team_id, node_id, result_id)


@router.get(BASE + "/{test_id}/answers")
def test_answers(team_id: str, node_id: str, test_id: str, current_user: CurrentUser) -> dict:
    return _call(agent_tests.answers, _owner(current_user), team_id, node_id, test_id)


@router.post(BASE + "/{test_id}/judge")
def judge_test(
    team_id: str, node_id: str, test_id: str, body: JudgeRequest, current_user: CurrentUser
) -> dict:
    return _call(
        agent_tests.judge,
        _owner(current_user),
        team_id,
        node_id,
        test_id,
        body.model_dump(),
    )
