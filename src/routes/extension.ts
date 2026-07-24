import express from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { prisma } from "../database";
import { connectStreamer } from "../twitch";

const router = express.Router();

type ExtensionJwtPayload = {
    channel_id: string;
    role: "broadcaster" | "moderator" | "viewer" | "external";
    exp: number;
};

router.post("/install", async (req, res) => {
    try {
        const authorization = req.headers.authorization;

        if (!authorization?.startsWith("Bearer ")) {
            return res.status(401).json({
                error: "Missing extension authorization token"
            });
        }

        const token = authorization.slice("Bearer ".length);

        const extensionSecret = process.env.TWITCH_EXTENSION_SECRET;

        if (!extensionSecret) {
            throw new Error("TWITCH_EXTENSION_SECRET is missing");
        }

        // Twitch gives extension secrets in base64.
        const secretBuffer = Buffer.from(extensionSecret, "base64");

        const payload = jwt.verify(
            token,
            secretBuffer,
            { algorithms: ["HS256"] }
        ) as ExtensionJwtPayload;

        if (payload.role !== "broadcaster") {
            return res.status(403).json({
                error: "Only the broadcaster can configure this extension"
            });
        }

        const channelId = payload.channel_id;

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
                    id: channelId
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
                twitchId: channelId
            },
            update: {
                channelName,
                live: true
            },
            create: {
                twitchId: channelId,
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

export default router;