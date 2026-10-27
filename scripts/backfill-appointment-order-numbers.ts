import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../src/app/lib/prisma.js";
import { generateOrderNumber } from "../src/app/utils/generateOrderNumber.js";

const MAX_ATTEMPTS = 20;

async function main() {
  const appointments = await prisma.appointment.findMany({
    where: {
      orderNumber: null,
    },
    select: {
      id: true,
    },
  });

  console.log(`Appointments needing backfill: ${appointments.length}`);

  let updated = 0;

  for (const appointment of appointments) {
    let success = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const orderNumber = generateOrderNumber();

      try {
        const result = await prisma.appointment.updateMany({
          where: {
            id: appointment.id,
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
      throw new Error(
        `Could not assign order number to appointment ${appointment.id}`,
      );
    }
  }

  const remaining = await prisma.appointment.count({
    where: {
      orderNumber: null,
    },
  });

  console.log(`Updated: ${updated}`);
  console.log(`Remaining without order number: ${remaining}`);

  if (remaining !== 0) {
    throw new Error("Backfill incomplete");
  }
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
