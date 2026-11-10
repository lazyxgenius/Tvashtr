"""M2 owner scope: account B gets 404 on account A's drafts, batches, training set and download,
and can't start a drafting run on A's model, or on its own model with A's Domain or A's team. A's
rows are unchanged."""

from m2_fixtures import (
    account,
    approve_all,
    builder_id,
    choice_model,
    domain,
    fake_team,
    start,
    wait_run,
    write_four,
)
from sqlalchemy import func, select

from tvashtr.db import session_scope
from tvashtr.models import ModelExampleBatch, ModelExampleDraft, ModelTrainingExample

ZERO = "00000000-0000-0000-0000-000000000000"


def _a_with_drafts(monkeypatch, tmp_path):
    a, a_owner = account("deepseek")
    mid = choice_model(a)
    did = domain(a_owner)
    team = builder_id(a, mid)
    fake_team(monkeypatch, tmp_path, writes=write_four, reviews=approve_all)
    resp = start(a, mid, did, team)
    assert resp.status_code == 202, resp.text
    wait_run(resp.json()["run_id"])
    example = a.post(f"/api/models/{mid}/training", json={"input": "kept", "answer": "Motor"})
    drafts = a.get(f"/api/models/{mid}/drafts").json()["batches"][0]["drafts"]
    return a, mid, did, team, example.json()["example"]["example_key"], drafts[0]["draft_id"]


def _counts():
    with session_scope() as s:
        return (
            s.execute(select(func.count()).select_from(ModelExampleBatch)).scalar_one(),
            s.execute(
                select(func.count())
                .select_from(ModelExampleDraft)
                .where(ModelExampleDraft.state == "open")
            ).scalar_one(),
            s.execute(select(func.count()).select_from(ModelTrainingExample)).scalar_one(),
        )


def test_b_gets_404_on_every_route_of_as_drafts_and_training(client, monkeypatch, tmp_path):
    a, mid, did, team, key, draft = _a_with_drafts(monkeypatch, tmp_path)
    b, _ = account("deepseek")
    before = _counts()
    calls = [
        ("get", f"/api/models/{mid}/training", None),
        ("post", f"/api/models/{mid}/training", {"input": "x", "answer": "Motor"}),
        (
            "post",
            f"/api/models/{mid}/training/import",
            {"filename": "x.csv", "csv": "input,answer\nx,Motor\n"},
        ),
        ("get", f"/api/models/{mid}/training/versions", None),
        ("post", f"/api/models/{mid}/training/versions/1/restore", None),
        ("get", f"/api/models/{mid}/training/download?format=jsonl", None),
        ("put", f"/api/models/{mid}/training/{key}", {"input": "y", "answer": "Motor"}),
        ("delete", f"/api/models/{mid}/training/{key}", None),
        ("get", f"/api/models/{mid}/drafts", None),
        ("post", f"/api/models/{mid}/drafts/accept", {"draft_ids": [draft]}),
        ("post", f"/api/models/{mid}/drafts/reject", {"draft_ids": [draft]}),
        ("put", f"/api/models/{mid}/drafts/{draft}", {"input": "z"}),
        ("post", f"/api/models/{mid}/drafts/{draft}/kind", {"kind": "training"}),
        ("get", f"/api/models/{mid}/drafting", None),
        (
            "post",
            f"/api/models/{mid}/drafting/estimate",
            {"team_id": team, "tests": 1, "training": 1},
        ),
        (
            "post",
            f"/api/models/{mid}/drafting",
            {"domain_id": did, "team_id": team, "tests": 1, "training": 1},
        ),
    ]
    for method, url, body in calls:
        resp = getattr(b, method)(url, **({"json": body} if body is not None else {}))
        assert resp.status_code == 404, (method, url, resp.status_code, resp.text)
        assert resp.json()["detail"] == "model not found", url
    # B's own model can't reach A's draft either.
    b_mid = choice_model(b)
    for method, url, body in [
        ("post", f"/api/models/{b_mid}/drafts/accept", {"draft_ids": [draft]}),
        ("post", f"/api/models/{b_mid}/drafts/reject", {"draft_ids": [draft]}),
        ("put", f"/api/models/{b_mid}/drafts/{draft}", {"input": "z"}),
        ("put", f"/api/models/{b_mid}/training/{key}", {"input": "y", "answer": "Motor"}),
    ]:
        resp = getattr(b, method)(url, json=body)
        assert resp.status_code == 404, (url, resp.text)
    assert b.get(f"/api/models/{b_mid}/drafts").json()["batches"] == []
    assert _counts() == before


def test_b_cannot_draft_with_as_domain_or_team(client, monkeypatch, tmp_path):
    a, mid, did, team, _, _ = _a_with_drafts(monkeypatch, tmp_path)
    b, b_owner = account("deepseek")
    b_mid = choice_model(b)
    b_did = domain(b_owner)
    b_team = builder_id(b, b_mid)
    assert [t["team_id"] for t in b.get(f"/api/models/{b_mid}/drafting").json()["teams"]] == [
        b_team
    ]
    before = _counts()
    with_as_domain = start(b, b_mid, did, b_team)
    assert (with_as_domain.status_code, with_as_domain.json()["detail"]) == (
        404,
        "domain not found",
    )
    with_as_team = start(b, b_mid, b_did, team)
    assert (with_as_team.status_code, with_as_team.json()["detail"]) == (404, "team not found")
    estimate = b.post(
        f"/api/models/{b_mid}/drafting/estimate", json={"team_id": team, "tests": 1, "training": 1}
    )
    assert estimate.status_code == 404
    assert start(b, b_mid, b_did, ZERO).status_code == 404
    assert _counts() == before
