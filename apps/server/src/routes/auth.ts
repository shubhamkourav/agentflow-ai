import { Router } from "express";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { env } from "../config/env.js";
import { mongoClient } from "../db/mongo.js";
import { authenticate, signAccessToken } from "../middleware/auth.js";

export const authRouter = Router();
const users = () => mongoClient.db(env.MONGODB_DB).collection("users");
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many authentication attempts. Try again later." }
});

const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128)
});
const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128)
});

authRouter.post("/register", authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid registration details", details: parsed.error.flatten() });
    return;
  }
  try {
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const user = {
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await users().insertOne(user);
    const safeUser = { id: result.insertedId.toHexString(), name: user.name, email: user.email };
    res.status(201).json({ user: safeUser, accessToken: signAccessToken({ id: safeUser.id, email: safeUser.email }) });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }
    res.status(500).json({ error: "Unable to create account" });
  }
});

authRouter.post("/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid login details" });
    return;
  }
  const user = await users().findOne<{ _id: ObjectId; name: string; email: string; passwordHash: string }>({
    email: parsed.data.email
  });
  const valid = user ? await bcrypt.compare(parsed.data.password, user.passwordHash) : false;
  if (!user || !valid) {
    res.status(401).json({ error: "Email or password is incorrect" });
    return;
  }
  const safeUser = { id: user._id.toHexString(), name: user.name, email: user.email };
  res.json({ user: safeUser, accessToken: signAccessToken({ id: safeUser.id, email: safeUser.email }) });
});

authRouter.get("/me", authenticate, async (req, res) => {
  const user = await users().findOne<{ _id: ObjectId; name: string; email: string }>(
    { _id: new ObjectId(req.user!.id) },
    { projection: { name: 1, email: 1 } }
  );
  if (!user) {
    res.status(401).json({ error: "Account no longer exists" });
    return;
  }
  res.json({ user: { id: user._id.toHexString(), name: user.name, email: user.email } });
});
