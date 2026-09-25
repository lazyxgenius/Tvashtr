"""Public catalogue HTTP endpoints — no DB required (mirrors /api/config catalogue smoke)."""

from fastapi.testclient import TestClient

from tvashtr.main import app


def test_tool_catalog_serves_fetch_and_access_badges():
    c = TestClient(app)
    resp = c.get("/api/tool-catalog")
    assert resp.status_code == 200, resp.text
    tools = resp.json()["tools"]
    by_key = {t["key"]: t for t in tools}
    assert by_key["fetch"]["server_config"] == {
        "command": "uvx",
        "args": ["mcp-server-fetch"],
    }
    assert by_key["fetch"]["badge"] == "Free · no login"  # revamp Browse card copy
    assert by_key["github"]["badge"] == "Needs GITHUB_TOKEN"
    assert by_key["github-app"]["badge"] == "Needs GitHub App"
    assert by_key["github-app"]["attachable"] is False


def test_skill_presets_serve_caveman():
    c = TestClient(app)
    resp = c.get("/api/skill-presets")
    assert resp.status_code == 200, resp.text
    skills = resp.json()["skills"]
    keys = {s["key"] for s in skills}
    assert keys == {"caveman", "tdd", "yagni"}
    caveman = next(s for s in skills if s["key"] == "caveman")
    assert caveman["badge"] == "Free"
    assert "caveman" in caveman["source"]["content"].lower()
