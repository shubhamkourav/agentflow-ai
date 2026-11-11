import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default("agentflow"),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must contain at least 32 characters"),
  JWT_EXPIRES_IN: z.string().default("8h")
});

export const env = schema.parse(process.env);
