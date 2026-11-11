
import "dotenv/config";
import { prisma } from "./src/app/lib/prisma.js";

async function main() {
  const result = await prisma.$queryRaw<
    Array<{
      total: bigint;
      missing: bigint;
      completed: bigint;
    }>
  >`
    SELECT
      COUNT(*) AS "total",
      COUNT(*) FILTER (
        WHERE "orderNumber" IS NULL
      ) AS "missing",
      COUNT(*) FILTER (
        WHERE "orderNumber" IS NOT NULL
      ) AS "completed"
    FROM "GroupPurchase";
  `;

  console.log("\nGroupPurchase Backfill Verification\n");

  console.table(
    result.map((row) => ({
      total: Number(row.total),
      missing: Number(row.missing),
      completed: Number(row.completed),
    })),
  );
}

main()
  .catch((error) => {
    console.error("Verification failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
