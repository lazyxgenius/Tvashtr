"""Phase 2 — document upload / list / delete (owner-scoped)."""

import uuid

from fastapi.testclient import TestClient

from tvashtr.main import app


def _fresh() -> TestClient:
    c = TestClient(app)
    c.cookies.clear()
    email = f"docs-{uuid.uuid4().hex}@tvashtr.local"
    assert (
        c.post(
            "/api/auth/register",
            json={"email": email, "password": "docs-password"},
        ).status_code
        == 200
    )
    return c


def _domain(c: TestClient) -> str:
    row = c.post("/api/domains", json={"template": "support", "name": "Docs"}).json()
    return row["domain_id"]


def test_upload_list_delete_txt():
    c = _fresh()
    did = _domain(c)
    files = {"file": ("notes.txt", b"hello world", "text/plain")}
    resp = c.post(f"/api/domains/{did}/documents", files=files)
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["filename"] == "notes.txt"
    assert doc["ingest_status"] == "pending"
    assert doc["byte_size"] == 11
    listed = c.get(f"/api/domains/{did}/documents").json()["documents"]
    assert len(listed) == 1
    domain = c.get(f"/api/domains/{did}").json()
    assert domain["doc_count"] == 1
    assert domain["status"] == "indexing"  # pending => indexing aggregate
    assert c.delete(f"/api/domains/{did}/documents/{doc['document_id']}").status_code == 200
    assert c.get(f"/api/domains/{did}/documents").json()["documents"] == []
    assert c.get(f"/api/domains/{did}").json()["doc_count"] == 0
    assert c.get(f"/api/domains/{did}").json()["status"] == "empty"


def test_reject_png_and_oversize():
    c = _fresh()
    did = _domain(c)
    assert (
        c.post(
            f"/api/domains/{did}/documents",
            files={"file": ("x.png", b"abc", "image/png")},
        ).status_code
        == 422
    )
    big = b"x" * (10 * 1024 * 1024 + 1)
    assert (
        c.post(
            f"/api/domains/{did}/documents",
            files={"file": ("big.txt", big, "text/plain")},
        ).status_code
        == 422
    )


def test_foreign_domain_documents_404():
    a = _fresh()
    b = _fresh()
    did = _domain(a)
    assert b.get(f"/api/domains/{did}/documents").status_code == 404
    assert (
        b.post(
            f"/api/domains/{did}/documents",
            files={"file": ("a.txt", b"a", "text/plain")},
        ).status_code
        == 404
    )


def test_upload_rejects_via_content_length_before_body():
    """I2: Content-Length above 10 MiB → 422 without relying on full body buffer alone."""
    import anyio
    from io import BytesIO

    from starlette.datastructures import Headers, UploadFile

    from tvashtr.control_plane.domain_files import MAX_UPLOAD_BYTES
    from tvashtr.routers import _read_domain_upload_capped

    class _CountingBytesIO(BytesIO):
        def __init__(self, data: bytes = b""):
            super().__init__(data)
            self.reads = 0

        def read(self, size: int = -1) -> bytes:
            self.reads += 1
            return super().read(size)

    stream = _CountingBytesIO(b"should-not-be-read")
    upload = UploadFile(
        file=stream,
        filename="huge.txt",
        headers=Headers({"content-length": str(MAX_UPLOAD_BYTES + 1)}),
    )

    async def _run():
        try:
            await _read_domain_upload_capped(upload)
            return None
        except ValueError as exc:
            return str(exc)

    err = anyio.run(_run)
    assert err == "file exceeds 10 MiB limit"
    assert stream.reads == 0


def test_upload_caps_stream_without_content_length():
    """I2: stream past MAX_UPLOAD_BYTES + 1 without Content-Length → ValueError."""
    import anyio
    from io import BytesIO

    from starlette.datastructures import Headers, UploadFile

    from tvashtr.control_plane.domain_files import MAX_UPLOAD_BYTES
    from tvashtr.routers import _read_domain_upload_capped

    payload = b"y" * (MAX_UPLOAD_BYTES + 1)
    upload = UploadFile(
        file=BytesIO(payload),
        filename="big.txt",
        headers=Headers({}),
    )

    async def _run():
        try:
            await _read_domain_upload_capped(upload)
            return None
        except ValueError as exc:
            return str(exc)

    err = anyio.run(_run)
    assert err == "file exceeds 10 MiB limit"
