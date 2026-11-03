/*
  Warnings:

  - A unique constraint covering the columns `[partnerPalId]` on the table `Player` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "partnerPalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Player_partnerPalId_key" ON "Player"("partnerPalId");

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_partnerPalId_fkey" FOREIGN KEY ("partnerPalId") REFERENCES "Monster"("id") ON DELETE SET NULL ON UPDATE CASCADE;
