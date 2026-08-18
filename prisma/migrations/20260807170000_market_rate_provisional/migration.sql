-- Records that an expense's marketRateSnapshot is the wallet's own average
-- cost, stored because no market rate could be reached when it was entered.
-- Adds a defaulted column; no existing row is rewritten.
ALTER TABLE "Expense" ADD COLUMN "marketRateProvisional" BOOLEAN NOT NULL DEFAULT false;
