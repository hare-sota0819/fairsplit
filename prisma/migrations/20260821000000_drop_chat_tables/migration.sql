-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_groupId_fkey";

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_memberId_fkey";

-- DropForeignKey
ALTER TABLE "ChatMessage" DROP CONSTRAINT "ChatMessage_sessionId_fkey";

-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_groupId_fkey";

-- DropForeignKey
ALTER TABLE "ChatSession" DROP CONSTRAINT "ChatSession_memberId_fkey";

-- DropForeignKey
ALTER TABLE "RecallRecord" DROP CONSTRAINT "RecallRecord_groupId_fkey";

-- DropForeignKey
ALTER TABLE "RecallRecord" DROP CONSTRAINT "RecallRecord_userId_fkey";

-- DropTable
DROP TABLE "ChatMessage";

-- DropTable
DROP TABLE "ChatSession";

-- DropTable
DROP TABLE "RecallRecord";

