-- CreateTable
CREATE TABLE "DailyQuest" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "questType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "rewardType" TEXT NOT NULL,
    "rewardAmount" INTEGER NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "claimed" BOOLEAN NOT NULL DEFAULT false,
    "questDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyQuest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyQuest_playerId_idx" ON "DailyQuest"("playerId");

-- CreateIndex
CREATE INDEX "DailyQuest_questDate_idx" ON "DailyQuest"("questDate");

-- CreateIndex
CREATE INDEX "DailyQuest_playerId_questDate_idx" ON "DailyQuest"("playerId", "questDate");

-- AddForeignKey
ALTER TABLE "DailyQuest" ADD CONSTRAINT "DailyQuest_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
