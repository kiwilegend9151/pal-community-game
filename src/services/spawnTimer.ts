import { PrismaClient } from "@prisma/client";
import { spawnMonsterForStreamer } from "../twitch";

const prisma = new PrismaClient();

const SPAWN_INTERVAL = 20 * 60 * 1000; // 20 minutes

export function startSpawnTimer() {
    console.log("Streamer spawn timer started");

    setInterval(async () => {
        try {
            const streamers = await prisma.streamer.findMany({
                where: {
                    live: true
                }
            });

            for (const streamer of streamers) {
                await spawnMonsterForStreamer(
                    streamer.channelName
                );
            }
        } catch (error) {
            console.error(
                "Spawn timer error:",
                error
            );
        }
    }, SPAWN_INTERVAL);
}