// MongoDB = the "Document DB" box in the diagram (reviews, ratings, activity logs).
// Collections are created by infra/mongo/init.js when the container first starts.
import { MongoClient } from "mongodb";
import { settings } from "./config.js";

const client = new MongoClient(settings.mongoUrl, { serverSelectionTimeoutMS: 2000 });

// Returns the database. Connects on first use; throws if MongoDB is down.
export async function getMongoDb() {
  await client.connect(); // safe to call many times
  return client.db(settings.mongoDbName);
}

// Health probe. Never throws.
export async function pingMongo() {
  try {
    const db = await getMongoDb();
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export async function closeMongo() {
  await client.close();
}
