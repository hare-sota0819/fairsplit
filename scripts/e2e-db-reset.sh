#!/usr/bin/env bash
# Recreates the e2e scratch database and migrates it fresh.
#
# The e2e suite used to run against the developer's long-lived dev database
# (fairsplit), which accumulates hundreds of test accounts/groups per run and
# eventually makes group creation slow enough to flake the suite (see
# docs/BUGS.md 2026-08-07 / 2026-08-09-10). This script gives every e2e run
# its own disposable database instead. It is chained into
# playwright.config.ts's webServer.command, so it runs before `next start`
# boots — for both `verify.sh` and a bare `npx playwright test`.
#
# DATABASE_URL is read from this script's own environment (set by
# playwright.config.ts's webServer.env to the *_e2e URL). It is never
# defaulted here, and the database name is asserted to end in `_e2e` before
# any DROP runs — this script must never be able to touch the dev DB.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set to the scratch (*_e2e) database URL}"

DB_NAME="$(node -e "console.log(new URL(process.argv[1]).pathname.replace(/^\//, ''))" "$DATABASE_URL")"

case "$DB_NAME" in
  *_e2e) ;;
  *)
    echo "refusing to reset database '$DB_NAME': name does not end in _e2e (guard against touching the dev DB)" >&2
    exit 1
    ;;
esac

# Maintenance connection: same host/user/port as DATABASE_URL, but the
# "postgres" admin database, since you cannot DROP/CREATE the database you're
# connected to. Query params like `?schema=` are a Prisma convention, not a
# libpq one — psql rejects them, so strip the query string here.
ADMIN_URL="$(node -e "
  const u = new URL(process.argv[1]);
  u.pathname = '/postgres';
  u.search = '';
  process.stdout.write(u.toString());
" "$DATABASE_URL")"

echo "== Recreating scratch database '$DB_NAME' =="
# Kick any lingering connections from a previous run's server process before
# dropping — Postgres refuses DROP DATABASE while sessions are attached.
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\";"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\";"

echo "== Migrating '$DB_NAME' =="
# prisma.config.ts's CLI datasource resolves DIRECT_URL ?? DATABASE_URL; pin
# both explicitly so migrate deploy can never fall back to a dev-DB DIRECT_URL.
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DATABASE_URL" npx prisma migrate deploy
