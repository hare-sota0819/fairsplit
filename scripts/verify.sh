#!/usr/bin/env bash
# Verification gate — every check must pass before work is called done.
set -euo pipefail
cd "$(dirname "$0")/.."

# Prisma needs DATABASE_URL to resolve; bootstrap a local .env if missing.
if [ ! -f .env ]; then
  cp .env.example .env
fi

echo "== Design token contrast gate =="
node scripts/design/contrast-check.mjs

echo "== ESLint =="
npm run lint

echo "== TypeScript =="
npm run typecheck

echo "== Prisma schema =="
npx prisma validate

echo "== Tests + coverage (90% threshold on settlement engine) =="
npm run test:coverage

echo "== Production build =="
npm run build

echo "== Playwright smoke (signup / group create / join) =="
npx playwright install chromium >/dev/null
npm run test:e2e

echo "verify.sh: ALL CHECKS PASSED"
