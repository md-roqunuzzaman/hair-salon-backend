import { randomInt } from "node:crypto";
import { prisma } from "../src/app/lib/prisma.js";

const CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ORDER_NUMBER_LENGTH = 6;
const MAX_RETRIES = 20;

const generateOrderNumber = (): string => {
  let result = "";

  for (let i = 0; i < ORDER_NUMBER_LENGTH; i++) {
    result += CHARACTERS[randomInt(CHARACTERS.length)];
  }

  return result;
};

const isUniqueConstraintError = (error: unknown): boolean => {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
};

const orderNumberExists = async (orderNumber: string): Promise<boolean> => {
  const [groupPurchase, appointment, payment] = await Promise.all([
    prisma.groupPurchase.findUnique({
      where: { orderNumber },
      select: { id: true },
    }),
    prisma.appointment.findUnique({
      where: { orderNumber },
      select: { id: true },
    }),
    prisma.payment.findFirst({
      where: { orderNumber },
      select: { id: true },
    }),
  ]);

  return Boolean(groupPurchase || appointment || payment);
};

const backfillGroupPurchaseOrderNumbers = async () => {
  const isDryRun = process.argv.includes("--dry-run");

  console.log("======================================");
  console.log("Group Purchase Order Number Backfill");
  console.log(`Mode: ${isDryRun ? "DRY RUN" : "LIVE"}`);
  console.log("======================================");

  const purchases = await prisma.groupPurchase.findMany({
    where: {
      orderNumber: null,
    },
    select: {
      id: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  console.log(`Legacy purchases found: ${purchases.length}`);

  if (isDryRun) {
    console.log("Dry run completed. No changes made.");
    return;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const purchase of purchases) {
    let completed = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const orderNumber = generateOrderNumber();

      try {
        const exists = await orderNumberExists(orderNumber);

        if (exists) {
          continue;
        }

        const result = await prisma.groupPurchase.updateMany({
          where: {
            id: purchase.id,
            orderNumber: null,
          },
          data: {
            orderNumber,
          },
        });

        if (result.count === 1) {
          updated++;

          console.log(`[UPDATED] ${purchase.id} -> ${orderNumber}`);
        } else {
          skipped++;

          console.log(`[SKIPPED] ${purchase.id} already updated`);
        }

        completed = true;
        break;
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          continue;
        }

        console.error(`[ERROR] ${purchase.id}`, error);

        failed++;
        completed = true;
        break;
      }
    }

    if (!completed) {
      failed++;

      console.error(`[FAILED] ${purchase.id}: Maximum retries exceeded`);
    }
  }

  console.log("\n======================================");
  console.log("Backfill Summary");
  console.log("======================================");

  console.log(`Total legacy purchases: ${purchases.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  const remaining = await prisma.groupPurchase.count({
    where: {
      orderNumber: null,
    },
  });

  console.log(`Remaining without order number: ${remaining}`);

  if (failed > 0 || remaining > 0) {
    process.exitCode = 1;
  }
};

backfillGroupPurchaseOrderNumbers()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
