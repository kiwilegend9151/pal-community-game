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

app.use(
    helmet({
        contentSecurityPolicy: false
    })
);

const extensionPath = path.join(process.cwd(), "extension", "dist");

const allowedOrigins = [
    "https://extension-files.twitch.tv",
    "https://twitch.tv",
    "https://www.twitch.tv",
    "http://localhost:5173"
];

const corsOptions = {
    origin: (origin: string | undefined, callback: (error: Error | null, allowed?: boolean) => void) => {
        // Allow requests with no Origin header, such as server-to-server requests.
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.includes(origin)) {
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


app.use(
    "/extension-assets",
    express.static(extensionPath)
);

app.use(
    "/extension-assets-v2",
    express.static(extensionPath)
);

app.use("/game", gameRoutes);

app.use("/extension", extensionRoutes);

app.get("/", (_req, res) => {
    res.json({
        message: "Twitch Monsters API Running"
    });
});

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
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
});
