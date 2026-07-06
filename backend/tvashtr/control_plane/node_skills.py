"""Per-node skills resolution (M-tools) — owned by the C7.B Skills milestone.

This is the SEAM the executor calls to turn a node's inline ``skills`` (the JSON array stored on
``AgentNode.skills``) into the runtime skill representation each capability needs:

* a WORKER node (engine-backed) gets a ``list`` of Skill objects passed to
  ``AgentContext(skills=…)`` in the adapters — :func:`build_skills`;
* a THINKER node (a direct-LLM completion — it never runs through OpenHands) gets its skill content
  folded into its prompt instead — :func:`inject_skills_into_prompt`.

Isolating both here keeps ``control_plane/team_run.py`` out of C7.B's way — that milestone fills in
ONLY this module.

INVARIANT 1 (openhands-free import): this module is imported by ``team_run.py``, which must stay
``openhands``-free at import. So NO module-level ``openhands`` import here, and C7.B MUST add
any ``openhands.*`` imports (e.g. ``Skill``) FUNCTION-LOCALLY inside the bodies below. The scaffold
stubs need no openhands import at all.
"""


def build_skills(skills: list | None, workspace_dir: str, run_id: str) -> list:
    """Resolve a worker node's inline skill sources into the list for ``AgentContext(skills=…)``.

    SCAFFOLD STUB (M-tools C7.0): returns ``[]`` — an empty skills list makes the adapter pass
    ``agent_context=None`` (NOT an empty ``AgentContext``, which would inject a datetime into the
    system message), so the node is byte-for-byte inert. C7.B builds Skill objects from the inline
    and resolves repo / repo-rules sources (``workspace_dir`` feeds project-adopt; ``run_id``
    gives owner), importing ``openhands`` FUNCTION-LOCALLY (never at module level — see INVARIANT
    1 above).
    """
    return []


def inject_skills_into_prompt(skills: list | None, base_prompt: str, run_id: str) -> str:
    """Fold a thinker node's skill content into its direct-LLM prompt (thinkers don't run through
    OpenHands, so they have no ``AgentContext``).

    SCAFFOLD STUB (M-tools C7.0): returns ``base_prompt`` unchanged — a node with no inline skills
    keeps its exact prompt, so the direct gateway call is byte-for-byte inert. C7.B prepends the
    resolved skill content (``run_id`` gives the owner for any secret-bearing source).
    """
    return base_prompt
