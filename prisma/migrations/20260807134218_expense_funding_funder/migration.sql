-- AlterTable
ALTER TABLE "ExpenseFunding" ADD COLUMN     "funderId" TEXT;

-- CreateIndex
CREATE INDEX "ExpenseFunding_funderId_idx" ON "ExpenseFunding"("funderId");

-- AddForeignKey
ALTER TABLE "ExpenseFunding" ADD CONSTRAINT "ExpenseFunding_funderId_fkey" FOREIGN KEY ("funderId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
