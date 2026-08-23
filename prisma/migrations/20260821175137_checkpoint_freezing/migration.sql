-- AlterTable
ALTER TABLE "Checkpoint" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "frozenAtCheckpointId" TEXT;

-- AlterTable
ALTER TABLE "ExpenseFunding" ADD COLUMN     "frozenAmount" BIGINT,
ADD COLUMN     "frozenRateDen" BIGINT,
ADD COLUMN     "frozenRateNum" BIGINT,
ADD COLUMN     "frozenSource" TEXT;

-- CreateIndex
CREATE INDEX "Expense_frozenAtCheckpointId_idx" ON "Expense"("frozenAtCheckpointId");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_frozenAtCheckpointId_fkey" FOREIGN KEY ("frozenAtCheckpointId") REFERENCES "Checkpoint"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Checkpoint" ADD CONSTRAINT "Checkpoint_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
