-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "receiptImagePath" TEXT;

-- CreateTable
CREATE TABLE "ReceiptScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "outcome" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "thinkingTokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReceiptScan_userId_createdAt_idx" ON "ReceiptScan"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReceiptScan" ADD CONSTRAINT "ReceiptScan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptScan" ADD CONSTRAINT "ReceiptScan_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
