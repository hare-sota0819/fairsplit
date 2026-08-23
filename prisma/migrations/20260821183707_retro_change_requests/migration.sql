-- CreateEnum
CREATE TYPE "RetroChangeKind" AS ENUM ('EDIT', 'CANCEL', 'RESTORE');

-- CreateEnum
CREATE TYPE "RetroChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'AUTO_APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RetroResponse" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "RetroChangeRequest" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "kind" "RetroChangeKind" NOT NULL,
    "status" "RetroChangeStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "proposal" JSONB,
    "balanceDiff" JSONB NOT NULL,
    "checkpointIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "RetroChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetroChangeResponse" (
    "requestId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "response" "RetroResponse",
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "RetroChangeResponse_pkey" PRIMARY KEY ("requestId","memberId")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetroChangeRequest_groupId_status_idx" ON "RetroChangeRequest"("groupId", "status");

-- CreateIndex
CREATE INDEX "RetroChangeRequest_expenseId_idx" ON "RetroChangeRequest"("expenseId");

-- CreateIndex
CREATE INDEX "RetroChangeResponse_memberId_idx" ON "RetroChangeResponse"("memberId");

-- CreateIndex
CREATE INDEX "AuditEvent_groupId_at_idx" ON "AuditEvent"("groupId", "at");

-- AddForeignKey
ALTER TABLE "RetroChangeRequest" ADD CONSTRAINT "RetroChangeRequest_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroChangeRequest" ADD CONSTRAINT "RetroChangeRequest_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroChangeRequest" ADD CONSTRAINT "RetroChangeRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroChangeResponse" ADD CONSTRAINT "RetroChangeResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "RetroChangeRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetroChangeResponse" ADD CONSTRAINT "RetroChangeResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Serialization, enforced by the database rather than by a read-then-write.
--
-- The spec's rule is that the diff shown to approvers must be the diff that
-- gets applied, so exactly one request may be open per group. Checking first
-- and inserting second leaves a window two concurrent proposals both pass
-- through; a partial unique index has no window. The application still checks
-- first, to produce the readable "another change is pending" message — this is
-- what makes the check's answer true.
--
-- Partial indexes have no Prisma schema syntax, so it lives here. Anything
-- that adds a status to RetroChangeStatus must decide whether it belongs in
-- this predicate.
CREATE UNIQUE INDEX "RetroChangeRequest_one_pending_per_group"
  ON "RetroChangeRequest" ("groupId")
  WHERE "status" = 'PENDING';
