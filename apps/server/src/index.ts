import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { env } from "./config/env.js";
import { connectMongo, mongoClient } from "./db/mongo.js";
import { authRouter } from "./routes/auth.js";
import { chatRouter } from "./routes/chat.js";

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: false }));
app.use(express.json({ limit: "32kb" }));
app.use("/api", rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false
}));
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRouter);
app.use("/api", chatRouter);

async function start() {
  await connectMongo();
  const server = app.listen(env.PORT, () => console.log(`AgentFlow API listening on http://localhost:${env.PORT}`));
  const shutdown = async () => { server.close(); await mongoClient.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => { console.error("Failed to start API", error); process.exit(1); });
