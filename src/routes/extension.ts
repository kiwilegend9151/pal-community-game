import express, {
    type NextFunction,
    type Request,
    type Response
} from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { prisma } from "../database";
import { connectStreamer } from "../twitch";
import { monsterTemplates } from "../monsters";
999999999
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
            error:
                error instanceof Error
                    ? error.message
                    : "Invalid extension token"
        });
    }
}

/*
 * Broadcaster installation route
 */
router.post("/install", async (req, res) => {
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
            streamer
        });
    } catch (error) {
        console.error("Extension installation failed:", error);

        if (axios.isAxiosError(error)) {
            console.error("Twitch API response:", error.response?.data);

            return res.status(error.response?.status || 500).json({
                error:
                    error.response?.data?.message ||
                    error.message ||
                    "Twitch API request failed"
            });
        }

        if (error instanceof jwt.JsonWebTokenError) {
            return res.status(401).json({
                error: `Extension token error: ${error.message}`
            });
        }

        return res.status(500).json({
            error:
                error instanceof Error
                    ? error.message
                    : "Extension setup failed"
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
                pal: 10,
                mega: 20,
                giga: 30,
                hyper: 50
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

            return res.status(500).json({
                error: "Could not start expedition"
            });
        }
    }
);

router.post(
    "/expedition/claim",
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
                    monsters: {
                        orderBy: {
                            createdAt: "desc"
                        },
                        select: {
                            id: true,
                            species: true,
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
                    error:
                        `No player was found with Twitch ID ${twitchId}`
                });
            }

            return res.json({
                total: player.monsters.length,
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

export default router;