# Backend test suite

Runs against an **isolated `claw_test` database** so it never touches dev/prod
data. The whole app binds to the test DB by pointing `DATABASE_URL` at it before
pytest imports the app; each test starts from a truncated schema.

## One-time setup (in the fastapi container)

```sh
pip install -r requirements-dev.txt
createdb -U garra claw_test                          # or: psql -U garra -c 'CREATE DATABASE claw_test'
DATABASE_URL=$(echo "$DATABASE_URL" | sed 's#/claw$#/claw_test#') alembic upgrade head
```

## Run

```sh
sh tests/run.sh            # all tests
sh tests/run.sh -q         # quiet
sh tests/run.sh tests/test_win_transitions.py -v
```

`run.sh` just swaps the DB name in `DATABASE_URL` to `claw_test` and invokes
pytest. After a schema change, re-run the `alembic upgrade head` step above
against `claw_test`.

## Coverage

- `test_win_transitions.py` — reserve_win (all 3 kinds + failures) and every
  settlement (open/resell/ship/keep) + auto-resell.
- `test_invariants.py` — claimability, one-LOADED-ball-per-prize (partial unique
  index), opening reuse after resell, re-win (win.ball_id not unique).
- `test_bind.py` — unified bind (all kinds + guards), bindable balls.
- `test_vocab.py` — holo-type/rarity CRUD + in-use delete guards.
- `test_payments.py` — confirm_payment enqueue, double-entry guard,
  machine.blocked() on unclaimable inventory.
