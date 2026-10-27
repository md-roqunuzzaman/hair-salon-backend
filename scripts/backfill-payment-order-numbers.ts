import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/app/lib/prisma.js";
import { generateOrderNumber } from "../src/app/utils/generateOrderNumber.js";

const MAX_ATTEMPTS = 20;

async function main() {
  // =====================================================
  // 1. FIND PAYMENTS WITHOUT ORDER NUMBER
  // =====================================================

  const payments = await prisma.payment.findMany({
    where: {
      orderNumber: null,
    },
    select: {
      id: true,
    },
  });

  console.log(`Payments needing backfill: ${payments.length}`);

  let updated = 0;

  // =====================================================
  // 2. ASSIGN UNIQUE ORDER NUMBER
  // =====================================================

  for (const payment of payments) {
    let success = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const orderNumber = generateOrderNumber();

      try {
        const result = await prisma.payment.updateMany({
          where: {
            id: payment.id,
            orderNumber: null,
          },
          data: {
            orderNumber,
          },
        });

        if (result.count === 1) {
          updated++;
        }

        success = true;
        break;
      } catch (error) {
        const isUniqueCollision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002";

        if (isUniqueCollision && attempt < MAX_ATTEMPTS) {
          continue;
        }

        throw error;
      }
    }

    if (!success) {
      throw new Error(`Could not assign order number to payment ${payment.id}`);
    }
  }

  // =====================================================
  // 3. VERIFY BACKFILL
  // =====================================================

  const remaining = await prisma.payment.count({
    where: {
      orderNumber: null,
    },
  });

  console.log(`Updated: ${updated}`);
  console.log(`Remaining without order number: ${remaining}`);

  if (remaining !== 0) {
    throw new Error("Payment order number backfill incomplete");
  }
}

main()
  .catch((error) => {
    console.error("Payment backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
