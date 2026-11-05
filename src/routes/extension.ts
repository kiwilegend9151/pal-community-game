import express, {
    type NextFunction,
    type Request,
    type Response
} from "express";
import jwt from "jsonwebtoken";
import { Prisma } from "@prisma/client";
import axios from "axios";
import { prisma } from "../database";
import {
    connectStreamer,
    getOrCreateDailyQuests,
    updateDailyQuestProgress
} from "../twitch";
import { monsterTemplates } from "../monsters";
import {
    shopLimiter,
    expeditionLimiter,
    installLimiter
} from "../middleware/rateLimit";

const router = express.Router();

type ExtensionJwtPayload = {
    channel_id?: string;
    user_id?: string;
    opaque_user_id?: string;
    role?: "broadcaster" | "moderator" | "viewer" | "external";
    exp?: number;
};

type ExtensionRequest = Request & {
    extensionUser?: {
        twitchId: string;
        channelId?: string;
        role?: string;
    };
};

function getBearerToken(req: Request): string | null {
    const authorization = req.headers.authorization;

    if (!authorization?.startsWith("Bearer ")) {
        return null;
    }

    return authorization.slice("Bearer ".length).trim();
}

function verifyExtensionToken(token: string): ExtensionJwtPayload {
    const extensionSecret = process.env.TWITCH_EXTENSION_SECRET;

    if (!extensionSecret) {
        throw new Error("TWITCH_EXTENSION_SECRET is missing");
    }

    return jwt.verify(
        token,
        Buffer.from(extensionSecret, "base64"),
        { algorithms: ["HS256"] }
    ) as ExtensionJwtPayload;
}

async function requireExtensionPlayer(
    req: ExtensionRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    const token = getBearerToken(req);

    if (!token) {
        res.status(401).json({
            error: "Missing extension authorization token"
        });
        return;
    }

    // Local browser testing
    if (
        process.env.NODE_ENV !== "production" &&
        token === "local-development"
    ) {
        const twitchId = process.env.LOCAL_TWITCH_USER_ID;

        if (!twitchId) {
            res.status(401).json({
                error: "Set LOCAL_TWITCH_USER_ID in the server .env file"
            });
            return;
        }

        req.extensionUser = {
            twitchId,
            channelId: "local",
            role: "viewer"
        };

        try {
            await prisma.player.upsert({
                where: {
                    twitchId
                },
                update: {},
                create: {
                    twitchId,
                    username: `Twitch User ${twitchId}`
                }
            });

            next();
        } catch (error) {
            console.error(
                "Could not create local extension player:",
                error
            );

            res.status(500).json({
                error: "Could not create player profile"
            });
        }

        return;
    }

    try {
        const payload = verifyExtensionToken(token);

        // Twitch only includes user_id after identity sharing.
        if (!payload.user_id) {
            res.status(403).json({
                error: "Twitch identity sharing is required"
            });
            return;
        }

        const twitchId = payload.user_id;

        req.extensionUser = {
            twitchId,
            channelId: payload.channel_id,
            role: payload.role
        };

        // Create a fresh profile automatically if this is a new player.
        await prisma.player.upsert({
            where: {
                twitchId
            },
            update: {},
            create: {
                twitchId,
                username: `Twitch User ${twitchId}`
            }
        });

        next();
    } catch (error) {
        console.error(
            "Extension authentication/player creation failed:",
            error
        );

        res.status(401).json({
            error: "Invalid extension token"
        });
    }
}

/*
 * Broadcaster installation route
 */
router.post("/install", installLimiter, async (req, res) => {
    try {
        const token = getBearerToken(req);

        if (!token) {
            return res.status(401).json({
                error: "Missing extension authorization token"
            });
        }

        const payload = verifyExtensionToken(token);

        if (payload.role !== "broadcaster") {
            return res.status(403).json({
                error: "Only the broadcaster can configure this extension"
            });
        }

        if (!payload.channel_id) {
            return res.status(400).json({
                error: "The extension token does not contain a channel ID"
            });
        }

        const appTokenResponse = await axios.post(
            "https://id.twitch.tv/oauth2/token",
            null,
            {
                params: {
                    client_id: process.env.TWITCH_CLIENT_ID,
                    client_secret: process.env.TWITCH_CLIENT_SECRET,
                    grant_type: "client_credentials"
                }
            }
        );

        const appAccessToken =
            appTokenResponse.data.access_token as string;

        const userResponse = await axios.get(
            "https://api.twitch.tv/helix/users",
            {
                params: {
                    id: payload.channel_id
                },
                headers: {
                    "Client-Id": process.env.TWITCH_CLIENT_ID,
                    Authorization: `Bearer ${appAccessToken}`
                }
            }
        );

        const twitchUser = userResponse.data.data[0];

        if (!twitchUser) {
            return res.status(404).json({
                error: "Broadcaster could not be found"
            });
        }

        const channelName = twitchUser.login.toLowerCase();

        const streamer = await prisma.streamer.upsert({
            where: {
                twitchId: payload.channel_id
            },
            update: {
                channelName,
                live: true
            },
            create: {
                twitchId: payload.channel_id,
                channelName,
                live: true
            }
        });

        await connectStreamer(channelName);

        return res.json({
    message: "Bot connected successfully",
    channelName
});
    } catch (error) {
        console.error("Extension installation failed:", error);

        if (axios.isAxiosError(error)) {
            console.error(
                "Twitch API request failed:",
                error.response?.status,
                error.response?.data
            );

            return res.status(502).json({
                error: "Twitch installation request failed"
            });
        }

        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                error: "Invalid extension token"
            });
        }

        return res.status(500).json({
            error: "Extension setup failed"
        });
    }
});

/*
 * Viewer profile
 * GET /extension/me
 */
router.get(
    "/me",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const player = await prisma.player.findUnique({
                where: {
                    twitchId
                },
                include: {
                    monsters: {
                        select: {
                            id: true,
                            shiny: true
                        }
                    }
                }
            });

            if (!player) {
                return res.status(404).json({
                    error:
                        `No player was found with Twitch ID ${twitchId}`
                });
            }

            const totalLucky = player.monsters.filter(
                (monster) => monster.shiny
            ).length;

            return res.json({
                username: player.username,
                level: player.level,
                xp: player.xp,
                xpNeeded: player.level * 100,
                coins: player.coins,
                totalPals: player.monsters.length,
                totalLucky,
                palSpheres: player.palSpheres,
                megaSpheres: player.megaSpheres,
                gigaSpheres: player.gigaSpheres,
                hyperSpheres: player.hyperSpheres,
		paldium: player.paldium,
		wood: player.wood,
		stone: player.stone,
		trainingManualS: player.trainingManualS,
		trainingManualM: player.trainingManualM,
		trainingManualL: player.trainingManualL,
		trainingManualXL: player.trainingManualXL,
            });
        } catch (error) {
            console.error("Could not load extension profile:", error);

            return res.status(500).json({
                error: "Could not load player profile"
            });
        }
    }
);

router.post(
    "/shop/buy",
    shopLimiter,
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const body = req.body as {
                sphereType?: "pal" | "mega" | "giga" | "hyper";
                quantity?: number;
            };

            const sphereType = body.sphereType;
            const quantity = body.quantity ?? 1;

            const prices = {
    	    pal: 20,
    	    mega: 35,
            giga: 55,
            hyper: 85
            } as const;

            const sphereFields = {
                pal: "palSpheres",
                mega: "megaSpheres",
                giga: "gigaSpheres",
                hyper: "hyperSpheres"
            } as const;

            if (!sphereType || !(sphereType in prices)) {
                return res.status(400).json({
                    error: "Invalid sphere type"
                });
            }

            if (
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > 100
            ) {
                return res.status(400).json({
                    error: "Quantity must be between 1 and 100"
                });
            }

            const player = await prisma.player.findUnique({
                where: {
                    twitchId
                }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const totalPrice = prices[sphereType] * quantity;
            const sphereField = sphereFields[sphereType];

            const purchaseResult = await prisma.player.updateMany({
                where: {
                    id: player.id,
                    coins: {
                        gte: totalPrice
                    }
                },
                data: {
                    coins: {
                        decrement: totalPrice
                    },
                    [sphereField]: {
                        increment: quantity
                    }
                }
            });

            if (purchaseResult.count !== 1) {
                return res.status(400).json({
                    error: `You need ${totalPrice} coins`
                });
            }

            const updatedPlayer = await prisma.player.findUnique({
                where: {
                    id: player.id
                }
            });

            return res.json({
                message: "Purchase successful",
                coins: updatedPlayer?.coins ?? 0,
                palSpheres: updatedPlayer?.palSpheres ?? 0,
                megaSpheres: updatedPlayer?.megaSpheres ?? 0,
                gigaSpheres: updatedPlayer?.gigaSpheres ?? 0,
                hyperSpheres: updatedPlayer?.hyperSpheres ?? 0
            });
        } catch (error) {
            console.error("Extension shop purchase failed:", error);

            return res.status(500).json({
                error: "Purchase could not be completed"
            });
        }
    }
);

/*
 * Craft spheres using gathered materials
 * POST /extension/craft
 */
router.post(
    "/craft",
    shopLimiter,
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const body = req.body as {
                sphereType?: "pal" | "mega" | "giga" | "hyper";
                quantity?: number;
            };

            const sphereType = body.sphereType;
            const quantity = body.quantity ?? 1;

            const recipes = {
                pal: {
                    displayName: "Pal Sphere",
                    paldium: 1,
                    wood: 0,
                    stone: 0,
                    field: "palSpheres"
                },
                mega: {
                    displayName: "Mega Sphere",
                    paldium: 1,
                    wood: 2,
                    stone: 2,
                    field: "megaSpheres"
                },
                giga: {
                    displayName: "Giga Sphere",
                    paldium: 2,
                    wood: 4,
                    stone: 4,
                    field: "gigaSpheres"
                },
                hyper: {
                    displayName: "Hyper Sphere",
                    paldium: 3,
                    wood: 5,
                    stone: 5,
                    field: "hyperSpheres"
                }
            } as const;

            if (!sphereType || !(sphereType in recipes)) {
                return res.status(400).json({
                    error: "Invalid sphere type"
                });
            }

            if (
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > 100
            ) {
                return res.status(400).json({
                    error: "Quantity must be between 1 and 100"
                });
            }

            const recipe = recipes[sphereType];

            const player = await prisma.player.findUnique({
                where: { twitchId }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const requiredPaldium = recipe.paldium * quantity;
            const requiredWood = recipe.wood * quantity;
            const requiredStone = recipe.stone * quantity;

            const result = await prisma.player.updateMany({
                where: {
                    id: player.id,
                    paldium: { gte: requiredPaldium },
                    wood: { gte: requiredWood },
                    stone: { gte: requiredStone }
                },
                data: {
                    paldium: { decrement: requiredPaldium },
                    wood: { decrement: requiredWood },
                    stone: { decrement: requiredStone },
                    [recipe.field]: { increment: quantity }
                }
            });

            if (result.count !== 1) {
                return res.status(400).json({
                    error:
                        `Not enough materials. You need ${requiredPaldium} Paldium, ` +
                        `${requiredWood} Wood and ${requiredStone} Stone.`
                });
            }

            await updateDailyQuestProgress(
                player.id,
                "craft_spheres",
                quantity
            );

            const updatedPlayer = await prisma.player.findUnique({
                where: { id: player.id }
            });

            return res.json({
                message: `Successfully crafted ${quantity} ${recipe.displayName}${quantity === 1 ? "" : "s"}`,
                paldium: updatedPlayer?.paldium ?? 0,
                wood: updatedPlayer?.wood ?? 0,
                stone: updatedPlayer?.stone ?? 0,
                palSpheres: updatedPlayer?.palSpheres ?? 0,
                megaSpheres: updatedPlayer?.megaSpheres ?? 0,
                gigaSpheres: updatedPlayer?.gigaSpheres ?? 0,
                hyperSpheres: updatedPlayer?.hyperSpheres ?? 0
            });
        } catch (error) {
            console.error("Extension crafting failed:", error);

            return res.status(500).json({
                error: "Crafting could not be completed"
            });
        }
    }
);

/*
 * Use a Training Manual on the current Partner Pal
 * POST /extension/manuals/use
 */
router.post(
    "/manuals/use",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const body = req.body as {
                manualType?: "S" | "M" | "L" | "XL";
            };

            const manualType = body.manualType;

            const manuals = {
                S: {
                    field: "trainingManualS",
                    xp: 100
                },
                M: {
                    field: "trainingManualM",
                    xp: 250
                },
                L: {
                    field: "trainingManualL",
                    xp: 500
                },
                XL: {
                    field: "trainingManualXL",
                    xp: 1000
                }
            } as const;

            if (!manualType || !(manualType in manuals)) {
                return res.status(400).json({
                    error: "Invalid Training Manual type"
                });
            }

            const manual = manuals[manualType];
            const PAL_LEVEL_CAP = 80;

            const result = await prisma.$transaction(async (tx) => {
                const player = await tx.player.findUnique({
                    where: { twitchId },
                    select: {
                        id: true,
                        partnerPalId: true
                    }
                });

                if (!player) {
                    return {
                        success: false as const,
                        status: 404,
                        error: "Player not found"
                    };
                }

                if (!player.partnerPalId) {
                    return {
                        success: false as const,
                        status: 400,
                        error: "You need to select a Partner Pal first"
                    };
                }

                const pal = await tx.monster.findFirst({
                    where: {
                        id: player.partnerPalId,
                        ownerId: player.id
                    },
                    select: {
                        id: true,
                        species: true,
                        nickname: true,
                        level: true,
                        palXp: true
                    }
                });

                if (!pal) {
                    return {
                        success: false as const,
                        status: 404,
                        error: "Your Partner Pal could not be found"
                    };
                }

                if (pal.level >= PAL_LEVEL_CAP) {
                    return {
                        success: false as const,
                        status: 400,
                        error: "Your Partner Pal is already at the level cap"
                    };
                }

                const consumed = await tx.player.updateMany({
                    where: {
                        id: player.id,
                        [manual.field]: {
                            gte: 1
                        }
                    },
                    data: {
                        [manual.field]: {
                            decrement: 1
                        }
                    }
                });

                if (consumed.count !== 1) {
                    return {
                        success: false as const,
                        status: 400,
                        error: `You don't have any Training Manual ${manualType}`
                    };
                }

                let palXp = pal.palXp + manual.xp;
                let palLevel = pal.level;

                while (
                    palLevel < PAL_LEVEL_CAP &&
                    palXp >= palLevel * 100
                ) {
                    palXp -= palLevel * 100;
                    palLevel++;
                }

                await tx.monster.update({
                    where: {
                        id: pal.id
                    },
                    data: {
                        palXp,
                        level: palLevel
                    }
                });

                const updatedPlayer = await tx.player.findUnique({
                    where: {
                        id: player.id
                    },
                    select: {
                        trainingManualS: true,
                        trainingManualM: true,
                        trainingManualL: true,
                        trainingManualXL: true
                    }
                });

                return {
                    success: true as const,
                    species: pal.species,
                    nickname: pal.nickname,
                    xpAwarded: manual.xp,
                    level: palLevel,
                    palXp,
                    manuals: updatedPlayer
                };
            });

            if (!result.success) {
                return res.status(result.status).json({
                    error: result.error
                });
            }

            return res.json({
                message: `Used Training Manual ${manualType} on ${result.nickname || result.species}. +${result.xpAwarded} XP!`,
                xpAwarded: result.xpAwarded,
                level: result.level,
                palXp: result.palXp,
                manuals: result.manuals
            });
        } catch (error) {
            console.error("Could not use Training Manual:", error);

            return res.status(500).json({
                error: "Could not use Training Manual"
            });
        }
    }
);

router.get(
    "/expedition",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const player = await prisma.player.findUnique({
                where: { twitchId },
                include: {
                    expedition: {
                        include: {
                            monster: true
                        }
                    }
                }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            if (!player.expedition) {
                return res.json({
                    active: false
                });
            }

            const expedition = player.expedition;
            const completed =
                expedition.completesAt.getTime() <= Date.now();

            return res.json({
                active: true,
                completed,
                expedition: {
                    id: expedition.id,
                    monsterId: expedition.monster.id,
                    species: expedition.monster.species,
                    shiny: expedition.monster.shiny,
                    startedAt: expedition.startedAt,
                    completesAt: expedition.completesAt
                }
            });
        } catch (error) {
            console.error("Could not load expedition:", error);

            return res.status(500).json({
                error: "Could not load expedition"
            });
        }
    }
);

router.post(
    "/expedition/send",
    expeditionLimiter,
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;
            const monsterId = String(req.body?.monsterId ?? "");

            if (!monsterId) {
                return res.status(400).json({
                    error: "A Pal must be selected"
                });
            }

            const player = await prisma.player.findUnique({
                where: { twitchId },
                include: {
                    expedition: true,
                    monsters: {
                        include: {
                            expedition: true
                        }
                    }
                }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            if (player.expedition) {
                return res.status(400).json({
                    error: "You already have an expedition"
                });
            }

            const monster = player.monsters.find(
                (pal) =>
                    pal.id === monsterId &&
                    pal.expedition === null
            );

            if (!monster) {
                return res.status(400).json({
                    error: "That Pal is not available"
                });
            }

            const startedAt = new Date();
            const completesAt = new Date(
                startedAt.getTime() + 60 * 60 * 1000
            );

            await prisma.expedition.create({
                data: {
                    playerId: player.id,
                    monsterId: monster.id,
                    startedAt,
                    completesAt,
                    coinReward:
                        Math.floor(Math.random() * 76) + 25,
                    palSphereReward:
                        Math.floor(Math.random() * 4),
                    paldiumReward:
                        Math.floor(Math.random() * 5) + 1,
                    woodReward:
                        Math.floor(Math.random() * 6),
                    stoneReward:
                        Math.floor(Math.random() * 6)
                }
            });

            return res.json({
                message: `${monster.species} started a 1-hour expedition`,
                completesAt
            });
               } catch (error) {
            console.error("Could not start expedition:", error);

            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === "P2002"
            ) {
                return res.status(400).json({
                    error: "You already have an expedition"
                });
            }

            return res.status(500).json({
                error: "Could not start expedition"
            });
        }
    }
);

router.post(
    "/expedition/claim",
    expeditionLimiter,
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const result = await prisma.$transaction(async (tx) => {
                const player = await tx.player.findUnique({
                    where: { twitchId },
                    include: {
                        expedition: {
                            include: {
                                monster: true
                            }
                        }
                    }
                });

                if (!player?.expedition) {
                    throw new Error("No expedition to claim");
                }

                const expedition = player.expedition;

                if (expedition.completesAt.getTime() > Date.now()) {
                    throw new Error(
                        "The expedition has not finished yet"
                    );
                }

                const deleted = await tx.expedition.deleteMany({
                    where: {
                        id: expedition.id,
                        playerId: player.id,
                        completesAt: {
                            lte: new Date()
                        }
                    }
                });

                if (deleted.count !== 1) {
                    throw new Error(
                        "This expedition was already claimed"
                    );
                }

                const updatedPlayer = await tx.player.update({
                    where: {
                        id: player.id
                    },
                    data: {
                        coins: {
                            increment: expedition.coinReward
                        },
                        palSpheres: {
                            increment: expedition.palSphereReward
                        },
                        paldium: {
                            increment: expedition.paldiumReward
                        },
                        wood: {
                            increment: expedition.woodReward
                        },
                        stone: {
                            increment: expedition.stoneReward
                        }
                    }
                });

                return {
                    species: expedition.monster.species,
                    coinReward: expedition.coinReward,
                    palSphereReward:
                        expedition.palSphereReward,
                    paldiumReward:
                        expedition.paldiumReward,
                    woodReward: expedition.woodReward,
                    stoneReward: expedition.stoneReward,
                    player: updatedPlayer
                };
            });

            return res.json(result);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Could not claim expedition";

            return res.status(400).json({
                error: message
            });
        }
    }
);

/*
 * Viewer Pal collection
 * GET /extension/pals
 */
router.get(
    "/pals",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const player = await prisma.player.findUnique({
                where: {
                    twitchId
                },
                select: {
                    partnerPalId: true,
                    monsters: {
                        orderBy: {
                            createdAt: "desc"
                        },
                        select: {
                            id: true,
                            species: true,
                            nickname: true,
                            paldeck: true,
                            type1: true,
                            type2: true,
                            level: true,
                            hp: true,
                            attack: true,
                            defense: true,
                            speed: true,
                            rarity: true,
                            shiny: true,
                            createdAt: true
                        }
                    }
                }
            });

            if (!player) {
                return res.status(404).json({
                    error: `No player was found with Twitch ID ${twitchId}`
                });
            }

            return res.json({
                total: player.monsters.length,
                partnerPalId: player.partnerPalId,
                pals: player.monsters.map((pal) => ({
                    ...pal,
                    imageUrl: null
                }))
            });
        } catch (error) {
            console.error("Could not load extension Pals:", error);

            return res.status(500).json({
                error: "Could not load Pal collection"
            });
        }
    }
);


/*
 * Release a Pal
 * DELETE /extension/pals/:palId/release
 */
router.delete(
    "/pals/:palId/release",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const palId = Array.isArray(req.params.palId)
                ? req.params.palId[0]
                : req.params.palId;

            const result = await prisma.$transaction(async (tx) => {
                const player = await tx.player.findUnique({
                    where: { twitchId },
                    select: {
                        id: true,
                        partnerPalId: true
                    }
                });

                if (!player) {
                    return {
                        success: false as const,
                        status: 404,
                        error: "Player not found"
                    };
                }

                const pal = await tx.monster.findFirst({
                    where: {
                        id: palId,
                        ownerId: player.id
                    },
                    include: {
                        expedition: true
                    }
                });

                if (!pal) {
                    return {
                        success: false as const,
                        status: 404,
                        error: "Pal not found in your collection"
                    };
                }

                if (pal.expedition) {
                    return {
                        success: false as const,
                        status: 400,
                        error: "You cannot release a Pal while it is on an expedition"
                    };
                }

                // Only release the Pal if it is still owned and not on an expedition.
                const deleted = await tx.monster.deleteMany({
                    where: {
                        id: palId,
                        ownerId: player.id,
                        expedition: {
                            is: null
                        }
                    }
                });

                if (deleted.count !== 1) {
                    return {
                        success: false as const,
                        status: 400,
                        error: "This Pal could not be released. Please refresh and try again."
                    };
                }

                const updatedPlayer = await tx.player.update({
                    where: {
                        id: player.id
                    },
                    data: {
                        trainingManualS: {
                            increment: 1
                        },
                        ...(player.partnerPalId === palId
                            ? {
                                partnerPalId: null,
                                partnerSince: null
                            }
                            : {})
                    },
                    select: {
                        trainingManualS: true
                    }
                });

                return {
                    success: true as const,
                    species: pal.species,
                    nickname: pal.nickname,
                    trainingManualS: updatedPlayer.trainingManualS
                };
            });

            if (!result.success) {
                return res.status(result.status).json({
                    error: result.error
                });
            }

            return res.json({
                message: `${result.nickname || result.species} was released successfully. You received 1 Training Manual S.`,
                trainingManualS: result.trainingManualS
            });
        } catch (error) {
            console.error("Could not release Pal:", error);

            return res.status(500).json({
                error: "Could not release Pal"
            });
        }
    }
);

/*
 * Update a Pal nickname
 * PATCH /extension/pals/:palId/nickname
 */
router.patch(
    "/pals/:palId/nickname",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;
            const palId = Array.isArray(req.params.palId)
    ? req.params.palId[0]
    : req.params.palId;

            const body = req.body as {
                nickname?: unknown;
            };

            const nickname =
                typeof body.nickname === "string"
                    ? body.nickname.trim()
                    : "";

            if (nickname.length > 20) {
                return res.status(400).json({
                    error: "Nicknames cannot exceed 20 characters"
                });
            }

            const player = await prisma.player.findUnique({
                where: { twitchId },
                select: { id: true }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const updated = await prisma.monster.updateMany({
                where: {
                    id: palId,
                    ownerId: player.id
                },
                data: {
                    nickname: nickname || null
                }
            });

            if (updated.count !== 1) {
                return res.status(404).json({
                    error: "Pal not found in your collection"
                });
            }

            return res.json({
                message: nickname
                    ? "Nickname updated successfully"
                    : "Nickname removed successfully",
                nickname: nickname || null
            });
        } catch (error) {
            console.error("Could not update Pal nickname:", error);

            return res.status(500).json({
                error: "Could not update Pal nickname"
            });
        }
    }
);

/*
 * Select a Partner Pal
 * PUT /extension/pals/:palId/partner
 */
router.put(
    "/pals/:palId/partner",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const palId = Array.isArray(req.params.palId)
                ? req.params.palId[0]
                : req.params.palId;

            const player = await prisma.player.findUnique({
                where: { twitchId },
                select: { id: true }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            const pal = await prisma.monster.findFirst({
                where: {
                    id: palId,
                    ownerId: player.id
                },
                select: {
                    id: true,
                    species: true,
                    nickname: true
                }
            });

            if (!pal) {
                return res.status(404).json({
                    error: "Pal not found in your collection"
                });
            }

            await prisma.player.update({
    where: { id: player.id },
    data: {
        partnerPalId: pal.id,
        partnerSince: new Date()
    }
});

            return res.json({
                message: "Partner Pal selected successfully",
                partnerPalId: pal.id,
                species: pal.species,
                nickname: pal.nickname
            });
        } catch (error) {
            console.error("Could not select Partner Pal:", error);

            return res.status(500).json({
                error: "Could not select Partner Pal"
            });
        }
    }
);

/*
 * Remove current Partner Pal
 * DELETE /extension/pals/partner
 */
router.delete(
    "/pals/partner",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const player = await prisma.player.findUnique({
                where: { twitchId },
                select: { id: true }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player not found"
                });
            }

            await prisma.player.update({
    where: { id: player.id },
    data: {
        partnerPalId: null,
        partnerSince: null
    }
});

            return res.json({
                message: "Partner Pal removed successfully"
            });
        } catch (error) {
            console.error("Could not remove Partner Pal:", error);

            return res.status(500).json({
                error: "Could not remove Partner Pal"
            });
        }
    }
);

/*
 * Viewer Paldeck
 * GET /extension/paldex
 */
router.get(
    "/paldex",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const player = await prisma.player.findUnique({
                where: {
                    twitchId
                },
                select: {
                    paldexEntries: {
                        orderBy: {
                            discoveredAt: "desc"
                        },
                        select: {
                            id: true,
                            species: true,
                            paldeck: true,
                            rarity: true,
                            hasLucky: true,
                            discoveredAt: true
                        }
                    }
                }
            });

            if (!player) {
                return res.status(404).json({
                    error:
                        `No player was found with Twitch ID ${twitchId}`
                });
            }

            /*
             * This counts every distinct species currently present in the
             * Monster table. Later, this can be replaced by the length of
             * your master Pal species list.
             */
            const discoveredBySpecies = new Map(
    player.paldexEntries.map((entry) => [
        entry.species.trim().toLowerCase(),
        entry
    ])
);

const uniqueSpecies = Array.from(
    new Map(
        monsterTemplates.map((template) => [
            template.species.trim().toLowerCase(),
            template
        ])
    ).values()
);

const entries = uniqueSpecies
    .map((template) => {
        const species = template.species.trim();

        const discoveredEntry = discoveredBySpecies.get(
            species.toLowerCase()
        );

        return {
            id:
                discoveredEntry?.id ??
                `locked-${template.paldeck}`,
            species,
            paldeck: template.paldeck,
            rarity: template.rarity,
            hasLucky:
                discoveredEntry?.hasLucky ?? false,
            discoveredAt:
                discoveredEntry?.discoveredAt ?? null,
            discovered: Boolean(discoveredEntry)
        };
    })
    .sort((a, b) =>
        (a.paldeck ?? "").localeCompare(
            b.paldeck ?? "",
            undefined,
            {
                numeric: true,
                sensitivity: "base"
            }
        )
    );

const discovered = player.paldexEntries.length;
const totalSpecies = uniqueSpecies.length;

const luckySpecies = player.paldexEntries.filter(
    (entry) => entry.hasLucky
).length;

return res.json({
    discovered,
    totalSpecies,
    completionPercentage:
        totalSpecies === 0
            ? 0
            : Math.floor(
                  (discovered / totalSpecies) * 100
              ),
    luckySpecies,
    entries
});
        } catch (error) {
            console.error("Could not load extension Paldeck:", error);

            return res.status(500).json({
                error: "Could not load Paldeck"
            });
        }
    }
);

/*
 * Daily Quests
 * GET /extension/quests
 */
router.get(
    "/quests",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const player = await prisma.player.findUnique({
                where: { twitchId },
                select: { id: true }
            });

            if (!player) {
                return res.status(404).json({
                    error: "Player profile not found"
                });
            }

            const now = new Date();
            const questDate = new Date(
                Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate()
                )
            );

            const quests = await getOrCreateDailyQuests(player.id);

            return res.json({
                quests: quests.map((quest) => ({
                    id: quest.id,
                    title: quest.title,
                    progress: Math.min(quest.progress, quest.target),
                    target: quest.target,
                    rewardType: quest.rewardType,
                    rewardAmount: quest.rewardAmount,
                    completed: quest.completed,
                    claimed: quest.claimed,
                    questDate
                }))
            });
        } catch (error) {
            console.error("Could not load daily quests:", error);

            return res.status(500).json({
                error: "Could not load daily quests"
            });
        }
    }
);

/*
 * Claim completed daily quest rewards
 * POST /extension/quests/claim
 */
router.post(
    "/quests/claim",
    requireExtensionPlayer,
    async (req: ExtensionRequest, res) => {
        try {
            const twitchId = req.extensionUser!.twitchId;

            const result = await prisma.$transaction(async (tx) => {
                const player = await tx.player.findUnique({
                    where: { twitchId },
                    select: { id: true }
                });

                if (!player) {
                    throw new Error("Player profile not found");
                }

                const now = new Date();
                const questDate = new Date(
                    Date.UTC(
                        now.getUTCFullYear(),
                        now.getUTCMonth(),
                        now.getUTCDate()
                    )
                );

                // Ensure today's quests exist before reading them.
                const quests = await getOrCreateDailyQuests(player.id);

                const claimable = quests.filter(
                    (quest) =>
                        quest.completed &&
                        !quest.claimed &&
                        quest.questDate.getTime() === questDate.getTime()
                );

                if (claimable.length === 0) {
                    throw new Error("No completed quest rewards to claim");
                }

                let coins = 0;
                let gigaSpheres = 0;
                let hyperSpheres = 0;

                for (const quest of claimable) {
                    if (quest.rewardType === "coins") {
                        coins += quest.rewardAmount;
                    } else if (quest.rewardType === "giga") {
                        gigaSpheres += quest.rewardAmount;
                    } else if (quest.rewardType === "hyper") {
                        hyperSpheres += quest.rewardAmount;
                    } else if (quest.rewardType === "lucky") {
                        coins += 100;
                        hyperSpheres += 5;
                    }
                }

                // Only claim quests that are still completed and unclaimed.
                const claimed = await tx.dailyQuest.updateMany({
                    where: {
                        id: { in: claimable.map((quest) => quest.id) },
                        playerId: player.id,
                        questDate,
                        completed: true,
                        claimed: false
                    },
                    data: { claimed: true }
                });

                if (claimed.count !== claimable.length) {
                    throw new Error(
                        "Some quest rewards were already claimed. Refresh and try again."
                    );
                }

                const updatedPlayer = await tx.player.update({
                    where: { id: player.id },
                    data: {
                        coins: { increment: coins },
                        gigaSpheres: { increment: gigaSpheres },
                        hyperSpheres: { increment: hyperSpheres }
                    },
                    select: {
                        coins: true,
                        gigaSpheres: true,
                        hyperSpheres: true
                    }
                });

                return {
                    claimedCount: claimable.length,
                    coins,
                    gigaSpheres,
                    hyperSpheres,
                    player: updatedPlayer
                };
            });

            return res.json(result);
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Could not claim quest rewards";

            return res.status(400).json({ error: message });
        }
    }
);

export default router;