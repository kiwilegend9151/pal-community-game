import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { connectStreamer } from "../twitch";

const router = Router();
const prisma = new PrismaClient();

router.post("/install", async (req, res) => {

    console.log("Streamer install request received");

    try {

        const {
            twitchId,
            channelName
        } = req.body;


        console.log({
            twitchId,
            channelName
        });


        if (!twitchId || !channelName) {

            return res.status(400).json({
                error: "Missing twitchId or channelName"
            });

        }


        // Connect bot first
        await connectStreamer(channelName);


        // Save streamer
        const streamer = await prisma.streamer.upsert({

            where: {
                twitchId
            },

            update: {
                channelName,
                live: true
            },

            create: {
                twitchId,
                channelName,
                live: true
            }

        });


        res.json({

            message: "Streamer connected",
            streamer

        });


    } catch (error) {

        console.error(
            "STREAMER INSTALL ERROR:",
            error
        );


        res.status(500).json({

            error: "Streamer install failed"

        });

    }

});


export default router;