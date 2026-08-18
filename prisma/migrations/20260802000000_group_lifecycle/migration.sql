-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "createdById" TEXT;

-- Backfill: groups created before this column existed. Member has no
-- createdAt, but ids are cuid v1 — a base36 timestamp prefix — so the
-- lexicographically smallest member id is the earliest one, i.e. the row
-- created together with the group itself. Approximate by construction and
-- only ever applied to pre-existing rows.
UPDATE "Group" g
SET "createdById" = (
  SELECT m."userId"
  FROM "Member" m
  WHERE m."groupId" = g."id" AND m."userId" IS NOT NULL
  ORDER BY m."id" ASC
  LIMIT 1
);

-- AlterTable
ALTER TABLE "Member" DROP COLUMN "active",
ADD COLUMN     "leftAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
