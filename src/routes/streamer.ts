import { Router } from "express";
import { prisma } from "../database";
import { connectStreamer } from "../twitch";

const router = Router();

router.post("/install", async (req, res) => {
    console.log("Streamer install request received");

    try {
        const { twitchId, channelName } = req.body;

        if (
            typeof twitchId !== "string" ||
            typeof channelName !== "string" ||
            !twitchId.trim() ||
            !channelName.trim()
        ) {
            return res.status(400).json({
                error: "Missing twitchId or channelName"
            });
        }

        const normalizedChannel = channelName
            .replace(/^#/, "")
            .trim()
            .toLowerCase();

        const streamer = await prisma.streamer.upsert({
            where: { twitchId: twitchId.trim() },
            update: {
                channelName: normalizedChannel,
                live: true
            },
            create: {
                twitchId: twitchId.trim(),
                channelName: normalizedChannel,
                live: true
            }
        });

        try {
            await connectStreamer(normalizedChannel);
        } catch (error) {
            console.error("TWITCH CONNECTION ERROR:", error);

            return res.status(502).json({
                error: "Streamer saved, but Twitch chat connection failed",
                streamer
            });
        }

        return res.json({
            message: "Streamer connected",
            streamer
        });
    } catch (error) {
        console.error("STREAMER INSTALL ERROR:", error);

        return res.status(500).json({
            error: "Streamer install failed"
        });
    }
});

export default router;
