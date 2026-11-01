"""Security S1-C — owner-scoping sweep, the Models family. Account A owns a model with a test, a
finished run and a second one to compare; every route that takes A's id answers B 404 "model not
found", A's own identical call is not 404 (so B's 404 is the owner check), and A's rows are
unchanged after B's writes. B's own model doesn't open A's tests or runs either."""

import uuid

import pytest
from home_fixtures import fresh_account
from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.models import (
    ModelTestCase,
    ModelTestResult,
    ModelTestRun,
    ModelTestSetVersion,
    UserModel,
)

BODY = {"input": "i", "expected": "Motor"}


@pytest.fixture
def world(client):
    a, a_id = fresh_account("models-a")
    b, _ = fresh_account("models-b")
    model = a.post(
        "/api/models",
        json={"name": "A's", "job": "J", "answer_kind": "choice", "choices": ["Motor", "Home"]},
    ).json()
    mid = model["model_id"]
    test = a.post(f"/api/models/{mid}/tests", json=BODY).json()["test"]
    runs = []
    with session_scope() as s:
        row = s.get(UserModel, uuid.UUID(mid))
        version = s.execute(
            select(ModelTestSetVersion).where(ModelTestSetVersion.model_id == row.id)
        ).scalar_one()
        for slug in ("deepseek/deepseek-chat", "groq/openai/gpt-oss-120b"):
            run = ModelTestRun(
                model_id=row.id,
                version_id=version.id,
                version=1,
                model_slug=slug,
                status="completed",
                cases_total=1,
                price_known=True,
            )
            s.add(run)
            s.flush()
            s.add(
                ModelTestResult(
                    run_id=run.id,
                    case_id=uuid.UUID(test["case_id"]),
                    case_key=uuid.UUID(test["case_key"]),
                    position=1,
                    verdict="pass",
                    answer="Motor",
                )
            )
            runs.append(str(run.id))
    return a, a_id, b, mid, test, runs


def _routes(mid, key, r):
    return [
        ("get", f"/api/models/{mid}", None),
        ("patch", f"/api/models/{mid}", {"name": "B took it"}),
        ("get", f"/api/models/{mid}/tests", None),
        ("post", f"/api/models/{mid}/tests", BODY),
        ("post", f"/api/models/{mid}/tests/import", {"csv": "input,expected\nx,Motor\n"}),
        ("put", f"/api/models/{mid}/tests/{key}", BODY),
        ("get", f"/api/models/{mid}/tests/{key}/results", None),
        ("get", f"/api/models/{mid}/versions", None),
        ("post", f"/api/models/{mid}/versions/1/restore", None),
        ("post", f"/api/models/{mid}/estimate", {"models": ["deepseek/deepseek-chat"]}),
        ("post", f"/api/models/{mid}/runs", {"models": ["deepseek/deepseek-chat"]}),
        ("get", f"/api/models/{mid}/runs", None),
        ("get", f"/api/models/{mid}/runs/{r[0]}", None),
        ("post", f"/api/models/{mid}/runs/{r[0]}/stop", None),
        ("get", f"/api/models/{mid}/compare?a={r[0]}&b={r[1]}", None),
        ("delete", f"/api/models/{mid}/tests/{key}", None),
        ("delete", f"/api/models/{mid}", None),
    ]


def _snapshot(mid):
    with session_scope() as s:
        row = s.get(UserModel, uuid.UUID(mid))
        return (
            row.name,
            row.current_version,
            s.execute(
                select(func.count())
                .select_from(ModelTestCase)
                .where(ModelTestCase.model_id == row.id)
            ).scalar_one(),
            s.execute(
                select(func.count())
                .select_from(ModelTestRun)
                .where(ModelTestRun.model_id == row.id)
            ).scalar_one(),
        )


def test_b_gets_404_on_every_route_of_as_model(world):
    a, _, b, mid, test, runs = world
    before = _snapshot(mid)
    for method, url, body in _routes(mid, test["case_key"], runs):
        kwargs = {"json": body} if body is not None else {}
        resp = getattr(b, method)(url, **kwargs)
        assert resp.status_code == 404, (method, url, resp.status_code)
        assert resp.json()["detail"] == "model not found", url
        assert "Motor" not in resp.text
    assert _snapshot(mid) == before
    # A's own identical reads are not 404, so B's 404 is the owner check.
    for method, url, _body in _routes(mid, test["case_key"], runs):
        if method == "get":
            assert getattr(a, method)(url).status_code == 200, url
    assert a.delete(f"/api/models/{mid}/tests/{test['case_key']}").status_code == 200
    assert a.delete(f"/api/models/{mid}").status_code == 204


def test_b_cannot_reach_as_tests_or_runs_through_bs_own_model(world):
    _, _, b, _, test, runs = world
    own = b.post("/api/models", json={"name": "B's", "job": "J", "answer_kind": "text"}).json()
    mid = own["model_id"]
    key = test["case_key"]
    assert b.get(f"/api/models/{mid}/runs/{runs[0]}").status_code == 404
    assert b.post(f"/api/models/{mid}/runs/{runs[0]}/stop").status_code == 404
    assert b.get(f"/api/models/{mid}/compare?a={runs[0]}&b={runs[1]}").status_code == 404
    assert b.get(f"/api/models/{mid}/tests/{key}/results").status_code == 404
    assert b.put(f"/api/models/{mid}/tests/{key}", json=BODY).status_code == 404
    assert b.delete(f"/api/models/{mid}/tests/{key}").status_code == 404


def test_list_shows_b_none_of_as_models(world):
    a, _, b, mid, _, _ = world
    assert b.get("/api/models").json()["models"] == []
    assert [m["model_id"] for m in a.get("/api/models").json()["models"]] == [mid]


def test_names_are_per_account(world):
    _, _, b, _, _, _ = world
    resp = b.post("/api/models", json={"name": "a's", "job": "J", "answer_kind": "text"})
    assert resp.status_code == 201
