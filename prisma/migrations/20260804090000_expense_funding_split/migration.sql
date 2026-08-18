-- An expense's funding becomes a LIST.
--
-- A travel card holding 50,000 JPY cannot pay an 82,000 JPY receipt on its
-- own, and the remainder is not a cosmetic detail: the funding source decides
-- the RATE, so pricing the whole receipt at the card's average cost
-- overcharges the group for money that never touched the card. The single
-- `Expense.walletId` column had nowhere to put "50,000 from the card, 32,000
-- in cash", which is why the wizard never asked (docs/BUGS.md 2026-08-04).
--
-- The backfill is EXACT: every existing expense becomes one portion holding
-- the whole amount and exactly the source, own rate and bank figure it
-- already had. No expense settles at a different number after this migration,
-- and none can until someone splits one by hand.

CREATE TABLE "ExpenseFunding" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "amount" BIGINT NOT NULL,
    "walletId" TEXT,
    "actualChargedAmount" BIGINT,
    "ownRateSnapshot" DECIMAL(24,10),

    CONSTRAINT "ExpenseFunding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExpenseFunding_expenseId_idx" ON "ExpenseFunding"("expenseId");

CREATE INDEX "ExpenseFunding_walletId_idx" ON "ExpenseFunding"("walletId");

ALTER TABLE "ExpenseFunding" ADD CONSTRAINT "ExpenseFunding_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Restrict, like the column it replaces: deleting a wallet that paid for
-- something would leave that expense with no rate to settle at.
ALTER TABLE "ExpenseFunding" ADD CONSTRAINT "ExpenseFunding_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- One portion per expense, carrying everything the old columns said. The id
-- is derived from the expense id rather than generated: this migration is
-- then idempotent in shape and the row is traceable to its expense by eye.
INSERT INTO "ExpenseFunding" (
    "id", "expenseId", "position", "amount", "walletId",
    "actualChargedAmount", "ownRateSnapshot"
)
SELECT
    'fund_' || "id", "id", 0, "amount", "walletId",
    "actualChargedAmount", "ownRateSnapshot"
FROM "Expense";

-- An expense with no funding row cannot be priced at all, so a partial
-- backfill must stop the deploy rather than reach the settlement engine.
DO $$
DECLARE orphaned INTEGER;
BEGIN
    SELECT COUNT(*) INTO orphaned
    FROM "Expense" e
    WHERE NOT EXISTS (
        SELECT 1 FROM "ExpenseFunding" f WHERE f."expenseId" = e."id"
    );
    IF orphaned > 0 THEN
        RAISE EXCEPTION 'ExpenseFunding backfill missed % expense(s)', orphaned;
    END IF;
END $$;

ALTER TABLE "Expense" DROP CONSTRAINT "Expense_walletId_fkey";

DROP INDEX "Expense_walletId_idx";

ALTER TABLE "Expense" DROP COLUMN "walletId";

ALTER TABLE "Expense" DROP COLUMN "actualChargedAmount";

ALTER TABLE "Expense" DROP COLUMN "ownRateSnapshot";
