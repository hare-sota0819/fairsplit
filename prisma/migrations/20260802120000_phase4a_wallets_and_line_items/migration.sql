-- Phase 4A: wallets replace the CASH/CARD flag, and receipt lines store a
-- unit price instead of a line total.
--
-- The funding-source half is exact:
--   * CASH  -> the payer's cash wallet in that currency (same average-cost
--              rate, because the wallet holds all of that member's records
--              for that currency, which is what computeAvgRate used before).
--   * CARD  -> walletId NULL (pay-as-you-go), which resolves to the market
--              snapshot / actualChargedAmount exactly as before.
--   * assignments -> quantity 1 each, so a proportional split over equal
--              weights is the equal split the engine did before.
--
-- The item half deliberately is NOT. `ExpenseItem.amount` meant "line total"
-- to the engine and "unit price" to whoever typed it — that ambiguity IS the
-- bug — so any row with quantity > 1 has two defensible readings and no way
-- to tell them apart. On the owner's instruction (2026-08-02) the clean
-- reading wins: the stored figure becomes the UNIT price and the recorded
-- quantity starts counting. A pre-existing line of "1,500 x 3" therefore
-- becomes 4,500, which is what the person entering it meant and not what the
-- old code did. The only rows this can move are throwaway test data, which
-- the owner is deleting before this ships.

-- ---------------------------------------------------------------- wallets --

CREATE TYPE "WalletType" AS ENUM ('CASH', 'TRAVEL_CARD', 'OTHER_PREPAID');

CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "WalletType" NOT NULL,
    "label" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Wallet_memberId_idx" ON "Wallet"("memberId");

ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "Member"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- One cash wallet per (member, currency) that has any history: an exchange
-- record, or a cash expense they paid. UNION deduplicates, so the
-- (memberId, currency) pair is unique across the backfilled rows and the
-- joins below can never match two wallets.
INSERT INTO "Wallet" ("id", "memberId", "type", "label", "currency", "createdAt")
SELECT gen_random_uuid()::text, source."memberId", 'CASH', 'Cash', source."currency", CURRENT_TIMESTAMP
FROM (
    SELECT "memberId", "currency" FROM "ExchangeRecord"
    UNION
    SELECT "payerId" AS "memberId", "currency" FROM "Expense" WHERE "paymentMethod" = 'CASH'
) AS source;

-- ------------------------------------------------------- exchange records --

ALTER TABLE "ExchangeRecord" ADD COLUMN "walletId" TEXT;

UPDATE "ExchangeRecord" AS r
SET "walletId" = w."id"
FROM "Wallet" AS w
WHERE w."memberId" = r."memberId"
  AND w."currency" = r."currency"
  AND w."type" = 'CASH';

ALTER TABLE "ExchangeRecord" ALTER COLUMN "walletId" SET NOT NULL;

CREATE INDEX "ExchangeRecord_walletId_idx" ON "ExchangeRecord"("walletId");

ALTER TABLE "ExchangeRecord" ADD CONSTRAINT "ExchangeRecord_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- --------------------------------------------------------- funding source --

ALTER TABLE "Expense" ADD COLUMN "walletId" TEXT;

UPDATE "Expense" AS e
SET "walletId" = w."id"
FROM "Wallet" AS w
WHERE e."paymentMethod" = 'CASH'
  AND w."memberId" = e."payerId"
  AND w."currency" = e."currency"
  AND w."type" = 'CASH';

-- A cash expense that lost its wallet would silently become pay-as-you-go
-- and settle at a different rate. Refuse to migrate instead.
DO $$
DECLARE orphaned INTEGER;
BEGIN
    SELECT count(*) INTO orphaned
    FROM "Expense" WHERE "paymentMethod" = 'CASH' AND "walletId" IS NULL;
    IF orphaned > 0 THEN
        RAISE EXCEPTION 'phase4a: % cash expense(s) could not be attached to a wallet', orphaned;
    END IF;
END $$;

ALTER TABLE "Expense" DROP COLUMN "paymentMethod";

DROP TYPE "PaymentMethod";

CREATE INDEX "Expense_walletId_idx" ON "Expense"("walletId");

ALTER TABLE "Expense" ADD CONSTRAINT "Expense_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- -------------------------------------------------------------- line items --

ALTER TABLE "ExpenseItem" ADD COLUMN "unitAmount" BIGINT;

-- The stored figure was always what someone typed off a receipt, which is a
-- unit price. Take it at its word and let the recorded quantity start
-- counting. See the header: this can change a line's total, by design.
UPDATE "ExpenseItem" SET "unitAmount" = "amount";

ALTER TABLE "ExpenseItem" ALTER COLUMN "unitAmount" SET NOT NULL;

ALTER TABLE "ExpenseItem" DROP COLUMN "amount";

-- ------------------------------------------------------ per-person quantity --

ALTER TABLE "ItemAssignment" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
