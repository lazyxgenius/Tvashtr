"""M2 Part D: an error verdict on the Tests tab carries its reason (the "Error" chip's title)."""

from test_model_tests import _account, _add, _choice_model, _reply, _run

from tvashtr import gateway

SLUG = "deepseek/deepseek-chat"


def test_an_error_verdict_carries_its_reason_to_the_tests_tab(client, monkeypatch):
    def complete(request):
        if "broken" in request.messages[-1]["content"]:
            raise RuntimeError("the model returned no answer")
        return _reply(request, "Motor")

    monkeypatch.setattr(gateway, "complete", complete)
    c, _ = _account("deepseek")
    mid = _choice_model(c)
    _add(c, mid, input="a broken claim")
    _add(c, mid, input="a fine claim")
    (run,) = _run(c, mid, SLUG)
    assert (run["status"], run["errors"]) == ("completed", 1)
    broken, fine = c.get(f"/api/models/{mid}/tests").json()["tests"]
    assert broken["last_run"] == [{"verdict": "error", "reason": "the model returned no answer"}]
    assert fine["last_run"] == [{"verdict": "pass"}]
