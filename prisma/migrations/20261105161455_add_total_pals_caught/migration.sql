-- Add permanent Pal catch counter
ALTER TABLE "Player"
ADD COLUMN "totalPalsCaught" INTEGER NOT NULL DEFAULT 0;

-- Give existing players credit for their currently owned Pals
UPDATE "Player" AS p
SET "totalPalsCaught" = (
    SELECT COUNT(*)::INTEGER
    FROM "Monster" AS m
    WHERE m."ownerId" = p.id
);