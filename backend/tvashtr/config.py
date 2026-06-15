"""Application settings, loaded from the environment / a gitignored .env file."""

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # When run from backend/ the repo-root .env is one level up; env vars
        # (exported by the Makefile) always take precedence over either file.
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # Postgres connection, shared by the app (SQLAlchemy/Alembic) and DBOS.
    database_url: str = "postgresql://tvashtr:tvashtr@localhost:5433/tvashtr"

    # DBOS configuration.
    dbos_app_name: str = "tvashtr"
    run_dbos_admin_server: bool = False

    # hello_durable spike: duration of the durable sleep between step 1 and 2.
    # Overridable via env (HELLO_SLEEP_SECONDS) so tests can shrink it.
    hello_sleep_seconds: float = 10.0

    # Model Gateway (architecture decision D9): a single, provider-agnostic
    # metering chokepoint over LiteLLM. Model identifiers are free-form
    # "provider/model" pass-through strings — no enum, the user's choice.
    # The default routes through OpenRouter (one key reaches Llama/Gemini/GPT/
    # etc.); on failure the gateway tries ``model_fallbacks`` in order so a
    # down/ratelimited model transparently fails over.
    default_model: str = "openrouter/meta-llama/llama-3.1-8b-instruct"
    model_fallbacks: list[str] = Field(
        default_factory=lambda: [
            "openrouter/google/gemini-flash-1.5",
            "gpt-4o-mini",
        ]
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
