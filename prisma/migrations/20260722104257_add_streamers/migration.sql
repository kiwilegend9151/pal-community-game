/*
  Warnings:

  - You are about to drop the column `enabled` on the `Streamer` table. All the data in the column will be lost.
  - You are about to drop the column `lastSpawnAt` on the `Streamer` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `Streamer` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[channelName]` on the table `Streamer` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `channelName` to the `Streamer` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Streamer_username_key";

-- AlterTable
ALTER TABLE "Monster" ADD COLUMN     "streamerId" TEXT;

-- AlterTable
ALTER TABLE "Streamer" DROP COLUMN "enabled",
DROP COLUMN "lastSpawnAt",
DROP COLUMN "username",
ADD COLUMN     "channelName" TEXT NOT NULL,
ADD COLUMN     "lastSpawn" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Streamer_channelName_key" ON "Streamer"("channelName");

-- AddForeignKey
ALTER TABLE "Monster" ADD CONSTRAINT "Monster_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
