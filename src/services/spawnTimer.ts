import { prisma } from "../database";
import {
    connectStreamer,
    spawnMonsterForStreamer
} from "../twitch";

const SPAWN_INTERVAL = 20 * 60 * 1000;

let timerStarted = false;

async function connectSavedStreamers() {
    const streamers = await prisma.streamer.findMany({
        where: { live: true }
    });

    for (const streamer of streamers) {
        try {
            await connectStreamer(streamer.channelName);
        } catch (error) {
            console.error(
                `Could not connect to ${streamer.channelName}:`,
                error
            );
        }
    }

    return streamers;
}

async function runSpawnCycle() {
    try {
        const streamers = await prisma.streamer.findMany({
            where: { live: true }
        });

        for (const streamer of streamers) {
            try {
                await spawnMonsterForStreamer(streamer.channelName);
            } catch (error) {
                console.error(
                    `Spawn cycle failed for ${streamer.channelName}:`,
                    error
                );
            }
        }
    } catch (error) {
        console.error("Spawn timer error:", error);
    }
}

export async function startSpawnTimer() {
    if (timerStarted) {
        console.log("Streamer spawn timer already started");
        return;
    }

    timerStarted = true;
    console.log("Streamer spawn timer started");

    try {
        const streamers = await connectSavedStreamers();
        console.log(`Connected ${streamers.length} saved streamer(s)`);
    } catch (error) {
        console.error("Failed to reconnect saved streamers:", error);
    }

    setInterval(() => {
        void runSpawnCycle();
    }, SPAWN_INTERVAL);
}
