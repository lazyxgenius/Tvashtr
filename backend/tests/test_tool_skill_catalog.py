"""Free tools & skills catalog — static TOOL_CATALOGUE + SKILL_PRESETS unit tests."""

from tvashtr.control_plane.tool_skill_catalog import (
    SKILL_PRESETS,
    TOOL_CATALOGUE,
    access_badge,
    public_skill_presets,
    public_tool_catalogue,
)


def test_fetch_is_the_free_attachable_stdio_tool():
    free_attachable = [
        e for e in public_tool_catalogue() if e["access"] == "free" and e["attachable"]
    ]
    assert len(free_attachable) == 1
    fetch = free_attachable[0]
    assert fetch["key"] == "fetch"
    assert fetch["name"] == "fetch"
    assert fetch["server_config"] == {"command": "uvx", "args": ["mcp-server-fetch"]}
    assert fetch["secret_names"] == []


def test_catalogue_includes_secret_and_github_app_shelf_copy():
    by_key = {e["key"]: e for e in public_tool_catalogue()}
    assert by_key["github"]["access"] == "needs_secret"
    assert by_key["github"]["secret_names"] == ["GITHUB_TOKEN"]
    assert by_key["github"]["attachable"] is True
    # Revamp (spec §4.2 Q8): the GitHub entry is the REMOTE GitHub MCP with a bearer secret ref.
    assert by_key["github"]["server_config"] == {
        "url": "https://api.githubcopilot.com/mcp/",
        "headers": {"Authorization": "Bearer ${GITHUB_TOKEN}"},
    }
    assert by_key["github"]["badge"] == "Needs GITHUB_TOKEN"
    assert by_key["github-app"]["access"] == "needs_github_app"
    assert by_key["github-app"]["attachable"] is False
    assert by_key["github-app"]["description"] == (
        "Hosted runs use your Tvashtr GitHub App installation. Install the App, then launch "
        "against an App repo."
    )


def test_catalogue_uses_the_browse_design_copy():
    fetch = next(e for e in public_tool_catalogue() if e["key"] == "fetch")
    assert fetch["badge"] == "Free · no login"
    assert fetch["description"] == (
        "Fetch web pages over HTTP. Runs locally with uvx mcp-server-fetch."
    )
    by_key = {p["key"]: p for p in public_skill_presets()}
    assert by_key["caveman"]["description"] == (
        "Ultra-compressed output style that keeps technical substance."
    )
    assert by_key["tdd"]["description"] == (
        "Red → green → refactor. Smallest code that makes the failing test pass."
    )
    assert by_key["yagni"]["description"] == (
        "Smallest change that solves the asked problem, no speculative extras."
    )
    assert all(p["badge"] == "Free" for p in by_key.values())


def test_access_badge_copy():
    assert access_badge("free", []) == "Free"
    assert access_badge("needs_secret", ["GITHUB_TOKEN"]) == "Needs ${GITHUB_TOKEN}"
    assert access_badge("needs_secret", []) == "Needs ${SECRET}"
    assert access_badge("needs_github_app", []) == "Needs GitHub App"


def test_skill_presets_include_caveman_and_two_short_inline():
    presets = public_skill_presets()
    keys = [p["key"] for p in presets]
    assert "caveman" in keys
    assert len(presets) == 3  # caveman + exactly 2 shorts
    for p in presets:
        assert p["access"] == "free"
        assert p["attachable"] is True
        assert p["source"]["type"] == "inline"
        assert p["source"]["mode"] == "always"
        assert isinstance(p["source"]["content"], str)
        assert len(p["source"]["content"]) > 20
    caveman = next(p for p in presets if p["key"] == "caveman")
    assert "caveman" in caveman["source"]["content"].lower()
    assert caveman["source"]["name"] == "caveman"


def test_catalogue_dicts_are_stable_module_consts():
    assert "fetch" in TOOL_CATALOGUE
    assert "caveman" in SKILL_PRESETS
