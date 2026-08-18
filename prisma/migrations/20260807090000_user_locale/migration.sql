-- The language a person reads the app in, kept on the account rather than the
-- device. Adds a column with a default, so every existing row simply becomes
-- Korean; no existing data is rewritten.
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'ko';
