import { PaymentStatus, Prisma } from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import { notificationService } from "../notification/notification.service.js";

const BATCH_SIZE = 100;

const expirePendingGroupPurchases = async () => {
  let expiredCount = 0;

  const now = new Date();

  // Fetch a bounded batch of expired unpaid purchases.
  const purchases = await prisma.groupPurchase.findMany({
    where: {
      paymentStatus: PaymentStatus.PENDING,

      reservationExpiresAt: {
        lte: now,
      },
    },

    select: {
      id: true,
    },

    orderBy: {
      reservationExpiresAt: "asc",
    },

    take: BATCH_SIZE,
  });

  for (const purchase of purchases) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const expired = await prisma.$transaction(
          async (tx) => {
            const current = await tx.groupPurchase.findUnique({
              where: {
                id: purchase.id,
              },

              select: {
                id: true,
                packageId: true,
                customerId: true,
                quantity: true,
                paymentStatus: true,
                reservationExpiresAt: true,
              },
            });

            if (
              !current ||
              current.paymentStatus !== PaymentStatus.PENDING ||
              !current.reservationExpiresAt ||
              current.reservationExpiresAt > new Date()
            ) {
              return false;
            }

            // Change status only if still pending and expired.
            const changed = await tx.groupPurchase.updateMany({
              where: {
                id: current.id,

                paymentStatus: PaymentStatus.PENDING,

                reservationExpiresAt: {
                  lte: new Date(),
                },
              },

              data: {
                paymentStatus: PaymentStatus.FAILED,
              },
            });

            if (changed.count !== 1) {
              return false;
            }

            // Release reserved inventory exactly once.
            const released = await tx.package.updateMany({
              where: {
                id: current.packageId,

                reservedQuantity: {
                  gte: current.quantity,
                },
              },

              data: {
                reservedQuantity: {
                  decrement: current.quantity,
                },
              },
            });

            if (released.count !== 1) {
              throw new AppError(
                "Unable to release expired group purchase inventory",
                409,
              );
            }

            await notificationService.createNotification({
              userId: current.customerId, type: "GROUP_PURCHASE_EXPIRED", title: "Group purchase reservation expired",
              message: "Your group purchase reservation expired because payment was not completed before the deadline.",
            }, tx);
            return true;
          },

          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,

            maxWait: 10000,

            timeout: 15000,
          },
        );

        if (expired) {
          expiredCount++;
        }

        break;
      } catch (error) {
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034";

        if (retryable && attempt < 3) {
          continue;
        }

        throw error;
      }
    }
  }

  return {
    expiredCount,
    scannedCount: purchases.length,
  };
};

export const groupPurchaseExpiryService = {
  expirePendingGroupPurchases,
};
