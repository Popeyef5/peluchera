# Garra — System Specification

> Living spec for the Garra crypto claw-machine platform. Written 2026-08-05.
> Source of truth for architecture, data model, flows, and invariants. When
> code and this doc disagree, fix whichever is wrong.

---

## 1. Product overview

Garra is a **real, physical claw machine** streamed live, where players pay to
take a turn and win **Pokémon-card prizes** (sealed booster packs and single
cards). It combines:

- **Physical hardware**: a claw cabinet with an RFID-tagged ball chute. Each
  physical ball carries an RFID tag ("serial") and is bound to a prize.
- **Live video**: WebRTC stream of the cabinet (MediaMTX).
- **Crypto + card payments**: pay-to-play via USDC transfer or Stripe card;
  winnings tracked in an **off-chain ledger**, withdrawable as USDC.
- **Commit-reveal trust model** (currently placeholder crypto): pre-filmed
  booster openings, committed on-chain, so a win's contents are provable.

Prizes:
- **Opened booster** — a *filmed* pack opening (video + the exact ordered cards).
  The winner can **open it live** (digital reveal, gets the cards), **ship it
  sealed**, or **sell it back**.
- **Closed booster** — a sealed pack, no filmed opening. Keep/ship or sell back.
- **Single card** — one specific card. Keep (to collection) or sell back.

---

## 2. Repository layout

```
central/                     # the whole app (docker-compose orchestrated)
  fastapi/                   # backend: FastAPI + Socket.IO + SQLAlchemy async
    app/
      models.py              # SQLAlchemy ORM (all tables/enums)
      db.py, deps.py         # async engine/session (pool_pre_ping, recycle=300)
      config.py              # env flags & constants
      state.py               # in-memory machine state + global_sync payload
      schedulers.py          # turn scheduler + sync scheduler loops
      machine.py             # machine.blocked() fitness gate
      win_transitions.py     # win/inventory state machine (THE core logic)
      payments.py            # initiate/confirm pay seam
      pi_client.py           # VPS<->Pi websocket client; verdict -> reserve_win
      versioning.py          # PI_VPS_PROTO constant
      pi_protocol.py         # (if present) protocol helpers
      listeners.py           # (legacy on-chain listeners, mostly retired)
      stripe_rail.py         # Stripe card rail
      helpers.py             # USDC verify/send, account data
      notifier.py            # Telegram alerts (alertBot)
      admin/
        router.py            # ALL /admin/* endpoints
        auth.py              # Supabase JWT verify + allowlist (current_admin)
      socket/
        __init__.py          # imports all event modules (registration)
        sio_instance.py      # the Socket.IO server instance
        events_core.py       # connect/global_sync on connect
        events_queue.py      # wallet_connected, pay_free, pay_crypto, withdraw
        events_payments.py   # card_setup, pay_card
        events_inventory.py  # win settlement events + get_inventory
        events_game.py       # move/game events
        events_dev.py        # DEV_TOOLS: dev_loaded_balls, dev_win_ball
      seed_dev.py            # dev seed (+ --reset)
    alembic/versions/        # migrations (Alembic owns the schema)
  next/                      # PLAYER app (Next.js). Wallet + play + win reveal.
  next-admin/                # ADMIN app (Next.js). Inventory/balls/cabinet/plays.
  proxy/                     # nginx (runtime DNS re-resolve; variable proxy_pass)
  docker-compose.yml         # PROD compose (--env-file .env.prod)
  docker-compose.dev.yml     # DEV compose (env_file .env; fastapi --reload)
  update.sh                  # prod deploy (migrations + rebuild + nginx reload)
mock/raspberry/              # MOCK Pi: simulates the cabinet at the HW boundary
  main.py                    # FastAPI: websocket server + /scenarios/* controls
  fsm.py, esp_link.py        # arm/verdict FSM + fake ESP serial link
  mock_hardware.py           # claw/opto sim; next_uid_override forces a ball
esp/                         # real ESP32 chute firmware (PlatformIO)
raspberry/                   # real Pi flasher/deploy tooling
```

### Services (dev compose)
- `fastapi` (:5000) — backend. Dev runs `uvicorn main:app --reload`.
- `next` (:3000, behind proxy) — player app.
- `next-admin` (:3001, behind proxy) — admin app.
- `proxy` (:80) — nginx.
- `db` (:5432) — Postgres (dev only; prod uses Supabase).
- `mock-pi` (:5001) — the mock cabinet controller.
- `mediamtx` — WebRTC video.

---

## 3. Infrastructure & deployment (prod)

- **VPS** `cl4ws.com` (`root@peluchera`, `~/peluchera/central`): runs the app
  (fastapi, next, next-admin, proxy) via `docker-compose.yml`.
- **DB**: Supabase project "Claws" `cjuryopztkipqqkivsge` (session pooler :5432,
  `aws-1-us-east-2`). Alembic owns schema (no `create_all`). Resilience:
  `pool_pre_ping=True`, `pool_recycle=300`, TCP keepalives; scheduler loops
  wrapped in try/except so a transient drop logs and retries, never dies.
- **Pi ↔ VPS over Tailscale**: hosts `claw-pi` (100.74.32.74), `claw-vps`
  (100.115.57.38). `PI_SERVER_URL=http://100.74.32.74:5000` — **use the
  Tailscale IP, not MagicDNS** (container DNS can't resolve MagicDNS). Transport
  is **bare websockets** (python `websockets`), not Socket.IO (Socket.IO flapped
  over ngrok; Tailscale fixed it). Tailscale `--ssh`, key-expiry disabled on
  server nodes, comes back on Pi restart.
- **nginx**: `resolver 127.0.0.11 valid=10s ipv6=off;` + variable
  `proxy_pass http://$var;` so container IPs re-resolve at runtime (fixes
  502-after-restart AND emerg-on-upstream-down). `update.sh` validates + reloads
  nginx after deploy.
- **Env files**: prod = **one** `.env.prod` (a second env_file silently shadows
  it — cost hours twice). Player app `NEXT_PUBLIC_*` are baked from
  `next/.env.production` (gitignored, per-machine) at build; admin app
  `NEXT_PUBLIC_SUPABASE_*` come from compose build ARGS interpolated from
  `--env-file .env.prod`.
- **Deploy**: `./update.sh` on the VPS — runs migrations, rebuilds the Next apps
  (NEXT_PUBLIC_* baked at build), reloads nginx.

### Protocol chain (VPS · Pi · ESP)
Three numbered protocols that must all match:
- `PI_VPS_PROTO` (in `versioning.py`) — VPS↔Pi.
- `ESP_PI_PROTO` — Pi↔ESP (mock: `protocol_version.py`).
- A mismatch sets `state.version_fault` → `machine.blocked()` → queue pauses.
- `/health` and `/admin/cabinet/status` surface the chain (pi_proto, esp_proto,
  esp_fw, pi_fw, *_ok). ESP reports fw + proto via `esp_status`.

---

## 4. Data model

Alembic owns the schema. Two "kinds" of entity: **catalog** (fungible, "what a
thing is") and **instance** (unique, has a lifecycle).

### Enums
- `PrizeKind`: `OPENED_BOOSTER`, `CLOSED_BOOSTER`, `SINGLE_CARD`
  (renamed from `BOOSTER_PAIR` → `OPENED_BOOSTER`, migration b2d4f6a8c0e1).
- `BallStatus`: `LOADED`, `GRABBED`, `VOIDED`.
- `InventoryStatus` (OpenedBooster): `AVAILABLE`, `RESERVED`, `CONSUMED`,
  `SHIPPED`, `RETIRED`.
- `CardStatus`: `IN_POOL`, `RESERVED`, `IN_COLLECTION`, `SHIPPED`, `RESOLD`.
- `CardOrigin`: `OPENED_BOOSTER`, `SINGLE_PRIZE`.
- `WinStatus`: `PENDING`, `SETTLED_OPEN`, `SETTLED_RESELL`, `SETTLED_KEEP`,
  `SETTLED_SHIP`, `EXPIRED`.
- `SettlementKind`: `USER_OPEN`, `USER_RESELL`, `USER_KEEP`, `USER_SHIP`,
  `AUTO_RESELL`.
- `LedgerKind`: `RESELL`, `AUTO_RESELL`, `CARD_RESELL`, `WITHDRAWAL`, ... (money
  movements; winnings accrue only from resells, never deposits).
- `PaymentMethod`: `CRYPTO`, `CARD`, `COMP`.
- `PaymentStatus`: `PENDING`, `CONFIRMED`, `FAILED`.

### Catalog tables (fungible)
- **ClosedBooster** (`closed_booster`) — a sealed-pack SKU. Fields: `sku`
  (unique), `name`, `image_front_url`, `image_back_url`, `card_count`,
  `in_stock` (bool; no quantity — operator flips it). `is_complete` = name +
  both images + card_count. A ball may only bind to a complete one.
- **CardType** (`card_type`) — a card SKU. Fields: `sku`, `name`, `image_url`,
  `type` (a **HoloType.name** — holo/foil category), `rarity` (a **Rarity.name**),
  `set`, `number`. `is_complete` = sku+name+image+type+rarity.
- **HoloType** (`holo_type`) — editable vocabulary of holo/foil categories
  (holo, reverse-holo, cosmos-holo, galaxy-holo, radiant-holo, amazing,
  trainer-gallery, rainbow, secret). Admin-managed.
- **Rarity** (`rarity`) — editable vocabulary of rarities + `resell_price_cents`
  (the buyback price for a won card of that rarity). Admin-managed; price read
  at settlement (moved out of config).

### Instance tables (unique, lifecycle)
- **OpenedBooster** (`opened_booster`) — ONE filmed opening: `closed_booster_id`,
  `sku` (denorm), `video_url`, `video_hash` (unique), `filmed_at`, `status`
  (InventoryStatus), `reserved_by_win_id`. Has ordered `cards`. `is_complete` =
  complete ClosedBooster + video + exactly `card_count` cards.
- **Card** (`card`) — a specific card instance: `card_type_id`, `origin`,
  `opened_booster_id` (+`position` for reveal order), `status`, `owner_user_id`,
  `acquired_at`, `shipment_id`, `condition`.
- **Ball** (`ball`) — a physical RFID tag: `serial` (unique), `prize_kind`,
  and exactly one of `opened_booster_id` / `closed_booster_id` / `prize_card_id`,
  `secret`, `commitment_hash` (unique), `merkle_proof`, `batch_id`, `status`
  (BallStatus), `voided_at`.
  - **INVARIANT**: at most ONE `LOADED` ball may hold a given opening/card at a
    time — enforced by **partial unique indexes** (`uq_ball_opened_booster_loaded`,
    `uq_ball_prize_card_loaded`, `WHERE status='LOADED'`), NOT plain-unique.
    Settled/voided balls keep their reference for audit but don't block reuse.
    `closed_booster_id` is NOT unique (sealed packs are fungible-by-SKU).
- **Win** (`win`) — a prize won on a turn: `user_id`, `queue_entry_id` (unique —
  one win per turn), `ball_id` (**NOT unique** — a reusable tag accrues many
  wins over its life; migration d5f7b9c1e3a6), `prize_kind`, `status`,
  `expires_at` (30d), `resell_price_cents` (snapshotted), `prize_card_id`,
  `settled_at`, `settled_by`. `Ball.wins` is a collection.
- **QueueEntry** (`queue`) — a paid turn ticket: `address`, `round_id`, `key`,
  `status` (`queued`/`active`/`played`), `created_at`, `played_at`, `ended_at`,
  `win` (bool). Legacy on-chain "Bet".
- **Round** (`round`) — a game round (`max_fee`, `fee_growth`, `created_at`).
- **Payment** (`payment`) — a pay-to-play charge: `address`, `method`,
  `amount_cents`, `status`, `ref` (tx hash / PI id, unique), `queue_entry_id`,
  `user_id`, `confirmed_at`.
- **User** (`user_account`) — `wallet_address`, `stripe_customer_id`. Bridge for
  Win/Card/Shipment/LedgerEntry (which FK to User).
- **LedgerEntry** (`ledger_entry`) — off-chain balance movements (winnings +
  withdrawals). Winnings accrue only from resells.
- **Withdrawal** (`withdrawal`) — off-chain→USDC treasury transfer, with a
  chargeback-protection hold on card-funded winnings.
- **Shipment** (`shipment`) — physical fulfilment (`user_id`, `sku`,
  `shipping_address`, `status`), holds shipped cards.
- **CommitmentBatch** (`commitment_batch`) — merkle root + chain tx (placeholder).

---

## 5. Prize kinds & win lifecycle

### Grab → reserve (win_transitions.reserve_win)
Called when the mock/real chute reports a winning verdict for `ball_serial`.
1. Lock the ball; must be `LOADED` (else `BallNotAvailable`).
2. Mark ball `GRABBED` and **commit immediately** (the ball physically fell —
   that's a fact independent of prize bookkeeping; committing first prevents a
   ghost re-award and strengthens the double-grab guard).
3. Reserve the prize:
   - `OPENED_BOOSTER`: reserve the opening (AVAILABLE→RESERVED, single-row
     update; `PoolExhausted` if not available), confirm a same-SKU pack is
     in stock, snapshot booster resell price.
   - `CLOSED_BOOSTER`: confirm the bound ClosedBooster exists + in_stock
     (fungible, nothing to reserve), snapshot booster resell price.
   - `SINGLE_CARD`: reserve the bound Card (IN_POOL→..., `PoolExhausted` if gone),
     snapshot rarity resell price.
4. Create the `Win` (PENDING, 30d expiry). Emit `player_win` (roomed to winner).
   If reserve fails → no win → `pi_client` emits `turn_result{prize_unavailable}`
   (never a fake win).

### Settle (player choice, up to 30d, else auto-resell)
- **OPENED_BOOSTER**:
  - `open_booster_win` — cards → collection, opening → **CONSUMED** (the only
    consuming path). `SETTLED_OPEN`.
  - `resell_booster_win` — credit resell, opening → **AVAILABLE** (reusable).
    `SETTLED_RESELL`.
  - `ship_booster_win(address)` — ship a same-SKU sealed pack, opening →
    **AVAILABLE** (reusable), create Shipment. `SETTLED_SHIP`.
- **CLOSED_BOOSTER**:
  - `keep_closed_booster_win` — `SETTLED_KEEP` (owed for shipment; fungible, no
    per-unit inventory).
  - `resell_closed_booster_win` — credit resell, `SETTLED_RESELL`.
- **SINGLE_CARD**:
  - `keep_card_win` — Card → IN_COLLECTION, owned. `SETTLED_KEEP`.
  - `resell_card_win` — credit resell, `SETTLED_RESELL`.
  - `ship_card_win(address)` — Shipment. `SETTLED_SHIP`.
- **Auto-resell** (`run_auto_resell_expired`): PENDING wins past expiry settle as
  `AUTO_RESELL` (→ `EXPIRED`), routed per prize kind. Each win its own tx.

### Key insight (the OpenedBooster is precious)
Analogy: **CardType↔ClosedBooster** (fungible catalog), **Card↔OpenedBooster**
(precious instance). A filmed opening is only *consumed* on live-open; buyback
and ship-sealed return it to the pool to be rebound (fungible same-SKU pack
ships). Players don't win bare CardTypes.

---

## 6. Machine fitness (`machine.blocked()`)

The single gate: **never take money for a play the machine can't honour.**
Returns the first of:
- `version_fault` (VPS/Pi/ESP protocol mismatch),
- `cabinet_fault` (chute jam / ESP error, latched),
- `refresh_inventory_fault()` → `unclaimable_loaded_balls()`:
  a LOADED ball is unclaimable when its prize is missing/incomplete/out-of-stock
  (per prize kind). Any such ball pauses the queue.

Enforced at BOTH:
- **turn-start** (scheduler `_turn_scheduler_loop` first line), and
- **pay-time** (pay_free/pay_crypto/pay_card refuse before charging/enqueuing).

`/admin/cabinet/status` also derives `can_play` + `blocked_reasons` fresh
(protocol/chute/unclaimable/**no balls loaded**/Pi offline) + `unclaimable_balls`.

---

## 7. Queue & turn scheduler

- **Enqueue**: `pay_free` (COMP), `pay_crypto` (USDC direct transfer, verified;
  BYPASS mode mints a synthetic key), `pay_card` (Stripe saved card). All
  converge on `payments.confirm_payment` → creates a `QueueEntry` + broadcasts
  `player_queued`. Guards: not-in-queue-already, `machine.blocked()`.
- **Turn scheduler** (`schedulers._turn_scheduler_loop`, ~1s tick):
  - Rest if `machine.blocked()` OR within `TURN_DURATION + INTER_TURN_DELAY` of
    `last_start` OR `changing_round`.
  - Else: close the old active entry (`played`), claim the next `queued` entry
    (oldest), emit `turn_end`/`turn_start`, `safe_pi_emit('turn_start')`, set
    `current_player`. If none queued → idle. **The DB session is never held
    across the inter-turn sleep or socket emits** (Supabase pooler kills idle
    checked-out connections).
- **Turn end**: the Pi/mock reports a single verdict `{outcome, ball_serial}`.
  `outcome=ok` → win path (`reserve_win`). `no_fall` → clean loss. `no_read` →
  rfid fail. `no_exit` → chute jam (cabinet_fault, ball_serial carried).
  `internal_error`/timeout after VERDICT_GRACE (20s).
- **global_sync** (periodic + on connect): `{state, round_info, queue_length,
  con (pi_connected), seconds_left, blocked (bool)}`. Player app disables PLAY
  when `blocked`.

---

## 8. Payments & winnings

- **Modes**: `BYPASS_PAYMENT` (demo — no wallet, synthetic guest address,
  straight to PLAY), `FREE_PLAY` (real login, comped play), else real pay
  (crypto/card). `free_play() = FREE_PLAY or BYPASS_PAYMENT`.
- **Crypto rail**: frontend transfers USDC to treasury, sends tx hash;
  `pay_crypto` verifies the on-chain receipt (replay-guarded by unique
  `payment.ref`). No escrow contract (retired).
- **Card rail**: Stripe Customer + SetupIntent (save card once) + off-session
  PaymentIntent per play; webhook safety net (`stripe_rail.py`).
- **Winnings**: off-chain **ledger** (accrues only from resells). Withdraw =
  ledger → treasury USDC transfer, with a **chargeback-protection hold** on
  card-funded winnings (CHARGEBACK_HOLD_DAYS).

---

## 9. Admin panel (`/admin/*`, Supabase-JWT auth + allowlist)

Auth: Supabase JWT (JWKS/HS256) verified in `admin/auth.py`; allowlist
`ADMIN_EMAIL_ALLOWLIST` / `ADMIN_EMAIL_DOMAINS` via `admin_email_allowed()`.

Pages/endpoints:
- **Balls** (`/admin/balls`): list (serial, status, prize_kind, bound SKU for
  all 3 kinds). **Unified bind** (`POST /admin/balls/bind` {serial, kind,
  opened_booster_id|closed_booster_sku|card_type_sku}) — create-or-rebind, one
  LOADED ball per prize; `GET /admin/balls/bindable` (non-LOADED balls);
  enroll/scan (`/balls/enroll/start` + `/status`); void.
- **Inventory** tabs:
  - Opened boosters (`?bindable=true` filter; shows derived
    `effective_status` free/bound/reserved/consumed + `bound_ball`).
  - Closed boosters (CRUD, in_stock toggle, front/back images, card_count).
  - Card types (CRUD; type/rarity are dropdowns from the vocabularies).
  - **Types** (holo types + rarities CRUD; rarity carries resell price; delete
    guarded if in use).
- **Cabinet** (`ops` route): live status + `can_play` banner + protocol chain +
  test-arm, clear_fault, ESP health, force_turn_end.
- **Plays**: turn/win history.
- Uploads: Supabase Storage `assets` bucket (public, admin-allowlist RLS) via
  `next-admin/lib/upload.ts`.

---

## 10. Player app (`next`) & win reveal

- **Wallet abstraction**: `WalletContext` + `useWallet()` filled by per-provider
  bridges (Reown / Privy); runtime selector via `WALLET_PROVIDER` env read
  server-side in `app/layout.tsx`, passed as prop. Both providers' public keys
  baked (`NEXT_PUBLIC_PROJECT_ID` Reown, `NEXT_PUBLIC_PRIVY_APP_ID`).
- **PLAY**: `ClawProvider` (`useClaw()`) drives socket state. PLAY →
  pay_free/pay_crypto/openPaymentPicker (or login). Disabled when
  `machineBlocked`.
- **Win reveal** (`WinChoiceModal`): opens on **`pendingWin`** (a real
  `player_win`), once per unique `win_id` (NOT on the roundWon stat).
  - 3D booster mesh (`Booster.tsx`, drei useGLTF `/booster.glb`) skinned with the
    won ClosedBooster's `booster_front_url`/`booster_back_url` from the payload.
  - Card reveal (`CardStack` + `HoloCard`): renders the won cards
    (`pendingWin.cards`, ordered) via `winCardsToDeck`; foil from
    `foilForHoloType(card.type)` (falls back to MOCK_DECK if no cards).
  - Actions: OPENED_BOOSTER → Open now / Resell / Add to inventory;
    CLOSED_BOOSTER → Resell / Add to inventory; SINGLE_CARD → Add to collection /
    Resell / Add to inventory.
- Win assets preloaded on idle (`preloadWinAssets`): card back + foils + GLB.

---

## 11. Dev tools

- **`/test-win`** (dev only, `DEV_TOOLS`/`NEXT_PUBLIC_DEV_TOOLS`): the player
  home wrapped in `TestWinProvider`; PLAY opens a **ball picker** (loaded balls
  via `dev_loaded_balls`), and confirming calls `dev_win_ball({serial})`:
  forces the **mock chute** to drop that ball (`/scenarios/next-tag/<serial>` +
  `always-win`), enqueues via the production `confirm_payment` seam, and a REAL
  turn runs → real `player_win`. Simulates at the hardware boundary — no
  win-path bypass. Picker labels kinds Booster / Sealed / Card.
- **Mock scenario controls** (`mock/raspberry/main.py`): `POST /scenarios/{
  always-win|always-lose|random|odds|rfid-fail|exit-stuck|disconnect|
  fault-clear|next-tag/{uid}}`, `GET /scenarios/state`. `next_uid_override`
  forces which ball the next arm reports.
- **Seed**: `python -m app.seed_dev [--reset]` — reset breaks the
  opened_booster→win FK cycle, deletes in FK-safe order (ledger before win),
  reseeds real card assets + 12 balls (6 opened-booster, 6 single-card) + a
  pkmn-151 ClosedBooster/OpenedBoosters.

---

## 12. Config / env flags (`config.py`)

- `DATABASE_URL`, `PI_SERVER_URL`, `BASE_RPC_HTTP/WS`, `CLAW_CONTRACT_ADDRESS`,
  `CHAIN_ID`, `CLAW_PRIVATE_KEY`.
- `BYPASS_PAYMENT`, `FREE_PLAY`, `DEV_TOOLS` (+ `NEXT_PUBLIC_*` mirrors).
- `WALLET_PROVIDER` (reown|privy).
- Admin: `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_JWT_AUDIENCE`,
  `ADMIN_EMAIL_ALLOWLIST`, `ADMIN_EMAIL_DOMAINS`.
- Stripe: `STRIPE_*`. Treasury: `TREASURY_ADDRESS`, `TREASURY_PRIVATE_KEY`
  (falls back to CLAW_PRIVATE_KEY). Telegram: `TELEGRAM_BOT_TOKEN/CHAT`.
- Constants: `TURN_DURATION=30`, `INTER_TURN_DELAY=3`, `SYNC_PERIOD=15`,
  `TICKET_PRICE_CENTS`, `CHARGEBACK_HOLD_DAYS`, `RESELL_PRICE_BY_BOOSTER_SKU_CENTS`
  (card resell now lives in the `rarity` table).

---

## 13. Migrations (chronological)

- `a8936058c0d8` baseline schema
- `b7c1d9e2f3a4` enable RLS
- `c3d5e7f9a1b2` add Payment table
- `d4e6f8a0b2c3` add COMP payment method
- `68ab078c6a05` (closed booster fields / opened-booster reuse groundwork)
- `382488dd0106` card catalog: split Card into CardType + instance
- `f0a1b2c3d4e5` manage holo types & rarities (vocab tables, rarity price,
  card_type.rarity off enum)
- `a1c3e5b7d9f2` closed-booster prize (PrizeKind.CLOSED_BOOSTER + ball.closed_booster_id)
- `b2d4f6a8c0e1` rename PrizeKind BOOSTER_PAIR → OPENED_BOOSTER
- `c3e5a7b9d1f4` one LOADED ball per prize (partial unique indexes)
- `d5f7b9c1e3a6` drop unique on win.ball_id (reusable tag → many wins)

---

## 14. Known placeholders / TODOs / risks

- **Crypto/commit-reveal trust model is placeholder** — `commitment_hash`,
  `merkle_proof`, `secret`, `CommitmentBatch` are well-formed but not
  cryptographically meaningful yet. DO NOT treat as real trust guarantees.
- **On-chain payout (notifyWin) skipped in bypass**; escrow contract retired.
- **Booster face textures need CORS** (Supabase public URLs OK; arbitrary pasted
  URLs may fail the WebGL upload → procedural fallback). Seeded pkmn-151 uses
  example.com placeholders (won't render — upload real images per ClosedBooster).
- **Reveal uses the won cards** now, but MOCK_DECK is the fallback for wins with
  no card previews.
- **Gas sponsorship (paymaster)** for embedded-wallet USDC transfers: pending.
- **Stripe stablecoin Financial Account eligibility**: pending confirmation.
- **Rotate exposed secrets** (Supabase DB password, INFURA, TELEGRAM were
  printed during earlier sessions).
- **Dev fastapi lacks --reload in prod** (intentional); dev has it.

---

## 15. Invariants worth testing (regression targets)

1. A LOADED ball's prize must be claimable, else the queue pauses (both at
   pay-time and turn-start).
2. At most one LOADED ball per opening/card (partial unique index); a
   settled/voided ball doesn't block rebinding a freed prize.
3. Opening is consumed ONLY on live-open; buyback/ship return it to AVAILABLE
   (reusable).
4. A reusable ball can be re-won many times (`win.ball_id` not unique); one win
   per turn (`queue_entry_id` unique); no double-win within a turn (grab guard).
5. reserve_win commits the GRABBED status before prize bookkeeping (no ghost
   re-award on failure); failure → `prize_unavailable`, never a fake win.
6. Deleting a holo-type/rarity in use is refused.
7. Card resell price = the `rarity` row's price at settlement.
8. Win modal opens once per `pendingWin.win_id`, not on the roundWon stat.
