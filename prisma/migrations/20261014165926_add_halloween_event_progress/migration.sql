-- CreateTable
CREATE TABLE "HalloweenEventProgress" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "eventYear" INTEGER NOT NULL,
    "catches" INTEGER NOT NULL DEFAULT 0,
    "rewardClaimed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HalloweenEventProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HalloweenEventProgress_eventYear_idx" ON "HalloweenEventProgress"("eventYear");

-- CreateIndex
CREATE UNIQUE INDEX "HalloweenEventProgress_playerId_eventYear_key" ON "HalloweenEventProgress"("playerId", "eventYear");
