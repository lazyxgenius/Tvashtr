"""The Model Gateway package: provider-agnostic completion routing + the
metering boundary. Import ``complete`` and the Tvashtr-owned types from here;
never import ``litellm`` outside this package."""

from tvashtr.gateway.gateway import complete
from tvashtr.gateway.types import CompletionRequest, CompletionResult, GatewayError

__all__ = [
    "CompletionRequest",
    "CompletionResult",
    "GatewayError",
    "complete",
]
