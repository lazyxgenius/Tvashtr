"""B-TOOLKIT — "Add from GitHub": ``POST /api/skill-library/scan`` + ``/import``.

GitHub is NEVER called: ``github_app._http`` is faked (it raises on any URL it doesn't expect) and
installation tokens come from a fake ``get_installation_token``."""

import base64

import pytest
from toolkit_helpers import fresh_account

from tvashtr.control_plane import github_app, node_library
from tvashtr.control_plane.skill_repo import library_name, parse_github_repo
from tvashtr.db import session_scope
from tvashtr.models import GithubInstallation

SHA = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b"
API = "https://api.github.com"
INSTALL_TOKEN = "ghs_fake_installation_token"


def _md(name: str | None, desc: str | None) -> dict:
    front = "".join(f"{k}: {v}\n" for k, v in (("name", name), ("description", desc)) if v)
    text = f"---\n{front}---\nBody\n" if front else "Body\n"
    return {"content": base64.b64encode(text.encode()).decode(), "encoding": "base64"}


TREE = [
    {"path": "README.md", "type": "blob"},
    {"path": "skills", "type": "tree"},
    {"path": "skills/README.md", "type": "blob"},
    {"path": "skills/pytest-review/SKILL.md", "type": "blob"},
    {"path": "skills/house-style-py/SKILL.md", "type": "blob"},
    {"path": "skills/house-style-py/references/notes.md", "type": "blob"},
    {"path": "skills/api-conventions.md", "type": "blob"},
    {"path": "skills/commit/SKILL.md", "type": "blob"},
    {"path": "docs/other.md", "type": "blob"},
]
FILES = {
    "skills/pytest-review/SKILL.md": _md("pytest-review", "Review pytest suites."),
    "skills/house-style-py/SKILL.md": _md("house_style_py", None),
    "skills/api-conventions.md": _md(None, None),
    "skills/commit/SKILL.md": _md("commit-messages", "Write good commit messages."),
}


class FakeGithub:
    """Serves one repo. ``private=True`` → only the installation token can see it."""

    def __init__(self, *, private=False, tree=TREE, down=False):
        self.private, self.tree, self.down = private, tree, down
        self.calls: list[tuple[str, str | None]] = []

    def __call__(self, method, url, *, token=None, body=None, accept=None):
        self.calls.append((url, token))
        if self.down:
            raise github_app.GithubAppError(f"GitHub {method} {url} unreachable: timed out")
        path = url[len(API) :]

        def missing():
            return github_app.GithubAppError(f"GitHub {method} x -> HTTP 404")

        if not path.startswith("/repos/lazyxgenius/skills"):
            raise missing()
        if self.private and token != INSTALL_TOKEN:
            raise missing()
        rest = path[len("/repos/lazyxgenius/skills") :]
        if rest == "":
            return {"full_name": "lazyxgenius/skills", "default_branch": "trunk"}
        if rest.startswith("/commits/"):
            if rest.split("/commits/", 1)[1] in ("trunk", "main", "v1"):
                return {"sha": SHA}
            raise github_app.GithubAppError(f"GitHub {method} x -> HTTP 422")
        if rest == f"/git/trees/{SHA}?recursive=1":
            return {"sha": SHA, "tree": self.tree}
        if rest.startswith("/contents/"):
            file_path = rest[len("/contents/") :].split("?", 1)[0]
            if file_path in FILES:
                return FILES[file_path]
        raise AssertionError(f"unexpected GitHub URL: {url!r}")


@pytest.fixture
def fake(monkeypatch):
    def install(**kwargs) -> FakeGithub:
        gh = FakeGithub(**kwargs)
        monkeypatch.setattr(github_app, "_http", gh)
        monkeypatch.setattr(github_app, "get_installation_token", lambda iid: INSTALL_TOKEN)
        return gh

    return install


def test_parse_github_repo_accepts_common_forms():
    for url in (
        "https://github.com/lazyxgenius/skills",
        "https://github.com/lazyxgenius/skills.git",
        "http://www.github.com/lazyxgenius/skills/",
        "github.com/lazyxgenius/skills",
        "lazyxgenius/skills",
    ):
        assert parse_github_repo(url) == ("lazyxgenius", "skills"), url
    for bad in ("https://gitlab.com/a/b", "https://github.com/a", "not a url", None, ""):
        assert parse_github_repo(bad) is None, bad
    assert library_name("house_style_py") == "house-style-py"


def test_scan_lists_the_skills_the_sdk_would_load(fake):
    gh = fake()
    c, owner = fresh_account()
    node_library.create_owner_skill(owner, "pytest-review", {"type": "inline", "content": "x"})
    resp = c.post("/api/skill-library/scan", json={"url": "https://github.com/lazyxgenius/skils"})
    assert resp.status_code == 404  # the design's typo case
    resp = c.post("/api/skill-library/scan", json={"url": "https://github.com/lazyxgenius/skills"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["repo"] == "lazyxgenius/skills"
    assert body["url"] == "https://github.com/lazyxgenius/skills"
    assert body["ref"] == "trunk"  # the repo's default branch when no ref is given
    assert body["sha"] == SHA and body["short_sha"] == "1a2b3c4"
    assert body["skills"] == [
        {
            "name": "api-conventions",
            "path": "skills/api-conventions.md",
            "description": None,
            "in_library": False,
        },
        {
            "name": "commit-messages",
            "path": "skills/commit/SKILL.md",
            "description": "Write good commit messages.",
            "in_library": False,
        },
        {
            "name": "house_style_py",
            "path": "skills/house-style-py/SKILL.md",
            "description": None,
            "in_library": False,
        },
        {
            "name": "pytest-review",
            "path": "skills/pytest-review/SKILL.md",
            "description": "Review pytest suites.",
            "in_library": True,
        },
    ]
    assert all(token is None for _, token in gh.calls)  # public: no installation token needed


def test_scan_reads_a_private_repo_through_the_owners_app_installation(fake):
    gh = fake(private=True)
    c, owner = fresh_account()
    other_c, _ = fresh_account()
    with session_scope() as session:
        session.add(
            GithubInstallation(owner_id=owner, installation_id=900_000_000 + owner.int % 1000)
        )
    resp = c.post("/api/skill-library/scan", json={"url": "lazyxgenius/skills", "ref": "v1"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["ref"] == "v1"
    assert any(token == INSTALL_TOKEN for _, token in gh.calls)
    assert INSTALL_TOKEN not in resp.text
    # another account has no installation: the private repo is "not found" for them
    denied = other_c.post("/api/skill-library/scan", json={"url": "lazyxgenius/skills"})
    assert denied.status_code == 404
    assert denied.json()["detail"] == {
        "code": "repo_not_found",
        "message": "We couldn’t find that repo. Check the name, or install the GitHub App on it "
        "if it’s private.",
    }


def test_scan_errors(fake):
    c, _ = fresh_account()
    fake()
    bad_url = c.post("/api/skill-library/scan", json={"url": "https://gitlab.com/a/b"})
    assert bad_url.status_code == 422 and bad_url.json()["detail"]["code"] == "invalid_url"
    ref = c.post("/api/skill-library/scan", json={"url": "lazyxgenius/skills", "ref": "nope"})
    assert ref.status_code == 422
    assert ref.json()["detail"] == {
        "code": "ref_not_found",
        "message": "We couldn’t find nope in that repo.",
    }
    fake(tree=[{"path": "README.md", "type": "blob"}])
    empty = c.post("/api/skill-library/scan", json={"url": "lazyxgenius/skills"})
    assert empty.status_code == 422 and empty.json()["detail"]["code"] == "no_skills"
    fake(down=True)
    down = c.post("/api/skill-library/scan", json={"url": "lazyxgenius/skills"})
    assert down.status_code == 502 and down.json()["detail"]["code"] == "github_unreachable"


def _import(c, **overrides):
    body = {
        "url": "https://github.com/lazyxgenius/skills",
        "ref": "main",
        "sha": SHA,
        "skills": ["pytest-review", "house_style_py"],
    }
    body.update(overrides)
    return c.post("/api/skill-library/import", json=body)


def test_import_adds_one_pinned_row_per_skill():
    c, owner = fresh_account()
    resp = _import(c)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["skipped"] == []
    added = {s["name"]: s for s in body["added"]}
    assert set(added) == {"pytest-review", "house-style-py"}
    assert added["house-style-py"]["source"] == {
        "type": "repo",
        "url": "https://github.com/lazyxgenius/skills",
        "ref": "main",
        "mode": "agent",
        "resolved_sha": SHA,
        "filter": "house_style_py",
    }
    assert added["pytest-review"]["usage"] == {"agents": 0, "teams": 0}
    assert len(c.get("/api/skill-library").json()["skills"]) == 2


def test_import_conflicts_skip_replace_and_error():
    c, owner = fresh_account()
    sid = node_library.create_owner_skill(
        owner, "pytest-review", {"type": "inline", "content": "x"}
    )
    skipped = _import(c)
    assert skipped.json()["skipped"] == ["pytest-review"]
    assert [s["name"] for s in skipped.json()["added"]] == ["house-style-py"]
    err = _import(c, on_conflict="error")
    assert err.status_code == 409
    assert err.json()["detail"]["conflicts"] == ["pytest-review", "house-style-py"]
    replaced = _import(c, skills=["pytest-review"], on_conflict="replace").json()
    assert replaced["added"][0]["id"] == str(sid)
    assert replaced["added"][0]["source"]["type"] == "repo"


def test_import_validates_its_input():
    c, _ = fresh_account()
    assert _import(c, sha="abc").status_code == 422
    assert _import(c, skills=[]).json()["detail"] == "Pick at least one skill."
    assert _import(c, url="https://gitlab.com/a/b").status_code == 422
    assert _import(c, mode="trigger").json()["detail"] == "Add at least one trigger word."
    ok = _import(c, skills=["a*b"], mode="trigger", triggers="review")
    assert ok.status_code == 200, ok.text
    source = ok.json()["added"][0]["source"]
    assert source["filter"] == "a[*]b" and source["triggers"] == ["review"]
    assert _import(c, on_conflict="merge").status_code == 422
