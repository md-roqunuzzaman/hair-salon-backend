import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client.js";
import { env } from "../config/env.js";

const logConnectionError = (error: Error) => {
  console.error("PostgreSQL connection error", {
    code: (error as NodeJS.ErrnoException).code,
    message: error.message,
  });
};

const adapter = new PrismaPg(
  {
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 15_000,
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
