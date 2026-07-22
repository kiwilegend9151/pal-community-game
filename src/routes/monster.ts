import { Router } from "express";
import { prisma } from "../database";

const router = Router();

const monsters = [
    {
        species: "Flame Fox",
        hp: 45,
        attack: 15,
        defense: 10,
        speed: 12,
        rarity: "Common"
    },
    {
        species: "Aqua Turtle",
        hp: 60,
        attack: 12,
        defense: 18,
        speed: 7,
        rarity: "Rare"
    },
    {
        species: "Volt Mouse",
        hp: 35,
        attack: 20,
        defense: 8,
        speed: 20,
        rarity: "Epic"
    }
];


// Spawn monster
router.post("/spawn", async (req, res) => {
    try {

        const monster =
            monsters[Math.floor(Math.random() * monsters.length)];

        const created = await prisma.monster.create({
            data: {
                ...monster,
                level: 1,
                shiny: Math.random() < 0.05
            }
        });

        res.json(created);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Monster spawn failed"
        });
    }
});


// Catch monster
router.post("/catch", async (req, res) => {

    try {

        const { playerId, monsterId } = req.body;


        // Check player exists
        const player = await prisma.player.findUnique({
            where: {
                id: playerId
            }
        });


        if (!player) {
            return res.status(404).json({
                error: "Player not found"
            });
        }


        // Check monster exists
        const monster = await prisma.monster.findUnique({
            where: {
                id: monsterId
            }
        });


        if (!monster) {
            return res.status(404).json({
                error: "Monster not found"
            });
        }


        // Already owned
        if (monster.ownerId) {
            return res.status(400).json({
                error: "Monster already caught"
            });
        }


        // Catch chance
        const caught = Math.random() < 0.6;


        if (!caught) {
            return res.json({
                success: false,
                message: "The monster escaped!"
            });
        }


        // Give monster to player
        const updatedMonster = await prisma.monster.update({
            where: {
                id: monsterId
            },
            data: {
                ownerId: playerId
            }
        });



        // Rewards
        const xpReward = 50;
        const coinReward = 10;


        let xp = player.xp + xpReward;
        let level = player.level;


        const xpNeeded = level * 100;


        if (xp >= xpNeeded) {
            xp -= xpNeeded;
            level++;
        }



        const updatedPlayer = await prisma.player.update({
            where: {
                id: playerId
            },
            data: {
                xp,
                level,
                coins: player.coins + coinReward
            }
        });



        res.json({

            success: true,

            monster: updatedMonster,

            rewards: {
                xp: xpReward,
                coins: coinReward
            },

            player: updatedPlayer
        });



    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Catch failed"
        });

    }

});


export default router;