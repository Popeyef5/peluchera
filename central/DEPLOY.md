# Deploying

Recurring deploy, on the VPS:

```bash
cd ~/peluchera/central && ./update.sh
```

That pulls, rebuilds, backs up the DB, runs `alembic upgrade head`, and only then
restarts. **If the migration fails, nothing restarts** — the old version keeps
serving and the script prints the restore command. `deploy.sh` is first-time
provisioning only (docker, swap, TLS); you shouldn't need it again.

---

## Pre-deploy checklist

The first deploy after the payments rework needs new env vars, and prod no longer
runs its own database. Work through this once.

### 1. Database — prod is Supabase now

`docker-compose.yml` **no longer has a `db` service**. If `.env` still points at
`claw_db`, the app will not start.

- [ ] `DATABASE_URL` points at Supabase, using the **session pooler**:

      postgresql+psycopg://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require

  - **Session pooler (port 5432)**, not the transaction pooler (6543) — that one
    is PgBouncer, which breaks the prepared statements SQLAlchemy/psycopg use.
  - **Not** the direct host (`db.<REF>.supabase.co`) — it is **IPv6-only**, and an
    IPv4 VPS cannot reach it at all.
  - Password: Supabase dashboard → Project Settings → Database.

- [ ] Verify before deploying:

      psql "postgresql://postgres.<REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require" \
        -c "SELECT version_num FROM alembic_version;"

  It should already be at head, so the deploy's migration step is a no-op.

### 2. Mode — free play

- [ ] `FREE_PLAY=true`
- [ ] `BYPASS_PAYMENT=false` and `NEXT_PUBLIC_BYPASS_PAYMENT=false`

`FREE_PLAY` = everyone logs in **for real** (real account, real inventory, real
payout address) and plays **free**. Withdrawals are simulated. Both paid rails
refuse while it's on, and comped plays are recorded as `method=COMP,
amount_cents=0` so they can never be mistaken for revenue.

Do **not** use `BYPASS_PAYMENT` for this — it is *demo* mode: no wallet at all,
synthetic guest addresses, so nobody can log in as themselves.

### 3. Login

- [ ] `NEXT_PUBLIC_PROJECT_ID` = your Reown project id (there is a localhost-only
      fallback in the code — it will not work in prod).
- [ ] In the **Reown Cloud dashboard**: enable **Email** and **Google / Apple / X**,
      and set the project's domain to match the site. A domain mismatch silently
      kills the social login buttons.

### 4. Treasury (needed even in free play — the code reads it at startup)

- [ ] `TREASURY_ADDRESS` and `NEXT_PUBLIC_TREASURY_ADDRESS` are **byte-identical**.
      If they drift, every crypto payment silently fails verification.
- [ ] `TREASURY_PRIVATE_KEY` set (falls back to `CLAW_PRIVATE_KEY`).
- [ ] `TICKET_PRICE_CENTS` and `NEXT_PUBLIC_TICKET_PRICE_CENTS` agree.

While `FREE_PLAY=true` the treasury never actually pays out (withdrawals are
simulated), so it does **not** need to be funded yet. Before monetizing it needs
USDC (to pay winners) **and** ETH (for gas).

### 5. Stripe — skip for now

Not needed while `FREE_PLAY=true`; the card option hides itself without the keys.

### 6. Cabinet

- [ ] `PI_SERVER_URL` reachable from the backend container.
- [ ] Every **LOADED ball has a claimable prize**. The machine now *refuses to
      start a turn* otherwise (it would be taking money — or a free play — for a
      prize it can't hand over), and the queue stays paused until it's fixed.
      Check `/admin/cabinet/status` → `inventory_fault`, and watch for the
      Telegram alert.

---

## After deploying

```bash
docker compose logs -f fastapi     # look for: no inventory_fault, Pi connected
```

- [ ] Log in with Google/email → an address appears.
- [ ] Hit **PLAY** → straight into the queue, no payment picker.
- [ ] Play a turn → win → open/resell → the balance moves.
- [ ] `SELECT method, amount_cents, count(*) FROM payment GROUP BY 1,2;`
      → every row should be `COMP / 0`.

---

## Turning monetization on later

1. `FREE_PLAY=false`
2. Add the Stripe keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`) and register the webhook at
   `/payments/stripe/webhook`.
3. Fund the treasury: **USDC** (to pay winners) + **ETH** (gas).
4. `./update.sh`

The frontend needs no code change — it learns `free_play` from the server at
login, so the PLAY button re-routes itself between "straight to the queue" and
the payment picker.

---

## Known gotchas

- **`NEXT_PUBLIC_*` are baked in at build time.** `update.sh` always rebuilds, so
  a change does take effect — but it's why they can never be runtime-toggled from
  an admin panel.
- **A jammed chute or an unclaimable ball pauses the queue** until an operator
  clears it (`/admin/cabinet/clear_fault`, or void/rebind the balls). That's
  deliberate: the machine must never take money it can't honour.
- **Free plays still consume real inventory.** A won booster reserves a real
  `OpenedBooster` and commits you to shipping a real sealed pack.
- **The ESP firmware changed** (single `verdict` message). Flash it with
  `raspberry/flash.sh --ota` and drop-test — including a deliberate jam, to
  confirm `no_exit` comes back *with* the tag. Do it while the cabinet is idle:
  a reboot mid-turn faults it.
