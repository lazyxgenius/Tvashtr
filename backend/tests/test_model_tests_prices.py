"""Models 1: the gateway's two additive helpers, against litellm's own price data."""

import pytest

from tvashtr.gateway.gateway import count_tokens, price_per_token

SLUGS = {
    "deepseek/deepseek-chat": (2.8e-07, 4.2e-07),
    "groq/openai/gpt-oss-120b": (1.5e-07, 6e-07),
    "vertex_ai/gemini-3-flash-preview": (5e-07, 3e-06),
    "openai/gpt-4o-mini": (1.5e-07, 6e-07),
}


@pytest.mark.parametrize(("slug", "want"), SLUGS.items())
def test_a_listed_model_answers_its_price(slug, want):
    assert price_per_token(slug) == pytest.approx(want)


@pytest.mark.parametrize(
    "slug", ["nvidia_nim/meta/llama-3.3-70b-instruct", "made-up/not-a-model", "vertex_ai/", ""]
)
def test_an_unlisted_model_answers_none(slug):
    assert price_per_token(slug) is None


def test_count_tokens_counts_with_the_models_tokenizer():
    messages = [{"role": "user", "content": "hello there"}]
    assert count_tokens("deepseek/deepseek-chat", messages) > 0
    assert count_tokens("vertex_ai/gemini-3-flash-preview", messages) > 0


def test_vertex_slugs_are_counted_as_the_gemini_id(monkeypatch):
    from tvashtr.gateway import gateway

    seen = []
    monkeypatch.setattr(
        gateway.litellm, "token_counter", lambda model, messages: seen.append(model) or 7
    )
    assert count_tokens("vertex_ai/gemini-3-flash-preview", []) == 7
    assert seen == ["gemini/gemini-3-flash-preview"]


def test_count_tokens_never_raises_and_falls_back_to_characters(monkeypatch):
    from tvashtr.gateway import gateway

    def broken(**_):
        raise RuntimeError("no tokenizer")

    monkeypatch.setattr(gateway.litellm, "token_counter", broken)
    messages = [{"role": "user", "content": "x" * 9}, {"role": "system", "content": "y" * 4}]
    assert count_tokens("anything/at-all", messages) == 4  # 13 characters / 4, rounded up
    assert count_tokens("vertex_ai/", messages) == 4
