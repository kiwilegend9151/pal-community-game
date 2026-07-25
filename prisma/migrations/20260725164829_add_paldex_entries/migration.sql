-- CreateTable
CREATE TABLE "PaldexEntry" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "paldeck" TEXT NOT NULL,
    "rarity" TEXT NOT NULL,
    "hasLucky" BOOLEAN NOT NULL DEFAULT false,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaldexEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaldexEntry_playerId_idx" ON "PaldexEntry"("playerId");

-- CreateIndex
CREATE INDEX "PaldexEntry_paldeck_idx" ON "PaldexEntry"("paldeck");

-- CreateIndex
CREATE UNIQUE INDEX "PaldexEntry_playerId_species_key" ON "PaldexEntry"("playerId", "species");

-- CreateIndex
CREATE INDEX "Monster_ownerId_idx" ON "Monster"("ownerId");

-- CreateIndex
CREATE INDEX "Monster_streamerId_idx" ON "Monster"("streamerId");

-- CreateIndex
CREATE INDEX "Monster_species_idx" ON "Monster"("species");

-- AddForeignKey
ALTER TABLE "PaldexEntry" ADD CONSTRAINT "PaldexEntry_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
