"""Google Cloud: run Gemini on Vertex AI with a Google Cloud API key, so its credits pay.

Slugs read ``vertex_ai/<id>``, but LiteLLM's own ``vertex_ai/`` route only logs in with a service
account or application default credentials. Its ``gemini/`` route sends ``x-goog-api-key`` and,
given an ``api_base``, calls ``{api_base}/models/{id}:{endpoint}``
(``vertex_llm_base._check_custom_proxy``), which with the base below is Vertex's own global address.
This is the one place that translation lives: the gateway applies it to each call and
``config.agent_llm_routing`` to each agent's ``LLM``.

Pure, and imports nothing from Tvashtr, LiteLLM or OpenHands, so both can import it without a cycle.
"""

PROVIDER = "vertex_ai"
VERTEX_BASE = "https://aiplatform.googleapis.com/v1/publishers/google"


def call_settings(slug: str, api_key: str | None) -> dict | None:
    """LiteLLM's ``model`` / ``api_base`` / ``api_key`` for a ``vertex_ai/<id>``, else ``None``.

    A missing key is refused rather than left to LiteLLM: its ``gemini/`` route would fall back to
    ``GEMINI_API_KEY``, sending an AI Studio key to Vertex."""
    provider, separator, model_id = slug.partition("/")
    if provider != PROVIDER or not separator:
        return None
    model_id = model_id.strip()
    if not model_id:
        raise ValueError(f"{slug!r} has no model id after {PROVIDER}/")
    if not api_key:
        raise ValueError(f"{slug!r} needs a Google Cloud API key; none was provided")
    return {"model": f"gemini/{model_id}", "api_base": VERTEX_BASE, "api_key": api_key}
