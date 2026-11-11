import { MongoClient } from "mongodb";
import { env } from "../config/env.js";

export const mongoClient = new MongoClient(env.MONGODB_URI, {
  maxPoolSize: 20,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10_000
});

export async function connectMongo() {
  await mongoClient.connect();
  const db = mongoClient.db(env.MONGODB_DB);
  await db.command({ ping: 1 });
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true, name: "users_email_unique" }),
    db.collection("conversations").createIndex({ ownerId: 1, updatedAt: -1 }, { name: "conversations_owner_updated" }),
    db.collection("audit_events").createIndex({ ownerId: 1, createdAt: -1 }, { name: "audit_owner_created" }),
    db.collection("approval_requests").createIndex({ ownerId: 1, threadId: 1, status: 1 }, { name: "approval_owner_thread_status" })
  ]);
  return db;
}
