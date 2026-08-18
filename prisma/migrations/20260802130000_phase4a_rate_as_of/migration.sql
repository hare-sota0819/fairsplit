-- Phase 4A: record which date a cached quote is actually FOR.
--
-- Existing rows cannot say — they were stored under the requested date with
-- no record of what the provider answered — and a wrong `asOf` would freeze a
-- stale rate in permanently. RateCache is a pure cache (every expense keeps
-- its own marketRateSnapshot), so emptying it costs one refetch and nothing
-- else.
DELETE FROM "RateCache";

ALTER TABLE "RateCache" ADD COLUMN "asOf" TEXT NOT NULL;
