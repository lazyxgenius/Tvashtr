"""The Model Gateway package: provider-agnostic completion routing + the
metering boundary. Import ``complete`` and the Tvashtr-owned types from here;
never import ``litellm`` outside this package."""

from tvashtr.gateway.gateway import complete, embed, multimodal_supported
from tvashtr.gateway.types import (
    CompletionRequest,
    CompletionResult,
    EmbeddingRequest,
    EmbeddingResult,
    GatewayError,
)

__all__ = [
    "CompletionRequest",
    "CompletionResult",
    "EmbeddingRequest",
    "EmbeddingResult",
    "GatewayError",
    "complete",
    "embed",
    "multimodal_supported",
]
