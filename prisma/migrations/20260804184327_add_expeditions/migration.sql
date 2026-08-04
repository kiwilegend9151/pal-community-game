-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "paldium" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "stone" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "wood" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Expedition" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "monsterId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completesAt" TIMESTAMP(3) NOT NULL,
    "coinReward" INTEGER NOT NULL,
    "palSphereReward" INTEGER NOT NULL,
    "paldiumReward" INTEGER NOT NULL,
    "woodReward" INTEGER NOT NULL,
    "stoneReward" INTEGER NOT NULL,

    CONSTRAINT "Expedition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expedition_playerId_key" ON "Expedition"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "Expedition_monsterId_key" ON "Expedition"("monsterId");

-- CreateIndex
CREATE INDEX "Expedition_completesAt_idx" ON "Expedition"("completesAt");

-- AddForeignKey
ALTER TABLE "Expedition" ADD CONSTRAINT "Expedition_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expedition" ADD CONSTRAINT "Expedition_monsterId_fkey" FOREIGN KEY ("monsterId") REFERENCES "Monster"("id") ON DELETE CASCADE ON UPDATE CASCADE;
