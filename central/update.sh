#!/usr/bin/env bash
#
# Recurring deploy. Run this on the VPS every time you ship:
#
#     cd ~/peluchera/central && ./update.sh
#
# It pulls, rebuilds, backs up the DB, migrates, then restarts — in that order,
# so the app is never serving against a half-migrated schema. If the migration
# fails, the old version keeps serving and nothing is restarted.
#
# (deploy.sh is the FIRST-TIME provisioning script — docker, swap, TLS certs,
# clone. You don't need it again after the box is set up.)
#
# Flags (env vars):
#     SKIP_PULL=1     deploy whatever is already checked out
#     SKIP_BACKUP=1   skip the pre-migration pg_dump
#
set -euo pipefail
cd "$(dirname "$0")"   # -> central/

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m !! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

# --- docker compose shim (v2 plugin vs legacy binary) --------------------
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  die "Neither 'docker compose' nor 'docker-compose' found."
fi

# --- env ----------------------------------------------------------------
[[ -f .env ]] || die ".env not found in $(pwd)"
set -a; source .env; set +a
: "${DATABASE_URL:?DATABASE_URL must be set in .env}"

# pg_dump wants the libpq form; DATABASE_URL is the SQLAlchemy form.
PGURL="${DATABASE_URL/postgresql+psycopg:\/\//postgresql://}"

# --- 1. pull ------------------------------------------------------------
if [[ "${SKIP_PULL:-0}" != "1" ]]; then
  log "Pulling latest code"
  if [[ -n "$(git status --porcelain)" ]]; then
    die "Working tree is dirty on the VPS — a pull would clobber local edits.
   Inspect with 'git status', then commit/stash/discard, or run:
       SKIP_PULL=1 ./update.sh"
  fi
  git pull --ff-only
fi
log "Deploying $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

# --- 2. build -----------------------------------------------------------
# NOTE: NEXT_PUBLIC_* are baked into the Next.js bundle at build time, so
# changing one only takes effect after this rebuild.
log "Building images"
$DC build

# --- 3. back up the DB before touching the schema -----------------------
backup_db() {
  mkdir -p backups
  local dump="backups/pre-migrate-$(date +%Y%m%d-%H%M%S).sql.gz"
  log "Backing up DB -> $dump"

  # Prefer the running 'db' container (has pg_dump, and can reach both the
  # compose network and the internet). Fall back to a throwaway postgres image
  # on the host network (for a remote DB, e.g. Supabase).
  if $DC ps --status=running 2>/dev/null | grep -q '\bdb\b'; then
    $DC exec -T db pg_dump "$PGURL" | gzip > "$dump" || { rm -f "$dump"; return 1; }
  else
    docker run --rm --network host -e PGURL="$PGURL" postgres:17 \
      sh -c 'pg_dump "$PGURL"' | gzip > "$dump" || { rm -f "$dump"; return 1; }
  fi

  [[ -s "$dump" ]] || { rm -f "$dump"; return 1; }
  echo "    ok ($(du -h "$dump" | cut -f1))"
  RESTORE_HINT="$dump"

  # Retention: keep the most recent KEEP_BACKUPS dumps, delete older ones, so
  # they don't quietly fill the VPS disk.
  local keep="${KEEP_BACKUPS:-7}"
  local stale
  stale=$(ls -1t backups/pre-migrate-*.sql.gz 2>/dev/null | tail -n "+$((keep + 1))" || true)
  if [[ -n "$stale" ]]; then
    echo "    pruning $(echo "$stale" | wc -l) old dump(s), keeping newest $keep"
    echo "$stale" | xargs -r rm -f
  fi
}

RESTORE_HINT=""
if [[ "${SKIP_BACKUP:-0}" != "1" ]]; then
  backup_db || die "pg_dump failed — aborting BEFORE migrating, DB untouched.
   Fix the dump, or accept the risk with:  SKIP_BACKUP=1 ./update.sh"
else
  warn "SKIP_BACKUP=1 — no pre-migration dump taken."
fi

# --- 4. migrate ---------------------------------------------------------
# Alembic owns the schema (no create_all). This is the single point where the
# DB is brought to head, and it runs BEFORE the app restarts.
log "Migration status (current -> head)"
$DC run --rm fastapi alembic current || true
$DC run --rm fastapi alembic heads

log "Applying migrations"
if ! $DC run --rm fastapi alembic upgrade head; then
  die "MIGRATION FAILED — app NOT restarted; the old version is still serving.
   The DB may be partially migrated. To restore:
       gunzip -c ${RESTORE_HINT:-backups/pre-migrate-<stamp>.sql.gz} | psql '$PGURL'
   Or fix the migration and re-run ./update.sh"
fi

# --- 5. restart ---------------------------------------------------------
log "Restarting services"
$DC up -d --remove-orphans

# --- 6. verify ----------------------------------------------------------
log "Service status"
$DC ps
if $DC ps -a --status=exited 2>/dev/null | grep -q 'claw_'; then
  warn "Some containers exited — check:  $DC logs --tail=50"
fi

docker image prune -f >/dev/null 2>&1 || true
log "Done. Deployed $(git rev-parse --short HEAD)."
