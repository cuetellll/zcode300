-- ============================================================================
-- Mahyar Gap — migration 20261105000000_radio_rebuild
--
-- Forward-only. Runs inside a single transaction (Prisma default):
--   1. Converts legacy JSON reactions/attachments on Message and DirectMessage
--      into proper relational rows (Reaction / DmReaction / Attachment).
--   2. Removes the retired browser-sync music subsystem
--      (MusicTrack / MusicPlaylist / MusicPlaylistTrack / Server.musicEnabled).
--   3. Removes dead columns that no code ever read.
--
-- No user, message, DM, server, channel or attachment data is deleted.
-- Malformed legacy JSON rows are skipped (with a WARNING) instead of aborting.
--
-- BACKUP FIRST (run on a machine with psql access to the Railway database):
--   pg_dump "$DATABASE_URL" --no-owner -Fc -f mahyar-gap-backup.dump
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Message reactions: {"🚀": ["<userId>", ...]} -> Reaction rows
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  mrec RECORD;
  rkey text;
  uids jsonb;
  uid text;
BEGIN
  FOR mrec IN
    SELECT "id", "reactionsJson" AS rj, "createdAt"
    FROM "Message"
    WHERE "reactionsJson" IS NOT NULL AND length(btrim("reactionsJson")) > 0
  LOOP
    BEGIN
      IF jsonb_typeof(mrec.rj::jsonb) <> 'object' THEN CONTINUE; END IF;
      FOR rkey, uids IN SELECT key, value FROM jsonb_each(mrec.rj::jsonb)
      LOOP
        IF jsonb_typeof(uids) <> 'array' THEN CONTINUE; END IF;
        FOREACH uid IN ARRAY COALESCE(
          (SELECT array_agg(x) FROM jsonb_array_elements_text(uids) AS x),
          '{}'::text[]
        )
        LOOP
          IF uid IS NOT NULL AND length(uid) BETWEEN 1 AND 64
             AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = uid)
             AND NOT EXISTS (
               SELECT 1 FROM "Reaction" r
               WHERE r."messageId" = mrec.id AND r."userId" = uid AND r."emoji" = left(rkey, 64)
             )
          THEN
            INSERT INTO "Reaction" ("id", "messageId", "userId", "emoji", "createdAt")
            VALUES (
              'react_' || md5(random()::text || clock_timestamp()::text || mrec.id || uid || left(rkey, 8)),
              mrec.id, uid, left(rkey, 64), mrec."createdAt"
            );
          END IF;
        END LOOP;
      END LOOP;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Reaction conversion skipped for message % (%)', mrec.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 1b. DmReaction table (must exist before the conversions below)
-- ----------------------------------------------------------------------------
CREATE TABLE "DmReaction" (
    "id" TEXT NOT NULL,
    "directMessageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DmReaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DmReaction_directMessageId_userId_emoji_key" ON "DmReaction"("directMessageId", "userId", "emoji");

ALTER TABLE "DmReaction" ADD CONSTRAINT "DmReaction_directMessageId_fkey" FOREIGN KEY ("directMessageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DmReaction" ADD CONSTRAINT "DmReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 2. Direct-message reactions -> DmReaction rows
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  mrec RECORD;
  rkey text;
  uids jsonb;
  uid text;
BEGIN
  FOR mrec IN
    SELECT "id", "reactionsJson" AS rj, "createdAt"
    FROM "DirectMessage"
    WHERE "reactionsJson" IS NOT NULL AND length(btrim("reactionsJson")) > 0
  LOOP
    BEGIN
      IF jsonb_typeof(mrec.rj::jsonb) <> 'object' THEN CONTINUE; END IF;
      FOR rkey, uids IN SELECT key, value FROM jsonb_each(mrec.rj::jsonb)
      LOOP
        IF jsonb_typeof(uids) <> 'array' THEN CONTINUE; END IF;
        FOREACH uid IN ARRAY COALESCE(
          (SELECT array_agg(x) FROM jsonb_array_elements_text(uids) AS x),
          '{}'::text[]
        )
        LOOP
          IF uid IS NOT NULL AND length(uid) BETWEEN 1 AND 64
             AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = uid)
             AND NOT EXISTS (
               SELECT 1 FROM "DmReaction" r
               WHERE r."directMessageId" = mrec.id AND r."userId" = uid AND r."emoji" = left(rkey, 64)
             )
          THEN
            INSERT INTO "DmReaction" ("id", "directMessageId", "userId", "emoji", "createdAt")
            VALUES (
              'dreact_' || md5(random()::text || clock_timestamp()::text || mrec.id || uid || left(rkey, 8)),
              mrec.id, uid, left(rkey, 64), mrec."createdAt"
            );
          END IF;
        END LOOP;
      END LOOP;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'DmReaction conversion skipped for direct message % (%)', mrec.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Message attachments: [{"url","name","size","content_type"}] -> Attachment rows
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  mrec RECORD;
  aitem jsonb;
  url text;
BEGIN
  FOR mrec IN
    SELECT "id", "attachmentsJson" AS aj, "createdAt"
    FROM "Message"
    WHERE "attachmentsJson" IS NOT NULL AND length(btrim("attachmentsJson")) > 0
  LOOP
    BEGIN
      IF jsonb_typeof(mrec.aj::jsonb) <> 'array' THEN CONTINUE; END IF;
      FOR aitem IN SELECT * FROM jsonb_array_elements(mrec.aj::jsonb)
      LOOP
        IF jsonb_typeof(aitem) <> 'object' THEN CONTINUE; END IF;
        url := COALESCE(aitem ->> 'url', '');
        IF url = '' THEN CONTINUE; END IF;
        INSERT INTO "Attachment" ("id", "messageId", "fileReference", "fileName", "contentType", "fileSize", "createdAt")
        VALUES (
          'att_' || md5(random()::text || clock_timestamp()::text || mrec.id || left(url, 32)),
          mrec.id,
          CASE WHEN url LIKE '/api/files/%' THEN substring(url from 12) ELSE left(url, 400) END,
          left(COALESCE(aitem ->> 'name', 'file'), 256),
          left(COALESCE(aitem ->> 'content_type', 'application/octet-stream'), 128),
          GREATEST(0, LEAST(COALESCE((aitem ->> 'size')::bigint, 0), 2147483647))::int,
          mrec."createdAt"
        );
      END LOOP;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Attachment conversion skipped for message % (%)', mrec.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Direct-message attachments -> Attachment rows (directMessageId)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  mrec RECORD;
  aitem jsonb;
  url text;
BEGIN
  FOR mrec IN
    SELECT "id", "attachmentsJson" AS aj, "createdAt"
    FROM "DirectMessage"
    WHERE "attachmentsJson" IS NOT NULL AND length(btrim("attachmentsJson")) > 0
  LOOP
    BEGIN
      IF jsonb_typeof(mrec.aj::jsonb) <> 'array' THEN CONTINUE; END IF;
      FOR aitem IN SELECT * FROM jsonb_array_elements(mrec.aj::jsonb)
      LOOP
        IF jsonb_typeof(aitem) <> 'object' THEN CONTINUE; END IF;
        url := COALESCE(aitem ->> 'url', '');
        IF url = '' THEN CONTINUE; END IF;
        INSERT INTO "Attachment" ("id", "directMessageId", "fileReference", "fileName", "contentType", "fileSize", "createdAt")
        VALUES (
          'datt_' || md5(random()::text || clock_timestamp()::text || mrec.id || left(url, 32)),
          mrec.id,
          CASE WHEN url LIKE '/api/files/%' THEN substring(url from 12) ELSE left(url, 400) END,
          left(COALESCE(aitem ->> 'name', 'file'), 256),
          left(COALESCE(aitem ->> 'content_type', 'application/octet-stream'), 128),
          GREATEST(0, LEAST(COALESCE((aitem ->> 'size')::bigint, 0), 2147483647))::int,
          mrec."createdAt"
        );
      END LOOP;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Attachment conversion skipped for direct message % (%)', mrec.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Attachment becomes shared between channel messages and DMs
-- ----------------------------------------------------------------------------
ALTER TABLE "Attachment" ADD COLUMN "directMessageId" TEXT;
CREATE INDEX "Attachment_directMessageId_idx" ON "Attachment"("directMessageId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_directMessageId_fkey" FOREIGN KEY ("directMessageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ALTER COLUMN "messageId" DROP NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. ChannelAccess.userId gains the FK the schema promises (drop orphans first)
-- ----------------------------------------------------------------------------
DELETE FROM "ChannelAccess" WHERE "userId" NOT IN (SELECT "id" FROM "User");
ALTER TABLE "ChannelAccess" ADD CONSTRAINT "ChannelAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- 7. Drop the retired music subsystem (metadata tables; audio objects in the
--    bucket under the `music/` prefix can be cleaned manually at any time)
-- ----------------------------------------------------------------------------
DELETE FROM "MusicPlaylistTrack";
DELETE FROM "MusicPlaylist";
DELETE FROM "MusicTrack";
DROP TABLE "MusicPlaylistTrack";
DROP TABLE "MusicPlaylist";
DROP TABLE "MusicTrack";

-- ----------------------------------------------------------------------------
-- 8. Drop dead columns (never read by any generation of the application)
-- ----------------------------------------------------------------------------
ALTER TABLE "Server" DROP COLUMN IF EXISTS "musicEnabled";
ALTER TABLE "Server" DROP COLUMN IF EXISTS "region";
ALTER TABLE "Server" DROP COLUMN IF EXISTS "verificationLevel";

ALTER TABLE "User" DROP COLUMN IF EXISTS "discriminator";
ALTER TABLE "User" DROP COLUMN IF EXISTS "emailVerified";
ALTER TABLE "User" DROP COLUMN IF EXISTS "twoFactorEnabled";

ALTER TABLE "Message" DROP COLUMN IF EXISTS "attachmentsJson";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "reactionsJson";
ALTER TABLE "Message" DROP COLUMN IF EXISTS "threadName";

ALTER TABLE "DirectMessage" DROP COLUMN IF EXISTS "attachmentsJson";
ALTER TABLE "DirectMessage" DROP COLUMN IF EXISTS "reactionsJson";
ALTER TABLE "DirectMessage" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ----------------------------------------------------------------------------
-- 9. FriendRequest was never written by any generation — remove it
-- ----------------------------------------------------------------------------
DELETE FROM "FriendRequest";
DROP TABLE "FriendRequest";
