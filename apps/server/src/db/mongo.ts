import { MongoClient } from "mongodb";
import { env } from "../config/env.js";

export const mongoClient = new MongoClient(env.MONGODB_URI, {
  maxPoolSize: 20,
  minPoolSize: 2,
  serverSelectionTimeoutMS: 10_000
});

export async function connectMongo() {
  await mongoClient.connect();
  await mongoClient.db(env.MONGODB_DB).command({ ping: 1 });
  return mongoClient.db(env.MONGODB_DB);
}
