# Garra — automated release (PROPOSAL)

> Status: **design sketch, not built.** Written 2026-09-08 after a bring-up
> session where every failure below happened at least once. Nothing here is
> implemented yet; where something already exists it says so.
>
> Companion docs: `SPEC.md` (architecture), `central/DEPLOY.md` (today's manual
> VPS runbook), `raspberry/FLASHING.md` (today's manual flash).

---

## 1. The problem

Three tiers update through three unrelated mechanisms, coordinated by hand:

| Tier | How it updates today | Failure if forgotten |
|---|---|---|
| VPS (central) | `git pull` + `./update.sh` | old schema, old API |
| Pi (socket) | `git pull` + `compose up --build` | stale turn logic |
| ESP (chute) | `./flash.sh --prebuilt` | **silent wrong behaviour** |

The third row is the dangerous one. A Pi running new code against unflashed
firmware looked completely healthy for hours while awarding prizes from the
wrong ball, because the bug lived in a code path with no version signal
attached to it.

Four things go wrong in practice, all observed:

- **Build ids don't track content.** `garra-chute-0.2.0` is a hand-edited
  string. It does not change when the firmware does, so "did the flash land?"
  cannot be answered by looking.
- **Artifacts are refreshed by hand.** The Pi cannot compile ESP32 firmware
  (32-bit userland, no xtensa host binary), so `raspberry/prebuilt-fw/` is
  built off-Pi and committed. Forget the copy and the Pi flashes stale bins
  from a tree that looks up to date.
- **Protocol bumps stop the machine until all three land.** That is the design
  working (see `versioning.py`), but it makes a partial deploy a hard outage
  rather than a warning.
- **The cabinet's network is the weakest link.** Deploy steps issued from
  elsewhere can land half-applied.

## 2. Principles

1. **Build where the toolchain works; ship artifacts to the cabinet.** The Pi
   flashes, it does not compile.
2. **Push to the VPS, pull to the cabinet.** The VPS has a public address and
   is trivially reachable. The Pi is behind home NAT on WiFi. A host that
   fetches its own work on a timer does not care if the network blinked.
3. **Identity is the commit sha.** Not a hand-maintained version string.
4. **The cabinet decides when it is safe.** A deploy waits for an idle
   machine; it never interrupts a paid turn.
5. **Flashing stays deliberate.** Building firmware automatically is safe.
   Writing it to the chip while nobody is there is the step that can leave you
   wanting a USB cable.

## 3. Pipeline

On push to `main`, path-filtered so a CSS change never touches the cabinet.

```
                    ┌─ always ──────────────────────────────────┐
                    │ sim/tests/test_protocol_versions.py        │  ← exists,
                    │ central/fastapi/tests (pytest + postgres)  │    static
                    └───────────────────────────────────────────┘
  push to main ──┬─ esp/**       → build firmware (x86) → publish bins
                 ├─ raspberry/** ┐
                 │               ├→ publish deploy target (sha)
                 ├─ esp/**       ┘
                 └─ central/**   → ssh VPS → ./update.sh          ← exists
```

The static protocol test is the highest-value thing to wire up first. It is
the only check that catches a half-bumped wire contract *before* it reaches
hardware, and it needs no running stack.

### Firmware in CI

Removes the manual `prebuilt-fw` refresh entirely:

```
pio run -e esp32dev
→ bootloader.bin partitions.bin boot_app0.bin firmware.bin
→ published for the Pi to fetch (committed, release asset, or GHCR)
```

`raspberry/prebuilt-fw/README.md` documents the manual version this replaces.

### Flasher image in CI

Same argument. Build it once for `linux/arm/v7`, push to GHCR, and the Pi
pulls a finished image instead of running a 300-second apt stage over a link
that has managed 250 bytes in twelve seconds. See the note at the end of the
`8ed1619` commit message.

## 4. The cabinet side (pull)

A **systemd timer on the Pi**, deliberately *outside* the container it
deploys, so it survives whatever it does:

```
1. fetch the published target sha
2. already on it?                        → exit (no-op)
3. ask central: is the machine idle?     → if not, exit and retry next tick
4. set the deploy lock (queue pauses)
5. git pull --ff-only
6. compose up -d --build socket
7. poll /health for up to 60s
8.   healthy → tag the image known-good, release the lock
9.   not     → restore the previous image, restart, release the lock, alert
```

Steps 7-9 are what remove the need to SSH in. A container crash-looping on a
bad build is the main reason anyone logs into that Pi, and a health check with
automatic rollback handles it without hands.

Combined with only ever deploying a CI-green sha, most bad deploys never reach
the hardware at all.

### The pause

`machine.blocked()` already gates both pay-time and turn-start, and already
carries `version_fault` and `cabinet_fault`. A deploy lock is one more reason
in that list. The admin cabinet page should show it, so an operator seeing a
paused queue can tell "deploying" apart from "jammed".

### Build identity

Bake the short sha in at build time, so `is it up to date` is exact rather
than inferred:

- **ESP** — `proto::FW_VERSION` becomes `garra-chute-<sha>`, and it already
  rides every `pong` as well as the boot `ready`, so the Pi relearns it on
  every health probe.
- **Pi** — `PI_FW` likewise, injected as a build arg.
- **VPS** — its own sha in `/health`.

The ops page then marks each tier current or behind against the deploy target.
That turns today's "did I remember to flash?" into a glance, and it is worth
doing **first**: an hour of work, no deployment risk, and it fixes the
confusion that motivated this whole document.

## 5. What stays manual

**Triggering the ESP flash.** CI builds the firmware and the Pi fetches it,
but writing it to the chip stays an explicit button. It stops the chute, needs
the cabinet genuinely idle, and bundling it into a general "update everything"
makes it too easy to fire without thinking about where the machine is.

Recovery is better than it looks, though: `flash.sh --prebuilt` is esptool
over USB from the Pi, not OTA, and the board auto-resets into the bootloader
without anyone pressing BOOT. So while the Pi is up, a bad flash is
re-triggerable remotely.

## 6. Risks and open questions

- **Reaching the Pi from a GitHub-hosted runner** means the runner joins the
  tailnet on every push. That is a real widening of the trust boundary. The
  pull design above avoids it entirely, which is the main reason to prefer
  pull over push here. A self-hosted runner on the Pi is the other option and
  trades tailnet exposure for arbitrary workflow code on the cabinet
  controller.
- **Deployer bootstrap.** A bad commit to the deployer breaks the mechanism
  that would fix it. Keep it small and stop it updating itself, so it is the
  one thing on that Pi that essentially never changes.
- **WiFi is the real single point of failure.** Measured at -70 dBm with over
  a thousand excessive retries, and DNS died twice in one session. No
  deployment design survives a cabinet that falls off the network, and that
  link also carries the video push and the tunnel the backend rides. An
  antenna or an ethernet run is worth more than any automation here.
- **Secrets.** VPS deploy key, and a service credential for the idle check,
  since admin auth is Supabase JWT and a runner has no interactive session.
- **Migrations still run from `update.sh`.** Alembic owns the schema and prod
  is nine revisions behind as of writing. Automating deploys does not change
  that a migration is the one step with no rollback.

## 7. Suggested order

1. **Build identity.** Sha into all three build ids, surfaced on the ops page.
   No deployment risk, immediate payoff.
2. **CI without deployment.** Protocol test, backend tests, firmware build,
   flasher image. Nothing touches the cabinet yet.
3. **VPS deploy on `central/**`.** Recoverable over SSH if it goes wrong.
4. **Pi pull deployer**, with health check and rollback.
5. **Flash button**, once everything under it is boring.
