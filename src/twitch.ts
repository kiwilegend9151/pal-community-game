import tmi from "tmi.js";
import { prisma } from "./database";

type MonsterTemplate = {
    species: string;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    rarity: string;
};

type ActiveMonster = {
    id: string;
    species: string;
};

const monsterTemplates: MonsterTemplate[] = [
    { species: "Flame Fox", hp: 45, attack: 15, defense: 10, speed: 12, rarity: "Common" },
    { species: "Aqua Turtle", hp: 60, attack: 12, defense: 18, speed: 7, rarity: "Rare" },
    { species: "Volt Mouse", hp: 35, attack: 20, defense: 8, speed: 20, rarity: "Epic" }
];

const connectedChannels = new Map<string, tmi.Client>();
const activeMonsters = new Map<string, ActiveMonster>();
const catchAttempts = new Map<string, Set<string>>();
const catchLocks = new Set<string>();
const despawnTimers = new Map<string, NodeJS.Timeout>();

const DESPAWN_TIME = 60 * 1000;
const CATCH_CHANCE = 0.5;
const XP_REWARD = 50;
const COIN_REWARD = 10;

function normalizeChannel(channelName: string): string {
    return channelName.replace(/^#/, "").trim().toLowerCase();
}

function getRandomMonster(): MonsterTemplate {
    return monsterTemplates[Math.floor(Math.random() * monsterTemplates.length)];
}

async function awardPlayer(
    playerId: string,
    currentXp: number,
    currentLevel: number,
    currentCoins: number
) {
    let xp = currentXp + XP_REWARD;
    let level = currentLevel;

    while (xp >= level * 100) {
        xp -= level * 100;
        level++;
    }

    return prisma.player.update({
        where: { id: playerId },
        data: {
            xp,
            level,
            coins: currentCoins + COIN_REWARD
        }
    });
}

export async function connectStreamer(channelName: string) {
    const normalizedChannel = normalizeChannel(channelName);

    if (!normalizedChannel) {
        throw new Error("Channel name cannot be empty");
    }

    const existingClient = connectedChannels.get(normalizedChannel);

    if (existingClient) {
        console.log(`${normalizedChannel} already connected`);
        return existingClient;
    }

    const botUsername = process.env.TWITCH_BOT_USERNAME;
    const accessToken = process.env.TWITCH_ACCESS_TOKEN;

    if (!botUsername || !accessToken) {
        throw new Error("TWITCH_BOT_USERNAME or TWITCH_ACCESS_TOKEN is missing");
    }

    const client = new tmi.Client({
        options: { debug: true },
        identity: {
            username: botUsername,
            password: accessToken
        },
        channels: [normalizedChannel]
    });

    client.on("message", async (channel, tags, message, self) => {
        if (self || message.trim().toLowerCase() !== "!catch") {
            return;
        }

        const currentChannel = normalizeChannel(channel);
        const monster = activeMonsters.get(currentChannel);

        if (!monster) {
            await client.say(currentChannel, "❌ There is no monster to catch right now!");
            return;
        }

        const viewerTwitchId = tags["user-id"];
        const viewerName = tags["display-name"] ?? tags.username ?? "A viewer";

        if (!viewerTwitchId) {
            await client.say(
                currentChannel,
                `❌ ${viewerName}, I couldn't find your Twitch user ID.`
            );
            return;
        }

        const viewerLock = `${currentChannel}:${viewerTwitchId}`;

        if (catchLocks.has(viewerLock)) {
            return;
        }

        let attemptedViewers = catchAttempts.get(currentChannel);

        if (!attemptedViewers) {
            attemptedViewers = new Set<string>();
            catchAttempts.set(currentChannel, attemptedViewers);
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
            const catchRoll = Math.random();

            console.log(
                `${viewerName} catch roll: ${catchRoll.toFixed(2)} / ${CATCH_CHANCE}`
            );

            if (catchRoll >= CATCH_CHANCE) {
                await client.say(
                    currentChannel,
                    `💨 ${viewerName} tried to catch ${monster.species}, but failed!`
                );
                return;
            }

            const player = await prisma.player.upsert({
                where: { twitchId: viewerTwitchId },
                update: { username: viewerName },
                create: {
                    twitchId: viewerTwitchId,
                    username: viewerName
                }
            });

            const wildMonster = await prisma.monster.findUnique({
                where: { id: monster.id }
            });

            if (!wildMonster || wildMonster.ownerId) {
                activeMonsters.delete(currentChannel);
                catchAttempts.delete(currentChannel);

                await client.say(
                    currentChannel,
                    "❌ That monster is no longer available!"
                );
                return;
            }

            const caughtMonster = await prisma.monster.create({
                data: {
                    species: wildMonster.species,
                    level: wildMonster.level,
                    hp: wildMonster.hp,
                    attack: wildMonster.attack,
                    defense: wildMonster.defense,
                    speed: wildMonster.speed,
                    rarity: wildMonster.rarity,
                    shiny: wildMonster.shiny,
                    ownerId: player.id,
                    streamerId: wildMonster.streamerId
                }
            });

            const updatedPlayer = await awardPlayer(
                player.id,
                player.xp,
                player.level,
                player.coins
            );

            const levelMessage =
                updatedPlayer.level > player.level
                    ? ` You reached level ${updatedPlayer.level}!`
                    : "";

            await client.say(
                currentChannel,
                `🎉 ${viewerName} caught ${monster.species}! ` +
                `+${XP_REWARD} XP and +${COIN_REWARD} coins.${levelMessage}`
            );

            console.log(
                `${viewerName} caught ${monster.species} (${caughtMonster.id}) ` +
                `in ${currentChannel}`
            );
        } catch (error) {
            console.error("Catch failed:", error);
            attemptedViewers.delete(viewerTwitchId);

            await client.say(
                currentChannel,
                `❌ Sorry ${viewerName}, the catch could not be saved. Try again.`
            );
        } finally {
            catchLocks.delete(viewerLock);
        }
    });

    client.on("disconnected", (reason) => {
        connectedChannels.delete(normalizedChannel);
        console.warn(`Disconnected from ${normalizedChannel}: ${reason}`);
    });

    await client.connect();
    connectedChannels.set(normalizedChannel, client);

    console.log(`Joined Twitch channel: ${normalizedChannel}`);

    return client;
}

export async function spawnMonsterForStreamer(channelName: string) {
    const normalizedChannel = normalizeChannel(channelName);

    try {
        const streamer = await prisma.streamer.findUnique({
            where: { channelName: normalizedChannel }
        });

        if (!streamer) {
            throw new Error(`Streamer record not found for ${normalizedChannel}`);
        }

        if (!connectedChannels.has(normalizedChannel)) {
            await connectStreamer(normalizedChannel);
        }

        const previousTimer = despawnTimers.get(normalizedChannel);

        if (previousTimer) {
            clearTimeout(previousTimer);
            despawnTimers.delete(normalizedChannel);
        }

        const previousMonster = activeMonsters.get(normalizedChannel);

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

        const template = getRandomMonster();

        const monster = await prisma.monster.create({
            data: {
                ...template,
                level: 1,
                shiny: Math.random() < 0.05,
                streamerId: streamer.id
            }
        });

        activeMonsters.set(normalizedChannel, {
            id: monster.id,
            species: monster.species
        });

        catchAttempts.set(normalizedChannel, new Set<string>());

        const client = connectedChannels.get(normalizedChannel);

        if (client) {
            const shinyText = monster.shiny ? " ✨SHINY✨" : "";

            await client.say(
                normalizedChannel,
                `🐾 A wild${shinyText} ${monster.species} appeared! ` +
                `Everyone has 60 seconds to type !catch!`
            );
        }

        const despawnTimer = setTimeout(async () => {
            try {
                const currentMonster = activeMonsters.get(normalizedChannel);

                if (!currentMonster || currentMonster.id !== monster.id) {
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

                const currentClient = connectedChannels.get(normalizedChannel);

                if (currentClient) {
                    await currentClient.say(
                        normalizedChannel,
                        `💨 The wild ${monster.species} ran away!`
                    );
                }

                console.log(
                    `${monster.species} despawned from ${normalizedChannel}`
                );
            } catch (error) {
                console.error("Despawn failed:", error);
            }
        }, DESPAWN_TIME);

        despawnTimers.set(normalizedChannel, despawnTimer);

        console.log(
            `Spawned ${monster.species} (${monster.id}) for ${normalizedChannel}`
        );

        return monster;
    } catch (error) {
        console.error(`Spawn failed for ${normalizedChannel}:`, error);
        throw error;
    }
}
