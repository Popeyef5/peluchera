"""The one-off asset mover: copy referenced files, then repoint rows. All or nothing."""
from sqlalchemy import select

from app import models as M
from app import move_assets, storage

from conftest import mk_closed

OLD = move_assets.OLD_PREFIX
NEW_BASE = "https://bucket.example/assets/"


class _Resp:
    def __init__(self, status, content=b"img", ctype="image/jpeg"):
        self.status_code, self.content, self.headers = status, content, {"content-type": ctype}


def _fake_http(monkeypatch, status_by_key):
    class _Client:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def get(self, url):
            return _Resp(status_by_key.get(url[len(OLD):], 200))
    monkeypatch.setattr(move_assets.httpx, "AsyncClient", _Client)


def _fake_bucket(monkeypatch):
    stored = {}
    monkeypatch.setattr(storage, "configured", lambda: True)
    monkeypatch.setattr(storage, "public_url", lambda key: NEW_BASE + key)
    monkeypatch.setattr(storage, "put_object", lambda key, body, ct: stored.setdefault(key, (body, ct)))
    return stored


async def _pack(db, front, back):
    cb = await mk_closed(db)
    cb.image_front_url, cb.image_back_url = OLD + front, OLD + back
    await db.commit()
    return cb.id


async def test_copies_every_referenced_file_then_repoints_rows(db, monkeypatch):
    pack_id = await _pack(db, "boosters/a.jpeg", "boosters/b.jpeg")
    stored = _fake_bucket(monkeypatch)
    _fake_http(monkeypatch, {})

    assert await move_assets.main(dry_run=False) == 0

    assert set(stored) == {"boosters/a.jpeg", "boosters/b.jpeg"}
    db.expire_all()
    cb = await db.scalar(select(M.ClosedBooster).where(M.ClosedBooster.id == pack_id))
    assert cb.image_front_url == NEW_BASE + "boosters/a.jpeg"
    assert cb.image_back_url == NEW_BASE + "boosters/b.jpeg"


async def test_one_failed_download_changes_no_rows(db, monkeypatch):
    pack_id = await _pack(db, "boosters/ok.jpeg", "boosters/gone.jpeg")
    _fake_bucket(monkeypatch)
    _fake_http(monkeypatch, {"boosters/gone.jpeg": 404})

    assert await move_assets.main(dry_run=False) == 1

    db.expire_all()
    cb = await db.scalar(select(M.ClosedBooster).where(M.ClosedBooster.id == pack_id))
    assert cb.image_front_url == OLD + "boosters/ok.jpeg"
    assert cb.image_back_url == OLD + "boosters/gone.jpeg"


async def test_dry_run_copies_and_changes_nothing(db, monkeypatch):
    pack_id = await _pack(db, "boosters/a.jpeg", "boosters/b.jpeg")
    stored = _fake_bucket(monkeypatch)
    _fake_http(monkeypatch, {})

    assert await move_assets.main(dry_run=True) == 0

    assert stored == {}
    db.expire_all()
    cb = await db.scalar(select(M.ClosedBooster).where(M.ClosedBooster.id == pack_id))
    assert cb.image_front_url == OLD + "boosters/a.jpeg"


async def test_second_run_is_a_no_op(db, monkeypatch):
    await _pack(db, "boosters/a.jpeg", "boosters/b.jpeg")
    stored = _fake_bucket(monkeypatch)
    _fake_http(monkeypatch, {})
    await move_assets.main(dry_run=False)
    stored.clear()

    assert await move_assets.main(dry_run=False) == 0
    assert stored == {}
