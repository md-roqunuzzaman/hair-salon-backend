import { logUnexpectedError } from "../utils/normalize-error.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import { env } from "../config/env.js";

const logConnectionError = (error: Error) => {
  logUnexpectedError(error, { source: "src/app/lib/prisma.ts:6" });
};

const adapter = new PrismaPg(
  {
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
    // Keep one warmed connection for the minute-based expiry job.
    min: 1,
    idleTimeoutMillis: 10_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  },
  {
    onPoolError: logConnectionError,
    onConnectionError: logConnectionError,
  },
);

export const prisma = new PrismaClient({ adapter });
