import { notificationTemplates } from "../notification/notification.templates.js";
import {
  AppointmentStatus,
  GroupPurchaseFlow,
  PaymentStatus,
  Prisma,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import { notificationService } from "../notification/notification.service.js";

const BATCH_SIZE = 100;

const expirePendingGroupPurchases = async () => {
  let expiredCount = 0;
  let skippedCount = 0;

  const now = new Date();

  // =====================================================
  // 1. FETCH EXPIRED PENDING PURCHASES
  // =====================================================

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

  // =====================================================
  // 2. PROCESS EACH PURCHASE
  // =====================================================

  for (const purchase of purchases) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const expired = await prisma.$transaction(
          async (tx) => {
            const currentNow = new Date();

            // =============================================
            // 3. REFETCH PURCHASE INSIDE TRANSACTION
            // =============================================

            const current = await tx.groupPurchase.findUnique({
              where: {
                id: purchase.id,
              },
              select: {
                id: true,
                packageId: true,
                customerId: true,
                quantity: true,
                purchaseFlow: true,
                bookingMethod: true,
                paymentStatus: true,
                reservationExpiresAt: true,
                appointments: {
                  select: {
                    id: true,
                    bookingMethod: true,
                    appointmentStatus: true,
                    paymentStatus: true,
                  },
                },
              },
            });

            // =============================================
            // 4. RECHECK EXPIRY ELIGIBILITY
            // =============================================

            if (
              !current ||
              current.paymentStatus !== PaymentStatus.PENDING ||
              !current.reservationExpiresAt ||
              current.reservationExpiresAt > currentNow
            ) {
              return false;
            }

            const isBookNow =
              current.purchaseFlow === GroupPurchaseFlow.DIRECT_BOOK;

            // =============================================
            // 5. VALIDATE LINKED APPOINTMENT
            // =============================================

            const initialAppointments = current.appointments.filter(item => item.bookingMethod === current.bookingMethod);
            if (isBookNow) {
              if (initialAppointments.length !== 1) {
                throw new AppError(
                  "Book Now purchase must have exactly one initial appointment",
                  409,
                );
              }

              const linkedAppointment = initialAppointments[0];

              if (
                linkedAppointment.appointmentStatus !==
                  AppointmentStatus.PENDING_PAYMENT ||
                linkedAppointment.paymentStatus !== PaymentStatus.PENDING
              ) {
                throw new AppError(
                  "Book Now appointment is not in an expirable state",
                  409,
                );
              }
            }

            // =============================================
            // 6. CLAIM PURCHASE EXPIRY ATOMICALLY
            // =============================================

            const changed = await tx.groupPurchase.updateMany({
              where: {
                id: current.id,
                paymentStatus: PaymentStatus.PENDING,
                reservationExpiresAt: {
                  lte: currentNow,
                },
              },
              data: {
                paymentStatus: PaymentStatus.FAILED,
                reservationExpiresAt: null,
              },
            });

            if (changed.count !== 1) {
              return false;
            }

            // =============================================
            // 7. EXPIRE BOOK NOW APPOINTMENT
            // =============================================

            if (isBookNow) {
              const linkedAppointment = initialAppointments[0];

              const appointmentChanged = await tx.appointment.updateMany({
                where: {
                  id: linkedAppointment.id,
                  groupPurchaseId: current.id,
                  appointmentStatus: AppointmentStatus.PENDING_PAYMENT,
                  paymentStatus: PaymentStatus.PENDING,
                },
                data: {
                  appointmentStatus: AppointmentStatus.EXPIRED,
                  paymentStatus: PaymentStatus.FAILED,
                  holdExpiresAt: null,
                  qrToken: null,
                },
              });

              if (appointmentChanged.count !== 1) {
                throw new AppError(
                  "Unable to expire linked Book Now appointment",
                  409,
                );
              }
            }

            // =============================================
            // 8. RELEASE RESERVED INVENTORY
            // =============================================

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

            // =============================================
            // 9. CUSTOMER NOTIFICATION
            // =============================================

            await notificationService.createNotification(
              {
                userId: current.customerId,
                type: "GROUP_PURCHASE_EXPIRED",
                title: "Group purchase reservation expired",
                message:
                  "Your group purchase reservation expired because payment was not completed before the deadline.",
                translations: notificationTemplates.GROUP_PURCHASE_EXPIRED(),
              },
              tx,
            );

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
        } else {
          skippedCount++;
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
    skippedCount,
    scannedCount: purchases.length,
  };
};

export const groupPurchaseExpiryService = {
  expirePendingGroupPurchases,
};
