-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "actualChargedAmount" BIGINT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" TEXT;

-- CreateTable
CREATE TABLE "RateCache" (
    "date" TEXT NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCache_pkey" PRIMARY KEY ("date","base","quote")
);

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
