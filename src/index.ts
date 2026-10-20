
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import http from "http";
import path from "path";
import { Server } from "socket.io";

import gameRoutes from "./routes/game";
import extensionRoutes from "./routes/extension";
import { startSpawnTimer } from "./services/spawnTimer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { startDiscordBot } from "./discord";
import twitchAuthRoutes from "./routes/twitchAuth";
import { getActiveMonsterForStreamer } from "./twitch";

const shopLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Too many shop requests. Please try again shortly."
    }
});

const expeditionLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Too many expedition requests. Please try again shortly."
    }
});

const installLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Too many install requests. Please try again shortly."
    }
});

dotenv.config();

const app = express();

app.set("trust proxy", 1);

app.use(
    helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: {
            policy: "cross-origin"
        }
    })
);

const extensionPath = path.join(process.cwd(), "extension", "dist");
const publicPath = path.join(process.cwd(), "public");

app.use(express.static(publicPath));

app.get("/terms", (_req, res) => {
    res.sendFile(path.join(publicPath, "terms.html"));
});

app.get("/privacy", (_req, res) => {
    res.sendFile(path.join(publicPath, "privacy.html"));
});

const allowedOrigins = [
    "https://twitch.tv",
    "https://www.twitch.tv",
    "http://localhost:5173"
];

const allowedOriginRegex = /^https:\/\/[a-z0-9-]+\.ext-twitch\.tv$/i;

const corsOptions = {
    origin: (
        origin: string | undefined,
        callback: (error: Error | null, allowed?: boolean) => void
    ) => {
        if (!origin) {
            return callback(null, true);
        }

        if (
            allowedOrigins.includes(origin) ||
            allowedOriginRegex.test(origin)
        ) {
            return callback(null, true);
        }

        return callback(new Error("Origin not allowed by CORS"));
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Too many requests. Please try again shortly."
    }
});

app.use(generalLimiter);
app.use(express.json());

app.use("/auth/twitch", twitchAuthRoutes);

app.use("/extension-assets", express.static(extensionPath));
app.use("/extension-assets-v2", express.static(extensionPath));

app.use("/game", gameRoutes);
app.use("/extension", extensionRoutes);

// Shared schedule endpoint for every streamer's OBS overlay.
app.get("/overlay/api/schedule", (_req, res) => {
    const now = new Date();
    const nextSpawnAt = new Date(now);

    nextSpawnAt.setSeconds(0, 0);
    nextSpawnAt.setMinutes(
        Math.floor(now.getMinutes() / 20) * 20 + 20
    );

    return res.json({
        nextSpawnAt: nextSpawnAt.toISOString(),
        intervalMinutes: 20
    });
});

// Channel-specific endpoint retained for active Pal information.
app.get("/overlay/api/:channel", (req, res) => {
    const channel = String(req.params.channel ?? "")
        .trim()
        .replace(/^#/, "")
        .toLowerCase();

    if (!/^[a-z0-9_]{1,25}$/.test(channel)) {
        return res.status(400).json({
            error: "Invalid Twitch channel name"
        });
    }

    const now = new Date();
    const nextSpawnAt = new Date(now);

    nextSpawnAt.setSeconds(0, 0);
    nextSpawnAt.setMinutes(
        Math.floor(now.getMinutes() / 20) * 20 + 20
    );

    return res.json({
        channel,
        activeMonster: getActiveMonsterForStreamer(channel),
        nextSpawnAt: nextSpawnAt.toISOString()
    });
});

app.get("/", (_req, res) => {
    res.json({
        message: "Twitch Monsters API Running"
    });
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: [
            ...allowedOrigins,
            allowedOriginRegex
        ],
        methods: ["GET", "POST"]
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

    try {
        await startSpawnTimer();
    } catch (error) {
        console.error("Could not start spawn timer:", error);
    }

    try {
        await startDiscordBot();
    } catch (error) {
        console.error("Could not start Discord bot:", error);
    }
});
