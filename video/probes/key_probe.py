"""Key probe (prompts/video-v0.md G): for each provider the local operator holds a key for, one
tiny completion and, where the provider offers embeddings, one tiny embedding — through the app's
own gateway (gateway.complete / gateway.embed with the key resolve_owner_api_key decrypts). Prints
the provider, OK or FAIL and the error class only: never a key, never an error message.

Run from backend/ so the app's settings (.env) load:  cd backend && uv run python ../video/probes/key_probe.py
"""

from sqlalchemy import select

from tvashtr.control_plane.credentials import resolve_owner_api_key
from tvashtr.db import session_scope
from tvashtr.gateway import gateway
from tvashtr.gateway.types import CompletionRequest, EmbeddingRequest
from tvashtr.models import ProviderCredential, User

EMAIL = "operator@tvashtr.local"
# One cheap completion model per provider: the app's catalogue thinker default where it has one.
COMPLETION = {
    "deepseek": "deepseek/deepseek-chat",
    "groq": "groq/openai/gpt-oss-120b",
    "nvidia_nim": "nvidia_nim/meta/llama-3.3-70b-instruct",  # the catalogue has no NIM default
    "openai": "openai/gpt-4.1-mini",
    "gemini": "gemini/gemini-2.5-flash",
    "openrouter": "openrouter/openai/gpt-4.1-mini",
}
# Providers that offer embeddings: the app's reading models, and NIM's own (not in the app's list).
EMBEDDING = {
    "openai": "openai/text-embedding-3-small",
    "openrouter": "openrouter/openai/text-embedding-3-small",
    "gemini": "gemini/gemini-embedding-001",
    "huggingface": "huggingface/BAAI/bge-small-en-v1.5",
    "nvidia_nim": "nvidia_nim/baai/bge-m3",
}


def error_class(exc: Exception) -> str:
    inner = exc.__cause__
    return type(exc).__name__ + (f"({type(inner).__name__})" if inner is not None else "")


def attempt(call) -> str:
    try:
        call()
        return "OK"
    except Exception as exc:  # noqa: BLE001 — the class is the whole report
        return f"FAIL {error_class(exc)}"


def main() -> None:
    with session_scope() as session:
        owner = session.scalar(select(User.id).where(User.email == EMAIL))
        held = sorted(
            session.scalars(
                select(ProviderCredential.provider).where(ProviderCredential.owner_id == owner)
            )
        )
    rows = []
    for provider in held:
        model = COMPLETION.get(provider)
        completion = "n.a." if model is None else attempt(
            lambda m=model: gateway.complete(
                CompletionRequest(
                    model=m,
                    messages=[{"role": "user", "content": "Reply with the word OK."}],
                    max_tokens=16,
                    api_key=resolve_owner_api_key(owner, m),
                    retries=0,
                )
            )
        )
        emodel = EMBEDDING.get(provider)
        embeddings = "n.a." if emodel is None else attempt(
            lambda m=emodel: gateway.embed(
                EmbeddingRequest(model=m, input=["tvashtr"], api_key=resolve_owner_api_key(owner, m))
            )
        )
        rows.append(f"{provider}: completion {completion}, embeddings {embeddings}")
        print(rows[-1], flush=True)
    print("KEY_PROBE: " + " · ".join(rows))


if __name__ == "__main__":
    main()
