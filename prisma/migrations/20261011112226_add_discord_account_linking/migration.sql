/*
  Warnings:

  - A unique constraint covering the columns `[discordId]` on the table `Player` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "discordId" TEXT;

-- CreateTable
CREATE TABLE "DiscordLinkCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordLinkCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DiscordLinkCode_code_key" ON "DiscordLinkCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Player_discordId_key" ON "Player"("discordId");
