import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import { Server } from "socket.io";
import gameRoutes from "./routes/game";
import playerRoutes from "./routes/player";
import monsterRoutes from "./routes/monster";
import streamerRoutes from "./routes/streamer";
import { startSpawnTimer } from "./services/spawnTimer";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/game", gameRoutes);
app.use("/players", playerRoutes);
app.use("/monsters", monsterRoutes);
app.use("/streamers", streamerRoutes);

app.get("/", (req, res) => {
    res.json({
        message: "Twitch Monsters API Running"
    });
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

io.on("connection", (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on("disconnect", () => {
        console.log(`Player disconnected: ${socket.id}`);
    });
});

const PORT = Number(process.env.PORT) || 3000;

server.listen(PORT, async () => {

    console.log(`Server running on ${PORT}`);

    startSpawnTimer();

});