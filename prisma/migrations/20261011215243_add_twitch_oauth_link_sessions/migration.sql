-- CreateTable
CREATE TABLE "TwitchLinkSession" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwitchLinkSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TwitchLinkSession_state_key" ON "TwitchLinkSession"("state");

-- CreateIndex
CREATE INDEX "TwitchLinkSession_expiresAt_idx" ON "TwitchLinkSession"("expiresAt");

-- CreateIndex
CREATE INDEX "TwitchLinkSession_discordId_idx" ON "TwitchLinkSession"("discordId");
