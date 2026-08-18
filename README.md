# FairSplit

Splitwise-style group expense app with receipt-item-level splitting,
per-payer average-cost exchange rates, and checkpoint settlement.

## Setup

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a local Postgres, then: npx prisma migrate dev
npm test
```

`npm run test:e2e` (and `scripts/verify.sh`) never touch that database — they run
against a disposable `fairsplit_e2e` database, dropped and re-migrated at the
start of every run (see `scripts/e2e-db-reset.sh`).

## Layout

- `prisma/schema.prisma` — data model (money: BigInt minor units; rates: Decimal — see docs/DECISIONS.md)
- `src/lib/settlement/` — pure settlement engine (no DB access), unit-tested
- `docs/` — prompts, status, decisions

## Attribution

See `NOTICE` — the debt simplification algorithm is adapted from Spliit (MIT).
