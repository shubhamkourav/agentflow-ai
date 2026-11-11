import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AuthUser = { id: string; email: string };

export function signAccessToken(user: AuthUser) {
  return jwt.sign({ email: user.email }, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
    issuer: "agentflow-api",
    audience: "agentflow-web"
  });
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      issuer: "agentflow-api",
      audience: "agentflow-web"
    });
    if (typeof payload === "string" || !payload.sub || typeof payload.email !== "string") {
      res.status(401).json({ error: "Invalid access token" });
      return;
    }
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired access token" });
  }
}
