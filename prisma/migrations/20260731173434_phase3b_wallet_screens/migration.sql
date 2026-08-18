-- AlterTable
ALTER TABLE "ExchangeRecord" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "isWalletAdjustment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "exchangePromptDismissedAt" TIMESTAMP(3),
ADD COLUMN     "lastSeenRecalcAt" TIMESTAMP(3),
ADD COLUMN     "walletHidden" BOOLEAN NOT NULL DEFAULT false;
