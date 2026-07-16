"""The host-side live-container registry (M-reaper) — pure unit tests, no Docker.

Exercises ``sandbox_cache``'s file-backed registry that lets the boot sweep spare a container owned
by a LIVE run in another process: register/deregister/spare round-trips, pid-liveness filtering,
dedup + dead-entry GC, and tolerance of a missing / corrupt / malformed registry file (never raise).
The registry path is isolated to a temp file by the conftest ``_isolate_live_container_registry``
autouse fixture; tests that inspect the file on disk read the live ``sandbox_cache._REGISTRY_PATH``
(never a fixture-captured copy) so they are immune to fixture-ordering."""

import json
import os
import subprocess
import sys

from tvashtr.engines import sandbox_cache


def _dead_pid() -> int:
    """A pid guaranteed dead: spawn a trivial process, reap it (``wait``), return its freed pid."""
    proc = subprocess.Popen([sys.executable, "-c", ""])
    proc.wait()
    return proc.pid


def _entries() -> list[dict]:
    return json.loads(sandbox_cache._REGISTRY_PATH.read_text())


def test_register_then_spared_roundtrip_live_pid():
    sandbox_cache.register_live_container("cid-live", run_id="run-1", pid=os.getpid())
    assert "cid-live" in sandbox_cache.spared_container_ids()


def test_dead_pid_entry_is_not_spared():
    sandbox_cache.register_live_container("cid-dead", pid=_dead_pid())
    assert "cid-dead" not in sandbox_cache.spared_container_ids()


def test_deregister_removes_entry():
    sandbox_cache.register_live_container("cid-x", pid=os.getpid())
    assert "cid-x" in sandbox_cache.spared_container_ids()
    sandbox_cache.deregister_live_container("cid-x")
    assert "cid-x" not in sandbox_cache.spared_container_ids()


def test_deregister_missing_id_is_noop():
    # Best-effort: de-registering an id that was never registered must not raise.
    sandbox_cache.deregister_live_container("never-registered")
    assert sandbox_cache.spared_container_ids() == frozenset()


def test_register_dedupes_same_container():
    sandbox_cache.register_live_container("cid-dup", pid=os.getpid())
    sandbox_cache.register_live_container("cid-dup", pid=os.getpid())
    assert [e["container_id"] for e in _entries()] == ["cid-dup"]


def test_register_gcs_dead_pid_entries():
    # A crashed prior owner leaves a dead-pid entry; the next register drops it (bounds the file).
    sandbox_cache.register_live_container("cid-old-dead", pid=_dead_pid())
    sandbox_cache.register_live_container("cid-new-live", pid=os.getpid())
    assert {e["container_id"] for e in _entries()} == {"cid-new-live"}


def test_registered_entry_shape():
    sandbox_cache.register_live_container("cid-shape", run_id="run-7", pid=os.getpid())
    (entry,) = _entries()
    assert entry["container_id"] == "cid-shape"
    assert entry["run_id"] == "run-7"
    assert entry["pid"] == os.getpid()
    assert isinstance(entry["started_at"], float)


def test_missing_registry_is_empty():
    assert sandbox_cache.spared_container_ids() == frozenset()


def test_corrupt_registry_treated_as_empty_and_recovers():
    sandbox_cache._REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    sandbox_cache._REGISTRY_PATH.write_text("{ this is not valid json ][")
    # Tolerant read -> empty, never raises...
    assert sandbox_cache.spared_container_ids() == frozenset()
    # ...and a subsequent register overwrites the corrupt file and works.
    sandbox_cache.register_live_container("cid-after-corrupt", pid=os.getpid())
    assert "cid-after-corrupt" in sandbox_cache.spared_container_ids()


def test_non_list_registry_treated_as_empty():
    sandbox_cache._REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    sandbox_cache._REGISTRY_PATH.write_text('{"container_id": "x"}')  # a dict, not a list
    assert sandbox_cache.spared_container_ids() == frozenset()


def test_out_of_range_pid_does_not_collapse_spare_set():
    # A corrupt registry with an OUT-OF-RANGE pid (os.kill raises OverflowError, which is
    # NOT an OSError) must be treated as dead — not raise and collapse the WHOLE spare set, which
    # would drop a co-resident LIVE entry and get its container reaped (violates "never reap a live
    # container"). Reproduce-first: pre-fix _pid_alive lets OverflowError escape.
    sandbox_cache._REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
    sandbox_cache._REGISTRY_PATH.write_text(
        json.dumps(
            [
                {"container_id": "cid-huge", "pid": 2**40, "run_id": None, "started_at": 0.0},
                {"container_id": "cid-live", "pid": os.getpid(), "run_id": None, "started_at": 0.0},
            ]
        )
    )
    spared = sandbox_cache.spared_container_ids()
    assert "cid-live" in spared, "the co-resident LIVE entry must survive an out-of-range-pid entry"
    assert "cid-huge" not in spared, "an out-of-range pid must be treated as dead (not spared)"


def test_empty_container_id_is_ignored():
    # Guards against a None/empty _container_id from the adapter ever polluting the registry.
    sandbox_cache.register_live_container("", pid=os.getpid())
    assert sandbox_cache.spared_container_ids() == frozenset()


def test_run_id_from_session_key():
    assert sandbox_cache.run_id_from_session_key("run-9::node-3") == "run-9"
    assert sandbox_cache.run_id_from_session_key(None) is None
    assert sandbox_cache.run_id_from_session_key("") is None


def test_close_run_sandboxes_deregisters_live_container():
    """The reuse-path teardown (``close_run_sandboxes``, the Control Plane's run-end ``finally``)
    drops the torn-down container from the live registry so the boot sweep no longer spares it."""
    key = sandbox_cache.session_key_for("run-Z", "node-1")
    cid = "closecid00001"
    sandbox_cache.register_live_container(cid, run_id="run-Z", pid=os.getpid())
    sandbox_cache.put(
        key, sandbox_cache.CachedSandbox(handle=object(), close=lambda: None, container_id=cid)
    )
    try:
        assert cid in sandbox_cache.spared_container_ids()
        sandbox_cache.close_run_sandboxes("run-Z")
        assert cid not in sandbox_cache.spared_container_ids()
    finally:
        sandbox_cache.clear()  # don't leak the in-memory cache into other tests
