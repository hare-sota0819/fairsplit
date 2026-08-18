/*
  Warnings:

  - Added the required column `enteredById` to the `Expense` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Expense` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "enteredById" TEXT NOT NULL,
ADD COLUMN     "isPersonal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
