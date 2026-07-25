import tmi from "tmi.js";import { prisma } from "./database";import { monsterTemplates } from "./monsters";

type MonsterTemplate = {species: string;hp: number;attack: number;defense: number;speed: number;paldeck: string;type1: string;type2: string;rarity: string;};

type ActiveMonster = {id: string;species: string;};

const connectedChannels = new Map<string, tmi.Client>();
const activeMonsters = new Map<string, ActiveMonster>();
const catchAttempts = new Map<string, Set<string>>();
const successfulCatchers = new Map<string, string[]>();
const catchLocks = new Set<string>();
const despawnTimers = new Map<string, NodeJS.Timeout>();

const DAILY_REWARD = 100;
const DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
const DESPAWN_TIME = 60 * 1000;
const XP_REWARD = 50;
const COIN_REWARD = 10;

type SphereType = "pal" | "mega" | "giga" | "hyper";

const SPHERES = {
    pal: {
        displayName: "Pal Sphere",
        catchChance: 0.30,
        price: 10
    },
    mega: {
        displayName: "Mega Sphere",
        catchChance: 0.50,
        price: 20
    },
    giga: {
        displayName: "Giga Sphere",
        catchChance: 0.60,
        price: 30
    },
    hyper: {
        displayName: "Hyper Sphere",
        catchChance: 0.70,
        price: 50
    }
} as const;

function normalizeChannel(channelName: string): string {return channelName.replace(/^#/, "").trim().toLowerCase();}

let twitchAppAccessToken: string | null = null;
let twitchAppAccessTokenExpiresAt = 0;

async function getTwitchAppAccessToken(): Promise<string> {
    const clientId = process.env.TWITCH_CLIENT_ID;
    const clientSecret = process.env.TWITCH_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error("TWITCH_CLIENT_ID or TWITCH_CLIENT_SECRET is missing");
    }

    if (
        twitchAppAccessToken &&
        Date.now() < twitchAppAccessTokenExpiresAt
    ) {
        return twitchAppAccessToken;
    }

    const tokenResponse = await fetch(
        "https://id.twitch.tv/oauth2/token",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: "client_credentials"
            })
        }
    );

    if (!tokenResponse.ok) {
        const responseText = await tokenResponse.text();

        throw new Error(
            `Twitch token request failed (${tokenResponse.status}): ${responseText}`
        );
    }

    const tokenData = await tokenResponse.json() as {
        access_token: string;
        expires_in: number;
    };

    twitchAppAccessToken = tokenData.access_token;
    twitchAppAccessTokenExpiresAt =
        Date.now() + Math.max(0, tokenData.expires_in - 60) * 1000;

    return twitchAppAccessToken;
}

async function isStreamerLive(channelName: string): Promise<boolean> {
    try {
        const clientId = process.env.TWITCH_CLIENT_ID;

        if (!clientId) {
            throw new Error("TWITCH_CLIENT_ID is missing");
        }

        const appAccessToken = await getTwitchAppAccessToken();
        const streamsUrl = new URL("https://api.twitch.tv/helix/streams");

        streamsUrl.searchParams.set("user_login", channelName);

        const streamResponse = await fetch(streamsUrl, {
            headers: {
                "Client-Id": clientId,
                Authorization: `Bearer ${appAccessToken}`
            }
        });

        if (!streamResponse.ok) {
            const responseText = await streamResponse.text();

            throw new Error(
                `Twitch live check failed (${streamResponse.status}): ${responseText}`
            );
        }

        const streamData = await streamResponse.json() as {
            data: Array<{ type: string }>;
        };

        return streamData.data.some((stream) => stream.type === "live");
    } catch (error) {
        console.error(`Could not check whether ${channelName} is live:`, error);

        // Fail closed so an API problem does not create offline encounters.
        return false;
    }
}

async function clearActiveEncounter(channelName: string): Promise<void> {
    const currentTimer = despawnTimers.get(channelName);

    if (currentTimer) {
        clearTimeout(currentTimer);
        despawnTimers.delete(channelName);
    }

    const currentMonster = activeMonsters.get(channelName);

    if (currentMonster) {
        await prisma.monster.deleteMany({
            where: {
                id: currentMonster.id,
                ownerId: null
            }
        });
    }

    activeMonsters.delete(channelName);
    catchAttempts.delete(channelName);
    successfulCatchers.delete(channelName);
}

function getRandomMonster(): MonsterTemplate {return monsterTemplates[Math.floor(Math.random() * monsterTemplates.length)];}

async function awardPlayer(
    playerId: string,
    currentXp: number,
    currentLevel: number
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
            coins: {
                increment: COIN_REWARD
            }
        }
    });
}

async function buySpheres(
    playerId: string,
    sphereType: SphereType,
    quantity: number,
    totalPrice: number
): Promise<boolean> {
    const commonWhere = {
        id: playerId,
        coins: {
            gte: totalPrice
        }
    };

    let result;

    switch (sphereType) {
        case "pal":
            result = await prisma.player.updateMany({
                where: commonWhere,
                data: {
                    coins: { decrement: totalPrice },
                    palSpheres: { increment: quantity }
                }
            });
            break;
        case "mega":
            result = await prisma.player.updateMany({
                where: commonWhere,
                data: {
                    coins: { decrement: totalPrice },
                    megaSpheres: { increment: quantity }
                }
            });
            break;
        case "giga":
            result = await prisma.player.updateMany({
                where: commonWhere,
                data: {
                    coins: { decrement: totalPrice },
                    gigaSpheres: { increment: quantity }
                }
            });
            break;
        case "hyper":
            result = await prisma.player.updateMany({
                where: commonWhere,
                data: {
                    coins: { decrement: totalPrice },
                    hyperSpheres: { increment: quantity }
                }
            });
            break;
    }

    return result.count === 1;
}

async function useSphere(
    playerId: string,
    sphereType: SphereType
): Promise<boolean> {
    let result;

    switch (sphereType) {
        case "pal":
            result = await prisma.player.updateMany({
                where: {
                    id: playerId,
                    palSpheres: { gte: 1 }
                },
                data: {
                    palSpheres: { decrement: 1 }
                }
            });
            break;
        case "mega":
            result = await prisma.player.updateMany({
                where: {
                    id: playerId,
                    megaSpheres: { gte: 1 }
                },
                data: {
                    megaSpheres: { decrement: 1 }
                }
            });
            break;
        case "giga":
            result = await prisma.player.updateMany({
                where: {
                    id: playerId,
                    gigaSpheres: { gte: 1 }
                },
                data: {
                    gigaSpheres: { decrement: 1 }
                }
            });
            break;
        case "hyper":
            result = await prisma.player.updateMany({
                where: {
                    id: playerId,
                    hyperSpheres: { gte: 1 }
                },
                data: {
                    hyperSpheres: { decrement: 1 }
                }
            });
            break;
    }

    return result.count === 1;
}

export async function connectStreamer(channelName: string) {const normalizedChannel = normalizeChannel(channelName);

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

    if (command === "!help" || command === "!help 1") {
        await client.say(
            currentChannel,
            "📖 Pal Community Game Commands | " +
            "!catch | !catch mega | !catch giga | !catch hyper | " +
            "!collection | !profile | !paldex | !daily | " +
            "!shop | !buy | !inventory | Use !help 2 or !help 3 for more."
        );
        return;
    }

    if (command === "!help 2") {
        await client.say(
            currentChannel,
            "📖 Shop & Catching | " +
            "Pal Sphere: 30% - 10 coins | " +
            "Mega Sphere: 50% - 20 coins | " +
            "Giga Sphere: 60% - 30 coins | " +
            "Hyper Sphere: 70% - 50 coins | " +
            "Buy with !buy <pal|mega|giga|hyper> <amount>"
        );
        return;
    }

    if (command === "!help 3") {
        await client.say(
            currentChannel,
            "📖 Tips | Claim !daily every 24 hours | " +
            "Buy spheres with !buy | " +
            "Lucky pals are very rare | " +
            "Complete your Paldeck with !paldex"
        );
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
                `Pals: ${player.monsters.length}`
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
                    const luckyIcon = details.hasShiny ? "✨ " : "";
                    return `${luckyIcon}${species} ×${details.count}`;
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

if (command === "!dex" || command === "!paldex") {try {const player = await prisma.player.findUnique({where: {twitchId: viewerTwitchId},select: {username: true,monsters: {select: {species: true,shiny: true}}}});

    const totalSpecies = new Set(
        monsterTemplates.map((template) =>
            template.species.trim().toLowerCase()
        )
    ).size;

    if (!player || player.monsters.length === 0) {
        await client.say(
            currentChannel,
            `📖 ${viewerName}'s Paldeck: 0/${totalSpecies} discovered (0%). ` +
            `✨ Lucky species: 0. Catch a pal with !catch to get started!`
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
        `✨ Lucky species: ${shinySpecies.size}. ` +
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

    if (command === "!shop") {
        await client.say(
            currentChannel,
            "🛒 Sphere Shop | " +
            "Pal Sphere: 10 coins (30%) | " +
            "Mega Sphere: 20 coins (50%) | " +
            "Giga Sphere: 30 coins (60%) | " +
            "Hyper Sphere: 50 coins (70%). " +
            "Buy with !buy <pal|mega|giga|hyper> <amount>"
        );
        return;
    }

    if (command === "!inventory" || command === "!inv") {
        try {
            const player = await prisma.player.findUnique({
                where: {
                    twitchId: viewerTwitchId
                }
            });

            if (!player) {
                await client.say(
                    currentChannel,
                    `🎒 ${viewerName}, you do not have an inventory yet.`
                );
                return;
            }

            await client.say(
                currentChannel,
                `🎒 ${player.username}'s Inventory | ` +
                `Pal: ${player.palSpheres} | ` +
                `Mega: ${player.megaSpheres} | ` +
                `Giga: ${player.gigaSpheres} | ` +
                `Hyper: ${player.hyperSpheres} | ` +
                `Coins: ${player.coins}`
            );
        } catch (error) {
            console.error("Inventory command failed:", error);

            await client.say(
                currentChannel,
                `❌ Sorry ${viewerName}, your inventory could not be loaded.`
            );
        }

        return;
    }

    if (command.startsWith("!buy")) {
        try {
            const parts = command.split(/\s+/);
            const sphereType = parts[1] as SphereType | undefined;
            const quantity = Number(parts[2] ?? "1");

            if (!sphereType || !(sphereType in SPHERES)) {
                await client.say(
                    currentChannel,
                    `❌ ${viewerName}, use !buy <pal|mega|giga|hyper> <amount>.`
                );
                return;
            }

            if (
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > 100
            ) {
                await client.say(
                    currentChannel,
                    `❌ ${viewerName}, choose an amount from 1 to 100.`
                );
                return;
            }

            const sphere = SPHERES[sphereType];
            const totalPrice = sphere.price * quantity;

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

            const purchased = await buySpheres(
                player.id,
                sphereType,
                quantity,
                totalPrice
            );

            if (!purchased) {
                await client.say(
                    currentChannel,
                    `❌ ${viewerName}, you need ${totalPrice} coins to buy ` +
                    `${quantity} ${sphere.displayName}${quantity === 1 ? "" : "s"}.`
                );
                return;
            }

            const updatedPlayer = await prisma.player.findUnique({
                where: {
                    id: player.id
                }
            });

            await client.say(
                currentChannel,
                `🛒 ${viewerName} bought ${quantity} ` +
                `${sphere.displayName}${quantity === 1 ? "" : "s"} for ` +
                `${totalPrice} coins. Balance: ${updatedPlayer?.coins ?? 0} coins.`
            );
        } catch (error) {
            console.error("Buy command failed:", error);

            await client.say(
                currentChannel,
                `❌ Sorry ${viewerName}, that purchase could not be completed.`
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

    const catchParts = command.split(/\s+/);

    if (catchParts[0] !== "!catch") {
        return;
    }

    let sphereType: SphereType;

    if (catchParts.length === 1) {
        sphereType = "pal";
    } else if (
        catchParts.length === 2 &&
        catchParts[1] in SPHERES
    ) {
        sphereType = catchParts[1] as SphereType;
    } else {
        await client.say(
            currentChannel,
            `❌ ${viewerName}, use !catch, !catch mega, !catch giga, or !catch hyper.`
        );
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

    try {
        const sphere = SPHERES[sphereType];

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

        const sphereUsed = await useSphere(player.id, sphereType);

        if (!sphereUsed) {
            await client.say(
                currentChannel,
                `❌ ${viewerName}, you do not have a ${sphere.displayName}. ` +
                `Buy one with !buy ${sphereType} 1.`
            );
            return;
        }

        attemptedViewers.add(viewerTwitchId);

        const catchRoll = Math.random();

        console.log(
            `${viewerName} used ${sphere.displayName}: ` +
            `${catchRoll.toFixed(2)} / ${sphere.catchChance}`
        );

        if (catchRoll >= sphere.catchChance) {
            return;
        }

        const wildMonster = await prisma.monster.findUnique({
            where: {
                id: monster.id
            }
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

        const refreshedPlayer = await prisma.player.findUnique({
            where: {
                id: player.id
            }
        });

        if (!refreshedPlayer) {
            throw new Error("Player disappeared before rewards were awarded");
        }

        const updatedPlayer = await awardPlayer(
            player.id,
            refreshedPlayer.xp,
            refreshedPlayer.level
        );

        const catchers = successfulCatchers.get(currentChannel) ?? [];
        catchers.push(viewerName);
        successfulCatchers.set(currentChannel, catchers);

        const levelMessage =
            updatedPlayer.level > refreshedPlayer.level
                ? ` and reached level ${updatedPlayer.level}`
                : "";

        console.log(
            `${viewerName} caught ${monster.species} (${caughtMonster.id}) ` +
            `with ${sphere.displayName} in ${currentChannel}${levelMessage}`
        );
    } catch (error) {
        console.error("Catch failed:", error);

        if (!attemptedViewers.has(viewerTwitchId)) {
            attemptedViewers.delete(viewerTwitchId);
        }

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

export async function spawnMonsterForStreamer(channelName: string) {const normalizedChannel = normalizeChannel(channelName);

try {
    const streamer = await prisma.streamer.findUnique({
        where: { channelName: normalizedChannel }
    });

    if (!streamer) {
        throw new Error(`Streamer record not found for ${normalizedChannel}`);
    }

    const streamerIsLive = await isStreamerLive(normalizedChannel);

    if (!streamerIsLive) {
        await clearActiveEncounter(normalizedChannel);
        console.log(`Skipped spawn because ${normalizedChannel} is offline`);
        return null;
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
            shiny: Math.random() < 0.005,
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
        const shinyText = monster.shiny ? " ✨LUCKY✨" : "";

        await client.say(
            normalizedChannel,
            `🐾 A wild${shinyText} ${monster.species} appeared! ` +
            `Use !catch, !catch mega, !catch giga, or !catch hyper within 60 seconds!`
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
                const shinyText = monster.shiny ? "✨ LUCKY " : "";

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