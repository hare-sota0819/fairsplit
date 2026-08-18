-- Phase 4C: the currency the trip is spent in. A default for ENTERING money;
-- settlementCurrency remains the unit balances are reported in.
-- Nullable with no backfill: existing groups keep today's behaviour exactly.
ALTER TABLE "Group" ADD COLUMN "tripCurrency" TEXT;
