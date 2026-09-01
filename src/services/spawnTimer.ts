import { prisma } from "../database";
import {
    connectStreamer,
    spawnMonsterForStreamer
} from "../twitch";

const SPAWN_INTERVAL_MINUTES = 20;

// Keeps track of the scheduled slot we have already processed
let lastProcessedSlot: string | null = null;

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

function getCurrentSlot(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");

    const minute =
        Math.floor(date.getMinutes() / SPAWN_INTERVAL_MINUTES) *
        SPAWN_INTERVAL_MINUTES;

    return `${year}-${month}-${day} ${hour}:${String(minute).padStart(2, "0")}`;
}

function getNextSpawnTime(date = new Date()) {
    const next = new Date(date);

    next.setSeconds(0);
    next.setMilliseconds(0);

    const minutesPastHour = next.getMinutes();
    const nextMinute =
        Math.ceil((minutesPastHour + 1) / SPAWN_INTERVAL_MINUTES) *
        SPAWN_INTERVAL_MINUTES;

    if (nextMinute >= 60) {
        next.setHours(next.getHours() + 1);
        next.setMinutes(0);
    } else {
        next.setMinutes(nextMinute);
    }

    return next;
}

async function runSpawnCycle(slot: string) {
    if (lastProcessedSlot === slot) {
        return;
    }

    lastProcessedSlot = slot;

    console.log(`Running scheduled spawn cycle for ${slot}...`);

    try {
        const streamers = await prisma.streamer.findMany({
            where: { live: true }
        });

        console.log(
            `Found ${streamers.length} live streamer(s) for scheduled spawn`
        );

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
    console.log("Starting clock-aligned streamer spawn scheduler...");

    try {
        const streamers = await connectSavedStreamers();
        console.log(`Connected ${streamers.length} saved streamer(s)`);
    } catch (error) {
        console.error("Failed to reconnect saved streamers:", error);
    }

    const checkSchedule = async () => {
        const now = new Date();

        const currentMinute = now.getMinutes();
        const currentSecond = now.getSeconds();

        const isSpawnMinute =
            currentMinute % SPAWN_INTERVAL_MINUTES === 0;

        // Only process the scheduled slot during its first few seconds.
        if (isSpawnMinute && currentSecond < 15) {
            const slot = getCurrentSlot(now);

            await runSpawnCycle(slot);
        }

        const nextSpawn = getNextSpawnTime(now);

        console.log(
            `Next scheduled spawn check: ${nextSpawn.toLocaleTimeString()}`
        );

        // Check again in 10 seconds.
        setTimeout(() => {
            void checkSchedule();
        }, 10_000);
    };

    void checkSchedule();
}