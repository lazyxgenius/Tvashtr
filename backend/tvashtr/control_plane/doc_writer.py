"""The ``generate_doc`` proof workflow: a real, metered LLM call persisted as a
versioned document — crash-safe and idempotent end to end.

* **Step 1 (llm_step)** builds a tiny prompt, routes it through the gateway, and
  records the cost.
* **Step 2 (persist_step)** writes the generated text as version 1 of a new
  document.

Both steps derive deterministic idempotency keys from the DBOS workflow id
(``{workflow_id}:llm`` and ``{workflow_id}:v1``). DBOS replays a *completed*
step from its checkpoint, but a crash *mid-step* re-runs it; the deterministic
keys make the cost write and the version write insert-or-return, so neither is
duplicated across a crash. ``persist_step`` additionally reuses an existing
version's document (looked up by key) so a retry never strands a second
document.
"""

from dbos import DBOS

from tvashtr.config import get_settings
from tvashtr.documents.service import add_version, create_document, get_version_by_key
from tvashtr.gateway import CompletionRequest, complete
from tvashtr.metering import record_cost


@DBOS.step()
def llm_step(topic: str, workflow_id: str) -> dict:
    """Make one metered gateway call; persist its cost idempotently."""
    request = CompletionRequest(
        model=get_settings().default_model,
        messages=[
            {"role": "user", "content": f"Write a 3-sentence mini-PRD for: {topic}"},
        ],
        temperature=0.7,
        max_tokens=300,
    )
    result = complete(request)
    record_cost(
        result,
        workflow_id=workflow_id,
        idempotency_key=f"{workflow_id}:llm",
    )
    return {
        "text": result.text,
        "model_used": result.model_used,
        "total_tokens": result.total_tokens,
    }


@DBOS.step()
def persist_step(topic: str, text: str, workflow_id: str) -> str:
    """Write ``text`` as version 1 of a new document; idempotent on re-run."""
    version_key = f"{workflow_id}:v1"
    existing = get_version_by_key(version_key)
    if existing is not None:
        # A prior (partial) run already persisted this version — reuse its
        # document rather than creating a second one.
        return str(existing.document_id)
    document = create_document(title=f"Mini-PRD: {topic}", doc_type="prd")
    add_version(
        document.id,
        content=text,
        created_by="agent:doc_writer",
        idempotency_key=version_key,
    )
    return str(document.id)


@DBOS.workflow()
def generate_doc(topic: str) -> dict:
    """Generate a mini-PRD for ``topic`` and store it as a versioned document."""
    wf_id = DBOS.workflow_id
    DBOS.logger.info(f"generate_doc start wf={wf_id} topic={topic!r}")

    step1 = llm_step(topic, wf_id)
    document_id = persist_step(topic, step1["text"], wf_id)

    DBOS.logger.info(f"generate_doc done wf={wf_id} document_id={document_id}")
    return {
        "document_id": document_id,
        "model_used": step1["model_used"],
        "total_tokens": step1["total_tokens"],
    }
