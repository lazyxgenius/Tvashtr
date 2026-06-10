"""Happy-path: hello_durable completes and writes exactly 3 rows (shrunk sleep)."""

from dbos import DBOS
from sqlalchemy import select

from tvashtr.control_plane.hello_durable import (
    STEP_ONE,
    STEP_THREE,
    STEP_TWO,
    hello_durable,
)
from tvashtr.db import session_scope
from tvashtr.models import SpikeHelloEvent


def test_hello_durable_writes_three_rows(client):
    # client fixture ensures DBOS is launched; sleep is 0.1s for the test.
    handle = DBOS.start_workflow(hello_durable, "pytest", 0.1)
    result = handle.get_result()
    assert result == "hello_durable[pytest] complete"

    wf_id = handle.workflow_id

    with session_scope() as session:
        rows = (
            session.execute(
                select(SpikeHelloEvent)
                .where(SpikeHelloEvent.workflow_id == wf_id)
                .order_by(SpikeHelloEvent.id)
            )
            .scalars()
            .all()
        )

    assert [r.step_name for r in rows] == [STEP_ONE, STEP_TWO, STEP_THREE]
    assert len(rows) == 3
    # All three steps ran in this single (non-crashed) process.
    assert {r.pid for r in rows} == {rows[0].pid}

    status = DBOS.get_workflow_status(wf_id)
    assert status is not None
    assert status.status == "SUCCESS"
