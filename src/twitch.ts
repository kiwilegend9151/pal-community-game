import tmi from "tmi.js";
import axios from "axios";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type ActiveMonster = {
    id: string;
    species: string;
};

const connectedChannels = new Map<string, tmi.Client>();
const activeMonsters = new Map<string, ActiveMonster>();

// Tracks viewers who have attempted the current monster
const catchAttempts = new Map<string, Set<string>>();

// Stops the same viewer sending simultaneous catch requests
const catchLocks = new Set<string>();

// Stores each channel's despawn timer
const despawnTimers = new Map<string, NodeJS.Timeout>();

const DESPAWN_TIME = 60 * 1000; // 60 seconds

function getCatchChance(): number {
    return 0.5;
}

export async function connectStreamer(channelName: string) {
    const normalizedChannel = channelName.toLowerCase();

    if (connectedChannels.has(normalizedChannel)) {
        console.log(`${normalizedChannel} already connected`);

        return connectedChannels.get(normalizedChannel);
    }

    const client = new tmi.Client({
        options: {
            debug: true
        },

        identity: {
            username: process.env.TWITCH_BOT_USERNAME!,
            password: process.env.TWITCH_ACCESS_TOKEN!
        },

        channels: [
            normalizedChannel
        ]
    });

    client.on("message", async (channel, tags, message, self) => {
        if (self) {
            return;
        }

        if (message.trim().toLowerCase() !== "!catch") {
            return;
        }

        const currentChannel = channel
            .replace("#", "")
            .toLowerCase();

        const monster = activeMonsters.get(currentChannel);

        if (!monster) {
            await client.say(
                currentChannel,
                "❌ There is no monster to catch right now!"
            );

            return;
        }

        const viewerTwitchId = tags["user-id"];

        const viewerName =
            tags["display-name"] ??
            tags.username ??
            "A viewer";

        if (!viewerTwitchId) {
            await client.say(
                currentChannel,
                `❌ ${viewerName}, I couldn't find your Twitch user ID.`
            );

            return;
        }

        const viewerLock =
            `${currentChannel}:${viewerTwitchId}`;

        if (catchLocks.has(viewerLock)) {
            return;
        }

        let attemptedViewers =
            catchAttempts.get(currentChannel);

        if (!attemptedViewers) {
            attemptedViewers = new Set<string>();

            catchAttempts.set(
                currentChannel,
                attemptedViewers
            );
        }

        if (attemptedViewers.has(viewerTwitchId)) {
            await client.say(
                currentChannel,
                `❌ ${viewerName}, you have already tried to catch this monster!`
            );

            return;
        }

        catchLocks.add(viewerLock);
        attemptedViewers.add(viewerTwitchId);

        try {
            const catchChance = getCatchChance();
            const catchRoll = Math.random();

            console.log(
                `${viewerName} catch roll: ` +
                `${catchRoll.toFixed(2)} / ${catchChance}`
            );

            if (catchRoll >= catchChance) {
                await client.say(
                    currentChannel,
                    `💨 ${viewerName} tried to catch ` +
                    `${monster.species}, but failed!`
                );

                return;
            }

            const player = await prisma.player.upsert({
                where: {
                    twitchId: viewerTwitchId
                },

                update: {
                    username: viewerName
                },

                create: {
                    twitchId: viewerTwitchId,
                    username: viewerName
                }
            });

            const activeMonster =
                await prisma.monster.findUnique({
                    where: {
                        id: monster.id
                    }
                });

            if (!activeMonster) {
                activeMonsters.delete(currentChannel);
                catchAttempts.delete(currentChannel);

                await client.say(
                    currentChannel,
                    "❌ That monster is no longer available!"
                );

                return;
            }

            const caughtMonster =
                await prisma.monster.create({
                    data: {
                        species: activeMonster.species,
                        level: activeMonster.level,
                        hp: activeMonster.hp,
                        attack: activeMonster.attack,
                        defense: activeMonster.defense,
                        speed: activeMonster.speed,
                        rarity: activeMonster.rarity,
                        shiny: activeMonster.shiny,
                        ownerId: player.id,
                        streamerId: activeMonster.streamerId
                    }
                });

            await client.say(
                currentChannel,
                `🎉 ${viewerName} caught the wild ` +
                `${monster.species}!`
            );

            console.log(
                `${viewerName} caught ${monster.species} ` +
                `(${caughtMonster.id}) in ${currentChannel}`
            );
        } catch (error) {
            console.error(
                "Catch failed:",
                error
            );

            // Allow another attempt when a database error occurs
            attemptedViewers.delete(viewerTwitchId);

            await client.say(
                currentChannel,
                `❌ Sorry ${viewerName}, the catch could not ` +
                `be saved. Try again.`
            );
        } finally {
            catchLocks.delete(viewerLock);
        }
    });

    await client.connect();

    connectedChannels.set(
        normalizedChannel,
        client
    );

    console.log(
        `Joined Twitch channel: ${normalizedChannel}`
    );

    return client;
}

export async function spawnMonsterForStreamer(
    channelName: string
) {
    try {
        const normalizedChannel =
            channelName.toLowerCase();

        const previousTimer =
            despawnTimers.get(normalizedChannel);

        if (previousTimer) {
            clearTimeout(previousTimer);
            despawnTimers.delete(normalizedChannel);
        }

        const previousMonster =
            activeMonsters.get(normalizedChannel);

        if (previousMonster) {
            await prisma.monster.deleteMany({
                where: {
                    id: previousMonster.id,
                    ownerId: null
                }
            });
        }

        activeMonsters.delete(normalizedChannel);
        catchAttempts.delete(normalizedChannel);

        const response = await axios.post<ActiveMonster>(
            "http://localhost:3000/monsters/spawn"
        );

        const monster = response.data;

        console.log(
            "Spawned:",
            monster.species,
            monster.id
        );

        activeMonsters.set(
            normalizedChannel,
            monster
        );

        catchAttempts.set(
            normalizedChannel,
            new Set<string>()
        );

        const client =
            connectedChannels.get(normalizedChannel);

        if (client) {
            await client.say(
                normalizedChannel,
                `🐾 A wild ${monster.species} appeared! ` +
                `Everyone has 60 seconds to type !catch!`
            );
        }

        const despawnTimer = setTimeout(async () => {
            try {
                const currentMonster =
                    activeMonsters.get(normalizedChannel);

                // Prevent an old timer removing a newer monster
                if (
                    !currentMonster ||
                    currentMonster.id !== monster.id
                ) {
                    return;
                }

                activeMonsters.delete(normalizedChannel);
                catchAttempts.delete(normalizedChannel);
                despawnTimers.delete(normalizedChannel);

                await prisma.monster.deleteMany({
                    where: {
                        id: monster.id,
                        ownerId: null
                    }
                });

                const currentClient =
                    connectedChannels.get(normalizedChannel);

                if (currentClient) {
                    await currentClient.say(
                        normalizedChannel,
                        `💨 The wild ${monster.species} ran away!`
                    );
                }

                console.log(
                    `${monster.species} despawned from ` +
                    `${normalizedChannel}`
                );
            } catch (error) {
                console.error(
                    "Despawn failed:",
                    error
                );
            }
        }, DESPAWN_TIME);

        despawnTimers.set(
            normalizedChannel,
            despawnTimer
        );

        return monster;
    } catch (error) {
        console.error(
            "Spawn failed:",
            error
        );

        throw error;
    }
}