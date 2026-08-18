-- Backfill: every member's pre-session chat rows become one "이전 대화"
-- session, so no history is lost and every row gains a session home.
INSERT INTO "ChatSession" ("id", "groupId", "memberId", "title", "titleEdited", "createdAt", "lastMessageAt")
SELECT
  'legacy_' || md5("groupId" || ':' || "memberId"),
  "groupId",
  "memberId",
  '이전 대화',
  false,
  MIN("createdAt"),
  MAX("createdAt")
FROM "ChatMessage"
WHERE "sessionId" IS NULL
GROUP BY "groupId", "memberId";

UPDATE "ChatMessage"
SET "sessionId" = 'legacy_' || md5("groupId" || ':' || "memberId")
WHERE "sessionId" IS NULL;
