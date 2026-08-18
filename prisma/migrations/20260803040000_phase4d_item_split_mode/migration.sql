-- Phase 4D-A: "Everyone" divides a receipt line instead of handing out one
-- unit each.
--
-- 4 skewers between 2 people is 2 each. 5 between 2 does not go round, and
-- the answer is NOT a quantity of 2.5 — `quantity` stays an integer — so
-- that line's MONEY is split equally instead and each share is stored
-- outright. Which rule applied has to be recorded, not inferred, because the
-- breakdown screen has to be able to say so.
--
-- Purely additive. Every existing line keeps its quantities and is
-- BY_QUANTITY by default, which is exactly how it already settled: no
-- historical expense changes by a single minor unit.
CREATE TYPE "ItemSplitMode" AS ENUM ('BY_QUANTITY', 'BY_AMOUNT');

ALTER TABLE "ExpenseItem"
  ADD COLUMN "splitMode" "ItemSplitMode" NOT NULL DEFAULT 'BY_QUANTITY';

-- Null under BY_QUANTITY, where the share is derived from `quantity`.
ALTER TABLE "ItemAssignment" ADD COLUMN "amount" BIGINT;
