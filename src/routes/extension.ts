import express, {
    type NextFunction,
    type Request,
    type Response
} from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { prisma } from "../database";
import { connectStreamer } from "../twitch";

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

function requireExtensionPlayer(
    req: ExtensionRequest,
    res: Response,
    next: NextFunction
): void {
    const token = getBearerToken(req);

    if (!token) {
        res.status(401).json({
            error: "Missing extension authorization token"
        });
        return;
    }

    // Local browser testing at http://localhost:5173
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

        next();
        return;
    }

    try {
        const payload = verifyExtensionToken(token);

        // Twitch only includes user_id after the viewer shares identity.
        if (!payload.user_id) {
            res.status(403).json({
                error: "Twitch identity sharing is required"
            });
            return;
        }

        req.extensionUser = {
            twitchId: payload.user_id,
            channelId: payload.channel_id,
            role: payload.role
        };

        next();
    } catch (error) {
        console.error("Extension token verification failed:", error);

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
                hyperSpheres: player.hyperSpheres
            });
        } catch (error) {
            console.error("Could not load extension profile:", error);

            return res.status(500).json({
                error: "Could not load player profile"
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
            const speciesRows = await prisma.monster.groupBy({
                by: ["species"]
            });

            const discovered = player.paldexEntries.length;
            const totalSpecies = Math.max(
                speciesRows.length,
                discovered
            );
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
                entries: player.paldexEntries
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