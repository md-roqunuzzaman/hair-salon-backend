import { createClient } from "redis";
import config from "../config/index.js";

export const redisClient = createClient({
  url: config.redis_url,
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Redis connected");
  }
};
