import { createClient } from "redis";
import config from "../config/index.js";

export const redisClient = createClient({
  url: config.redis_url,
  // Application-level heartbeats also cover networks that drop idle TCP sessions.
  pingInterval: 20_000,
  socket: {
    connectTimeout: 15_000,
  },
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

redisClient.on("reconnecting", () => {
  console.warn("Redis connection lost; reconnecting");
});

redisClient.on("ready", () => {
  console.log("Redis connection ready");
});

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Redis connected");
  }
};
