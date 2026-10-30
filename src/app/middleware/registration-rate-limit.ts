import { createHash } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { redisClient } from "../lib/redis.js";
import { catchAsync } from "../utils/catchAsync.js";
import { AppError } from "../utils/app-error.js";
import { registrationClientIp } from "../lib/request-client-ip.js";

const WINDOW_SECONDS = 15 * 60;
const MAX_IP_REQUESTS = 5;

const EMAIL_WINDOW_SECONDS = 60 * 60;
const MAX_EMAIL_REQUESTS = 3;

const hashKey = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const incrementWithLimit = async (
  key: string,
  maxRequests: number,
  windowSeconds: number,
): Promise<boolean> => {
  const result = await redisClient.eval(
    `
      local count = redis.call("INCR", KEYS[1])

      if count == 1 then
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
      end

      return count
    `,
    {
      keys: [key],
      arguments: [String(windowSeconds)],
    },
  );

  return Number(result) <= maxRequests;
};

export const registrationRateLimit = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    // Express req.ip is safe only when trust proxy is
    // configured for the actual trusted proxy topology.
    const clientIp = registrationClientIp(req);

    if (!clientIp) {
      throw new AppError("Unable to determine client IP", 400);
    }

    const ipKey = `rate-limit:registration:ip:${hashKey(clientIp)}`;

    const ipAllowed = await incrementWithLimit(
      ipKey,
      MAX_IP_REQUESTS,
      WINDOW_SECONDS,
    );

    if (!ipAllowed) {
      res.setHeader("Retry-After", String(WINDOW_SECONDS));

      throw new AppError(
        "Too many registration attempts. Please try again later.",
        429,
      );
    }

    // This middleware runs after Zod validation.
    const email = req.body.email.trim().toLowerCase();

    const emailKey = `rate-limit:registration:email:${hashKey(email)}`;

    const emailAllowed = await incrementWithLimit(
      emailKey,
      MAX_EMAIL_REQUESTS,
      EMAIL_WINDOW_SECONDS,
    );

    if (!emailAllowed) {
      res.setHeader("Retry-After", String(EMAIL_WINDOW_SECONDS));

      throw new AppError(
        "Too many registration attempts for this email. Please try again later.",
        429,
      );
    }

    next();
  },
);
