# Database migrations (Alembic)

Schema source of truth is the SQLAlchemy models in `app/models.py`. **Alembic**
owns schema changes — the app no longer runs `create_all` at startup. Same
migration files run against every environment; only `DATABASE_URL` changes.

## Environments

| Env  | Database | `DATABASE_URL` |
|------|----------|----------------|
| dev  | local Docker Postgres (`claw_db`, pinned `postgres:17`) | `postgresql+psycopg://garra:…@claw_db:5432/claw` |
| prod | Neon project **cl4ws** (`fancy-bonus-70768673`), branch `production`, db `neondb`, aws-us-east-2, Postgres 18 | see below |

### Prod connection strings

Neon Console → Connect, branch `production`. Prod `.env.prod` carries two:

- `DATABASE_URL`: the **pooled** host (`…-pooler…`, transaction-mode
  PgBouncer), for the app. `db.py` sets psycopg3's `prepare_threshold=None`,
  since server-side prepared statements don't survive transaction pooling.
- `DATABASE_URL_DIRECT`: the direct host, for `alembic` (`alembic/env.py`
  prefers it) and `update.sh`'s pg_dump. DDL and dumps shouldn't go through a
  transaction pooler.

Both need `sslmode=require` and the `postgresql+psycopg://` scheme.

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
- **RLS migrations are Supabase-era.** On Supabase the `public` schema was
  auto-exposed via its REST API, so tables had RLS enabled (no policies;
  FastAPI connects as the owner, which bypasses RLS). Neon exposes nothing
  unless the Data API is turned on (it isn't), so new tables don't need it.
  The existing RLS migrations are harmless and stay.
