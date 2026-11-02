import { redisClient } from "../lib/redis.js";
import { AppError } from "./app-error.js";

const refreshTokenKey = (userId: string, sessionId: string) =>
  `auth:refresh:${userId}:${sessionId}`;

export const withAuthSessionStorage = async <T>(
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch {
    throw new AppError("Authentication service temporarily unavailable.", 503);
  }
};

export const assertActiveAuthSession = async (
  userId: string,
  sessionId: string,
): Promise<void> => {
  if (
    typeof userId !== "string" ||
    !userId.trim() ||
    typeof sessionId !== "string" ||
    !sessionId.trim()
  ) {
    throw new AppError(
      "Authentication session is invalid. Please log in again.",
      401,
    );
  }

  const session = await withAuthSessionStorage(() =>
    redisClient.get(refreshTokenKey(userId, sessionId)),
  );

  if (session !== "valid") {
    throw new AppError(
      "Authentication session has expired or was revoked. Please log in again.",
      401,
    );
  }
};
