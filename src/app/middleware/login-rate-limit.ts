import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { redisClient } from "../lib/redis.js";
import { registrationClientIp } from "../lib/request-client-ip.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/app-error.js";

const WINDOW_SECONDS = 15 * 60;
const MAX_ACCOUNT_ATTEMPTS = 10;
const MAX_IP_ATTEMPTS = 30;

const hashKey = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const accountKey = (email: string): string =>
  `rate-limit:login:account:${hashKey(email.trim().toLowerCase())}`;

const ipKey = (ip: string): string => `rate-limit:login:ip:${hashKey(ip)}`;

const reserveLoginAttempt = async (
  account: string,
  ip: string,
): Promise<number> => {
  const result = await redisClient.eval(
    `
      local accountCount = tonumber(redis.call("GET", KEYS[1]) or "0")
      local ipCount = tonumber(redis.call("GET", KEYS[2]) or "0")

      local accountLimit = tonumber(ARGV[1])
      local ipLimit = tonumber(ARGV[2])
      local window = tonumber(ARGV[3])

      if accountCount >= accountLimit or ipCount >= ipLimit then
        local accountTtl = redis.call("TTL", KEYS[1])
        local ipTtl = redis.call("TTL", KEYS[2])

        local retryAfter = math.max(accountTtl, ipTtl, 1)
        return retryAfter
      end

      accountCount = redis.call("INCR", KEYS[1])

      if accountCount == 1 then
        redis.call("EXPIRE", KEYS[1], window)
      end

      ipCount = redis.call("INCR", KEYS[2])

      if ipCount == 1 then
        redis.call("EXPIRE", KEYS[2], window)
      end

      return 0
    `,
    {
      keys: [accountKey(account), ipKey(ip)],
      arguments: [
        String(MAX_ACCOUNT_ATTEMPTS),
        String(MAX_IP_ATTEMPTS),
        String(WINDOW_SECONDS),
      ],
    },
  );

  if (typeof result !== "number" || !Number.isSafeInteger(result) || result < 0) {
    throw new AppError("Login rate limiter unavailable", 503);
  }

  return result;
};

export const loginRateLimit = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const clientIp = registrationClientIp(req);

    if (!clientIp) {
      throw new AppError("Unable to determine client IP", 400);
    }

    // This middleware runs after login Zod validation.
    const email = req.body.email.trim().toLowerCase();

    let retryAfter: number;

    try {
      retryAfter = await reserveLoginAttempt(email, clientIp);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      throw new AppError(
        "Login temporarily unavailable. Please try again later.",
        503,
      );
    }

    if (retryAfter > 0) {
      res.setHeader("Retry-After", String(retryAfter));

      throw new AppError(
        "Too many login attempts. Please try again later.",
        429,
      );
    }

    next();
  },
);

export const clearSuccessfulLoginAccountLimit = async (
  email: string,
): Promise<void> => {
  await redisClient.del(accountKey(email));
};
