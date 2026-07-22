import { Router } from "express";
import { prisma } from "../database";

const router = Router();


// Create player
router.post("/create", async (req, res) => {

    try {

        const { twitchId, username } = req.body;

        const player = await prisma.player.create({
            data: {
                twitchId,
                username
            }
        });

        res.json(player);

    } catch (error) {

        res.status(500).json({
            error: "Could not create player"
        });

    }

});


// Get player profile
router.get("/:id", async (req, res) => {

    try {

        const player = await prisma.player.findUnique({
            where: {
                id: req.params.id
            },
            include: {
                monsters: true
            }
        });


        if (!player) {
            return res.status(404).json({
                error: "Player not found"
            });
        }


     const rarestMonster = [...player.monsters]
    .sort((a, b) => {
                const rarityOrder: any = {
                    Common: 1,
                    Rare: 2,
                    Epic: 3,
                    Legendary: 4
                };

                return rarityOrder[b.rarity] - rarityOrder[a.rarity];
            })[0];


        res.json({

            id: player.id,

            username: player.username,

            level: player.level,

            xp: player.xp,

            coins: player.coins,


            collection: {
                total: player.monsters.length,

                rarest: rarestMonster
                    ? {
                        species: rarestMonster.species,
                        rarity: rarestMonster.rarity
                    }
                    : null
            }

        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Could not load profile"
        });

    }

});
   

router.get("/:id/monsters", async (req, res) => {
    try {
        const { id } = req.params;

        const player = await prisma.player.findUnique({
            where: {
                id
            }
        });

        if (!player) {
            return res.status(404).json({
                error: "Player not found"
            });
        }


        const monsters = await prisma.monster.findMany({
            where: {
                ownerId: id
            }
        });


        res.json({
            player: {
                id: player.id,
                username: player.username,
                level: player.level,
                xp: player.xp,
                coins: player.coins
            },

            inventory: {
                count: monsters.length,
                monsters
            }
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Could not load inventory"
        });

    }
});
export default router;