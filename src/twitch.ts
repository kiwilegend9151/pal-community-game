import tmi from "tmi.js";
import { prisma } from "./database";
import { monsterTemplates } from "./monsters";

type MonsterTemplate = {
    species: string;
    hp: number;
    attack: number;
    defense: number;
    speed: number;
    paldeck: string;
    type1: string;
    type2: string;
    rarity: string;
};

type ActiveMonster = {
    id: string;
    species: string;
};

const connectedChannels = new Map<string, tmi.Client>();
const activeMonsters = new Map<string, ActiveMonster>();
const catchAttempts = new Map<string, Set<string>>();
const successfulCatchers = new Map<string, string[]>();
const catchLocks = new Set<string>();
const despawnTimers = new Map<string, NodeJS.Timeout>();
const DAILY_REWARD = 100;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
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
        if (self) {
            return;
        }

        const command = message.trim().toLowerCase();
        const currentChannel = normalizeChannel(channel);

        const viewerTwitchId = tags["user-id"];
        const viewerName =
            tags["display-name"] ??
            tags.username ??
            "A viewer";

        if (!viewerTwitchId) {
            return;
        }

        if (command === "!profile") {
            try {
                const player = await prisma.player.findUnique({
                    where: {
                        twitchId: viewerTwitchId
                    },
                    include: {
                        monsters: true
                    }
                });

                if (!player) {
                    await client.say(
                        currentChannel,
                        `👤 ${viewerName}, you do not have a profile yet. Catch a pal first!`
                    );
                    return;
                }

                const xpNeeded = player.level * 100;

                await client.say(
                    currentChannel,
                    `👤 ${player.username} | ` +
                    `Level ${player.level} | ` +
                    `XP: ${player.xp}/${xpNeeded} | ` +
                    `Coins: ${player.coins} | ` +
                    `Monsters: ${player.monsters.length}`
                );
            } catch (error) {
                console.error("Profile command failed:", error);

                await client.say(
                    currentChannel,
                    `❌ Sorry ${viewerName}, your profile could not be loaded.`
                );
            }

            return;
        }

        if (command === "!collection") {
            try {
                const player = await prisma.player.findUnique({
                    where: {
                        twitchId: viewerTwitchId
                    },
                    include: {
                        monsters: {
                            orderBy: {
                                species: "asc"
                            }
                        }
                    }
                });

                if (!player || player.monsters.length === 0) {
                    await client.say(
                        currentChannel,
                        `📭 ${viewerName}, your collection is empty. Go catch some pals!`
                    );
                    return;
                }

                const groupedMonsters = new Map<
                    string,
                    { count: number; hasShiny: boolean }
                >();

                for (const monster of player.monsters) {
                    const existing = groupedMonsters.get(monster.species);

                    if (existing) {
                        existing.count++;
                        existing.hasShiny =
                            existing.hasShiny || monster.shiny;
                    } else {
                        groupedMonsters.set(monster.species, {
                            count: 1,
                            hasShiny: monster.shiny
                        });
                    }
                }

                const collectionText = Array.from(
                    groupedMonsters.entries()
                )
                    .map(([species, details]) => {
                        const shinyIcon = details.hasShiny ? "✨ " : "";
                        return `${shinyIcon}${species} ×${details.count}`;
                    })
                    .join(", ");

                await client.say(
                    currentChannel,
                    `🎒 ${player.username}'s Collection ` +
                    `(${player.monsters.length}): ${collectionText}`
                );
            } catch (error) {
                console.error("Collection command failed:", error);

                await client.say(
                    currentChannel,
                    `❌ Sorry ${viewerName}, your collection could not be loaded.`
                );
            }

            return;
        }

if (command === "!dex" || command === "!paldex") {
    try {
        const player = await prisma.player.findUnique({
            where: {
                twitchId: viewerTwitchId
            },
            select: {
                username: true,
                monsters: {
                    select: {
                        species: true,
                        shiny: true
                    }
                }
            }
        });

        const totalSpecies = new Set(
            monsterTemplates.map((template) =>
                template.species.trim().toLowerCase()
            )
        ).size;

        if (!player || player.monsters.length === 0) {
            await client.say(
                currentChannel,
                `📖 ${viewerName}'s Paldeck: 0/${totalSpecies} discovered (0%). ` +
                `✨ Shiny species: 0. Catch a pal with !catch to get started!`
            );

            return;
        }

        const discoveredSpecies = new Set(
            player.monsters.map((monster) =>
                monster.species.trim().toLowerCase()
            )
        );

        const shinySpecies = new Set(
            player.monsters
                .filter((monster) => monster.shiny)
                .map((monster) =>
                    monster.species.trim().toLowerCase()
                )
        );

        const completionPercentage =
            totalSpecies === 0
                ? 0
                : Math.floor(
                    (discoveredSpecies.size / totalSpecies) * 100
                );

        await client.say(
            currentChannel,
            `📖 ${player.username}'s Paldeck: ` +
            `${discoveredSpecies.size}/${totalSpecies} discovered ` +
            `(${completionPercentage}%). ` +
            `✨ Shiny species: ${shinySpecies.size}. ` +
            `Total pals owned: ${player.monsters.length}.`
        );
    } catch (error) {
        console.error("Dex command failed:", error);

        await client.say(
            currentChannel,
            `❌ Sorry ${viewerName}, your Paldeck could not be loaded.`
        );
    }

    return;
}


        if (command === "!daily") {
            try {
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
        
                const now = new Date();
                const cooldownCutoff = new Date(
                    now.getTime() - DAILY_COOLDOWN
                );
        
                /*
                 * updateMany prevents two messages sent at almost the same time
                 * from claiming the reward twice.
                 */
                const claimResult = await prisma.player.updateMany({
                    where: {
                        id: player.id,
                        OR: [
                            {
                                lastDailyAt: null
                            },
                            {
                                lastDailyAt: {
                                    lte: cooldownCutoff
                                }
                            }
                        ]
                    },
                    data: {
                        coins: {
                            increment: DAILY_REWARD
                        },
                        lastDailyAt: now
                    }
                });
        
                if (claimResult.count === 0) {
                    const updatedPlayer = await prisma.player.findUnique({
                        where: {
                            id: player.id
                        }
                    });
        
                    if (!updatedPlayer?.lastDailyAt) {
                        await client.say(
                            currentChannel,
                            `❌ ${viewerName}, your daily reward could not be checked.`
                        );
        
                        return;
                    }
        
                    const nextClaimTime =
                        updatedPlayer.lastDailyAt.getTime() +
                        DAILY_COOLDOWN;
        
                    const remainingMilliseconds = Math.max(
                        0,
                        nextClaimTime - Date.now()
                    );
        
                    const remainingHours = Math.floor(
                        remainingMilliseconds / (60 * 60 * 1000)
                    );
        
                    const remainingMinutes = Math.ceil(
                        (remainingMilliseconds % (60 * 60 * 1000)) /
                        (60 * 1000)
                    );
        
                    await client.say(
                        currentChannel,
                        `⏳ ${viewerName}, you have already claimed your daily reward. ` +
                        `Try again in ${remainingHours}h ${remainingMinutes}m.`
                    );
        
                    return;
                }
        
                const rewardedPlayer = await prisma.player.findUnique({
                    where: {
                        id: player.id
                    }
                });
        
                await client.say(
                    currentChannel,
                    `🎁 ${viewerName} claimed their daily reward! ` +
                    `+${DAILY_REWARD} coins. ` +
                    `Balance: ${rewardedPlayer?.coins ?? player.coins + DAILY_REWARD} coins.`
                );
            } catch (error) {
                console.error("Daily command failed:", error);
        
                await client.say(
                    currentChannel,
                    `❌ Sorry ${viewerName}, your daily reward could not be claimed.`
                );
            }
        
            return;
        }

        if (command !== "!catch") {
            return;
        }

        const monster = activeMonsters.get(currentChannel);

        if (!monster) {
            await client.say(
                currentChannel,
                "❌ There is no pal to catch right now!"
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
                `❌ ${viewerName}, you have already tried to catch this pal!`
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
                    "❌ That pal is no longer available!"
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

            const catchers = successfulCatchers.get(currentChannel) ?? [];
            catchers.push(viewerName);
            successfulCatchers.set(currentChannel, catchers);

            const levelMessage =
                updatedPlayer.level > player.level
                    ? ` and reached level ${updatedPlayer.level}`
                    : "";

            console.log(
                `${viewerName} caught ${monster.species} (${caughtMonster.id}) ` +
                `in ${currentChannel}${levelMessage}`
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
        successfulCatchers.delete(normalizedChannel);

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
        successfulCatchers.set(normalizedChannel, []);

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

                const attempts = catchAttempts.get(normalizedChannel)?.size ?? 0;
                const catchers = successfulCatchers.get(normalizedChannel) ?? [];

                activeMonsters.delete(normalizedChannel);
                catchAttempts.delete(normalizedChannel);
                successfulCatchers.delete(normalizedChannel);
                despawnTimers.delete(normalizedChannel);

                await prisma.monster.deleteMany({
                    where: {
                        id: monster.id,
                        ownerId: null
                    }
                });

                const currentClient = connectedChannels.get(normalizedChannel);

                if (currentClient) {
                    const shinyText = monster.shiny ? "✨ SHINY " : "";

                    if (catchers.length > 0) {
                        const catcherNames = catchers.join(", ");

                        await currentClient.say(
                            normalizedChannel,
                            `🎉 The wild ${shinyText}${monster.species} fled! ` +
                            `Caught by: ${catcherNames}. ` +
                            `${catchers.length}/${attempts} attempts succeeded. ` +
                            `Each catcher earned +${XP_REWARD} XP and +${COIN_REWARD} coins.`
                        );
                    } else {
                        await currentClient.say(
                            normalizedChannel,
                            `💨 The wild ${shinyText}${monster.species} fled! ` +
                            `Nobody caught it (${attempts} attempt${attempts === 1 ? "" : "s"}).`
                        );
                    }
                }

                console.log(
                    `${monster.species} encounter ended in ${normalizedChannel}: ` +
                    `${catchers.length}/${attempts} successful catches`
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