# Database migrations (Alembic)

Schema source of truth is the SQLAlchemy models in `app/models.py`. **Alembic**
owns schema changes — the app no longer runs `create_all` at startup. Same
migration files run against every environment; only `DATABASE_URL` changes.

## Environments

| Env  | Database | `DATABASE_URL` |
|------|----------|----------------|
| dev  | local Docker Postgres (`claw_db`, pinned `postgres:17`) | `postgresql+psycopg://garra:…@claw_db:5432/claw` |
| prod | Supabase project **Claws** (`cjuryopztkipqqkivsge`, us-east-2) | see below |

Both are currently at revision `a8936058c0d8` (the baseline). Dev was `alembic
stamp head`'d (already had the schema); prod had the baseline applied.

### Prod `DATABASE_URL`

Get the password from Supabase → Project Settings → Database. Use the **direct
connection (port 5432)** for migrations (and to start, for the app too):

```
postgresql+psycopg://postgres:<PASSWORD>@db.cjuryopztkipqqkivsge.supabase.co:5432/postgres?sslmode=require
```

Notes:
- `sslmode=require` is mandatory on Supabase.
- The transaction **pooler** (port 6543) is for the app's many short
  connections, but breaks server-side prepared statements — if you switch the
  app to it, set psycopg3's `prepare_threshold=None`. Migrations should always
  use the direct 5432 connection.

## Daily workflow

```bash
# 1. change app/models.py
# 2. generate a migration (review the file it writes!)
docker exec claw_fastapi alembic revision --autogenerate -m "describe change"
docker cp claw_fastapi:/code/alembic/versions/<file>.py ./alembic/versions/

# 3. apply locally + test
docker exec claw_fastapi alembic upgrade head

# 4. commit the migration file to git
```

Deploy (`deploy.sh`) runs `alembic upgrade head` against the prod
`DATABASE_URL` before starting the app, so prod converges automatically.

Useful: `alembic current`, `alembic history`, `alembic downgrade -1`,
`alembic upgrade head --sql` (render SQL without connecting).

## Gotchas

- **Autogenerate + FK cycles.** The `ball / card / opened_booster / win` tables
  have mutually-dependent FKs. Autogenerate inlines those FKs into
  `create_table` and the migration then fails on a fresh DB. The baseline was
  rendered from `create_all` DDL instead (cyclic FKs come out as post-hoc
  `ALTER TABLE ADD CONSTRAINT`). If a future change adds another cross-table FK
  cycle, review the generated migration and move the offending FK(s) into
  `op.create_foreign_key()` after the tables.
- **New tables → enable RLS.** On Supabase the `public` schema is auto-exposed
  via the REST API to the public anon key. Every new table should
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (no policies needed — FastAPI
  connects with the owner/`postgres` role, which bypasses RLS). See the
  security note in the repo / `get_advisors`.
