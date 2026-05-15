import mongoose from "mongoose";
import { getConfig } from "../lib/config.js";

let isConnected = false;

export async function connectDatabase() {
  if (isConnected) return;

  const config = getConfig();
  mongoose.set("strictQuery", true);

  try {
    await mongoose.connect(config.MONGODB_URI, {
      dbName: config.MONGODB_DB_NAME,
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000,
    });

    isConnected = true;
    console.info(`✅ MongoDB connected: ${config.MONGODB_DB_NAME}`);

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("MongoDB disconnected. Reconnecting...");
      isConnected = false;
    });
  } catch (err) {
    console.error("❌ MongoDB connection failed:", err);
    throw err;
  }
}

export async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  console.info("MongoDB disconnected cleanly.");
}

export function getDatabaseStatus() {
  return {
    connected: isConnected,
    readyState: mongoose.connection.readyState,
  };
}
