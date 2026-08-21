-- CreateTable
CREATE TABLE "RecallRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT,
    "label" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "classified" TEXT NOT NULL,
    "parserCommit" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecallRecord_userId_createdAt_idx" ON "RecallRecord"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RecallRecord" ADD CONSTRAINT "RecallRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecallRecord" ADD CONSTRAINT "RecallRecord_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;
