import { Router } from "express";

const router = Router();

router.get("/status", (req, res) => {

    res.json({
        game: "Twitch Monsters",
        status: "online",
        version: "0.1.0"
    });

});

export default router;