"""One-off: copy uploaded assets from Supabase Storage to the new bucket and
repoint every stored URL at the copy.

    python -m app.move_assets --dry-run   # show what would move
    python -m app.move_assets             # copy, then rewrite rows

Runs against whatever DATABASE_URL and ASSETS_* the process has, so run it once
per database that holds URLs (dev and prod). Safe to repeat: rows already
pointing at the new bucket no longer match, and objects are overwritten with
identical bytes.

Only files some row actually references are copied; orphaned uploads are left
behind with the old project. If ANY download fails the script stops before
touching a single row, so a half-migrated database is impossible.
"""
import asyncio
import sys

import httpx
from sqlalchemy import text

from . import storage
from .db import async_session

OLD_PREFIX = "https://cjuryopztkipqqkivsge.supabase.co/storage/v1/object/public/assets/"

# Every column that stores an asset URL (information_schema: *url*, *image*, *video*).
COLUMNS = [
    ("card_type", "image_url"),
    ("closed_booster", "image_front_url"),
    ("closed_booster", "image_back_url"),
    ("opened_booster", "video_url"),
]


async def referenced_urls(db) -> list:
    urls = set()
    for table, col in COLUMNS:
        rows = await db.execute(
            text(f"SELECT DISTINCT {col} FROM {table} WHERE {col} LIKE :p"),
            {"p": OLD_PREFIX + "%"},
        )
        urls.update(r[0] for r in rows)
    return sorted(urls)


async def main(dry_run: bool) -> int:
    if not storage.configured():
        print("ASSETS_S3_* is not set; nothing to copy to.", file=sys.stderr)
        return 2

    async with async_session() as db:
        urls = await referenced_urls(db)
    if not urls:
        print("No stored URLs point at Supabase Storage. Nothing to do.")
        return 0

    new_base = storage.public_url("")
    print(f"{len(urls)} file(s) referenced; copying to {new_base}")
    if dry_run:
        for u in urls:
            print(f"  would copy {u[len(OLD_PREFIX):]}")
        return 0

    async with httpx.AsyncClient(timeout=120) as http:
        for u in urls:
            key = u[len(OLD_PREFIX):]
            r = await http.get(u)
            if r.status_code != 200:
                print(f"FAILED to download {key}: HTTP {r.status_code}. No rows were changed.", file=sys.stderr)
                return 1
            storage.put_object(key, r.content, r.headers.get("content-type"))
            print(f"  copied {key} ({len(r.content)} bytes)")

    async with async_session() as db:
        total = 0
        for table, col in COLUMNS:
            res = await db.execute(
                text(f"UPDATE {table} SET {col} = replace({col}, :old, :new) WHERE {col} LIKE :p"),
                {"old": OLD_PREFIX, "new": new_base, "p": OLD_PREFIX + "%"},
            )
            total += res.rowcount or 0
        await db.commit()
    print(f"Repointed {total} stored URL(s).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--dry-run" in sys.argv)))
