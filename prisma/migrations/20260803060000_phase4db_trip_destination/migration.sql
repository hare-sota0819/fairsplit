-- Phase 4D-B: "Where are you going?" asks where, not what currency.
--
-- The question was answering itself: it read "Where are you going?" and then
-- offered KRW / JPY / USD / EUR. A traveller knows the country, not the ISO
-- 4217 code, so the country is now the question and the currency falls out of
-- it. The city is a label only — it names the trip on screen and touches no
-- money, rate or date.
--
-- Additive and nullable, no backfill. Every group created before this keeps
-- its `tripCurrency` exactly as it was and simply has no country recorded;
-- nothing about how it settles changes. Deriving a country BACKWARDS from a
-- currency would be a guess (EUR alone spans twenty of them), so it is not
-- attempted.
ALTER TABLE "Group" ADD COLUMN "tripCountry" TEXT;
ALTER TABLE "Group" ADD COLUMN "tripCity" TEXT;
