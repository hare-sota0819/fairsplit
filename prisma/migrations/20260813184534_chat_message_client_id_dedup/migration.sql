-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "clientMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_memberId_clientMessageId_key" ON "ChatMessage"("memberId", "clientMessageId");

