import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing");
}

const adapter = new PrismaPg({
  connectionString: databaseUrl,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Check existing NULL records
      const before = await tx.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM "GroupPurchase"
        WHERE "currency" IS NULL
      `;

      console.log("NULL records before:", before[0].count);

      if (before[0].count !== 13) {
        throw new Error(
          `Expected 13 NULL records, found ${before[0].count}. Aborting.`,
        );
      }

      // 2. Backfill historical HKD-only purchases
      const updated = await tx.$executeRaw`
        UPDATE "GroupPurchase"
        SET "currency" = 'HKD'
        WHERE "currency" IS NULL
      `;

      // 3. Verify within the same transaction
      const after = await tx.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM "GroupPurchase"
        WHERE "currency" IS NULL
      `;

      if (updated !== 13 || after[0].count !== 0) {
        throw new Error(
          `Backfill verification failed: updated=${updated}, remaining=${after[0].count}`,
        );
      }

      return {
        before: before[0].count,
        updated,
        remainingNull: after[0].count,
      };
    },
    {
      maxWait: 30000,
      timeout: 60000,
    },
  );

  console.table(result);
  console.log("GroupPurchase currency backfill completed.");
}

main()
  .catch((error) => {
    console.error("Currency check failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
