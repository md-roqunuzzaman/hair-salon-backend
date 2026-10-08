import {
  AppointmentStatus,
  BookingMethod,
  ListingStatus,
  PackageStatus,
  PackageType,
  PaymentStatus,
  Prisma,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";

import { AppError } from "../../utils/app-error.js";
import {
  assertBranchHourlyCapacityAvailable,
  assertStaffSlotAvailable,
  minutesToTime,
  timeToMinutes,
} from "../appointment/appointment.service.js";
import { AvailabilityService } from "../availability/availability.service.js";

import { ICreateGroupPurchasePayload } from "./group-purchase.interface.js";

const GROUP_PURCHASE_RESERVATION_MINUTES = 15;

const createGroupPurchase = async (
  customerId: string,
  payload: ICreateGroupPurchasePayload,
) => {
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // Release expired pending reservations for this package
          const expiredPurchases = await tx.groupPurchase.findMany({
            where: {
              packageId: payload.packageId,
              paymentStatus: PaymentStatus.PENDING,
              reservationExpiresAt: {
                lte: now,
              },
            },

            select: {
              id: true,
              quantity: true,
            },
          });

          if (expiredPurchases.length > 0) {
            const expiredQuantity = expiredPurchases.reduce(
              (total, purchase) => total + purchase.quantity,
              0,
            );

            await tx.groupPurchase.updateMany({
              where: {
                id: {
                  in: expiredPurchases.map((purchase) => purchase.id),
                },
                paymentStatus: PaymentStatus.PENDING,
              },

              data: {
                paymentStatus: PaymentStatus.FAILED,
              },
            });

            const packageForRelease = await tx.package.findUnique({
              where: {
                id: payload.packageId,
              },

              select: {
                reservedQuantity: true,
              },
            });

            if (packageForRelease) {
              const releaseQuantity = Math.min(
                expiredQuantity,
                packageForRelease.reservedQuantity,
              );

              if (releaseQuantity > 0) {
                await tx.package.update({
                  where: {
                    id: payload.packageId,
                  },

                  data: {
                    reservedQuantity: {
                      decrement: releaseQuantity,
                    },
                  },
                });
              }
            }
          }

          // Get package
          const packageData = await tx.package.findUnique({
            where: {
              id: payload.packageId,
            },
          });

          if (!packageData) {
            throw new AppError("Package not found", 404);
          }

          // Must be group purchase package
          if (packageData.type !== PackageType.GROUP_PURCHASE_PACKAGE) {
            throw new AppError(
              "Selected package is not a group purchase package",
              400,
            );
          }

          // Must be ACTIVE
          if (packageData.status !== PackageStatus.ACTIVE) {
            throw new AppError("Package is inactive", 422);
          }

          // Must be LISTED
          if (packageData.listingStatus !== ListingStatus.LISTED) {
            throw new AppError("Package is delisted", 422);
          }

          // Group Purchase configuration must exist
          if (
            packageData.capacity === null ||
            packageData.purchaseLimitPerCustomer === null ||
            packageData.salesStartAt === null ||
            packageData.salesEndAt === null
          ) {
            throw new AppError(
              "Group purchase package configuration is incomplete",
              422,
            );
          }

          // Sales window
          if (now < packageData.salesStartAt || now > packageData.salesEndAt) {
            throw new AppError(
              "Group purchase is not currently available",
              422,
            );
          }

          // Remaining capacity
          const remainingQuantity =
            packageData.capacity -
            packageData.soldQuantity -
            packageData.reservedQuantity;

          if (remainingQuantity <= 0) {
            throw new AppError("Package is sold out", 409);
          }

          if (payload.quantity > remainingQuantity) {
            throw new AppError(
              "Requested quantity exceeds remaining package capacity",
              409,
            );
          }

          // Customer previous PAID + active PENDING quantity
          const purchaseSummary = await tx.groupPurchase.aggregate({
            where: {
              customerId,
              packageId: payload.packageId,

              OR: [
                {
                  paymentStatus: PaymentStatus.PAID,
                },

                {
                  paymentStatus: PaymentStatus.PENDING,

                  reservationExpiresAt: {
                    gt: now,
                  },
                },
              ],
            },

            _sum: {
              quantity: true,
            },
          });

          const currentCustomerQuantity = purchaseSummary._sum.quantity ?? 0;

          if (
            currentCustomerQuantity + payload.quantity >
            packageData.purchaseLimitPerCustomer
          ) {
            throw new AppError(
              "Group purchase limit per customer exceeded",
              422,
            );
          }

          // Reserve capacity
          await tx.package.update({
            where: {
              id: packageData.id,
            },

            data: {
              reservedQuantity: {
                increment: payload.quantity,
              },
            },
          });

          // Price snapshot
          const unitPrice = Number(packageData.packagePrice);

          const amount = unitPrice * payload.quantity;

          const reservationExpiresAt = new Date(
            now.getTime() + GROUP_PURCHASE_RESERVATION_MINUTES * 60 * 1000,
          );

          const groupPurchase = await tx.groupPurchase.create({
            data: {
              customerId,
              packageId: packageData.id,

              quantity: payload.quantity,

              unitPrice,
              amount,

              paymentStatus: PaymentStatus.PENDING,

              reservationExpiresAt,
            },
          });

          return {
            purchaseId: groupPurchase.id,
            packageId: groupPurchase.packageId,
            quantity: groupPurchase.quantity,
            unitPrice: Number(groupPurchase.unitPrice),
            amount: Number(groupPurchase.amount),
            paymentStatus: groupPurchase.paymentStatus,
          };
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < maxRetries
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError("Unable to process group purchase. Please try again", 409);
};

const getMyGroupPurchases = async (
  customerId: string,
  query: Record<string, any>,
) => {
  const limit = query.limit ? Number(query.limit) : 20;
  const page = query.page ? Number(query.page) : 1;
  const skip = (page - 1) * limit;

  const purchases = await prisma.groupPurchase.findMany({
    where: {
      customerId,
    },

    take: limit,
    skip,

    orderBy: {
      createdAt: "desc",
    },

    include: {
      package: {
        select: {
          id: true,
          name: true,
          type: true,

          images: {
            where: {
              isPrimary: true,
            },

            take: 1,

            select: {
              objectKey: true,
            },
          },
        },
      },
    },
  });

  const totalPurchaseCount = await prisma.groupPurchase.count({
    where: {
      customerId,
    },
  });

  return {
    items: purchases.map((purchase) => ({
      id: purchase.id,

      package: {
        id: purchase.package.id,
        name: purchase.package.name,
        type: purchase.package.type,

        primaryImageObjectKey: purchase.package.images[0]?.objectKey || null,
      },

      quantity: purchase.quantity,

      unitPrice: Number(purchase.unitPrice),

      amount: Number(purchase.amount),

      paymentStatus: purchase.paymentStatus,

      reservationExpiresAt: purchase.reservationExpiresAt,

      purchasedAt: purchase.purchasedAt,

      createdAt: purchase.createdAt,
    })),

    pagination: {
      page,
      limit,
      total: totalPurchaseCount,
      totalPages: Math.ceil(totalPurchaseCount / limit),

      hasNextPage: page < Math.ceil(totalPurchaseCount / limit),

      hasPreviousPage: page > 1,
    },
  };
};

const getGroupPurchaseById = async (
  purchaseId: string,
  userId: string,
  role: string,
) => {
  const purchase = await prisma.groupPurchase.findUnique({
    where: {
      id: purchaseId,
    },

    include: {
      package: {
        select: {
          id: true,
          name: true,
          type: true,
          regularPrice: true,
          packagePrice: true,
          durationMinutes: true,

          images: {
            orderBy: {
              sortOrder: "asc",
            },

            select: {
              objectKey: true,
              isPrimary: true,
              sortOrder: true,
            },
          },

          services: {
            include: {
              service: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },

          branches: {
            include: {
              branch: {
                select: {
                  id: true,
                  name: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!purchase) {
    throw new AppError("Group purchase not found", 404);
  }

  // Customer can only see own purchase
  if (role === "CUSTOMER" && purchase.customerId !== userId) {
    throw new AppError(
      "You are not allowed to access this group purchase",
      403,
    );
  }

  return {
    id: purchase.id,

    package: {
      id: purchase.package.id,
      name: purchase.package.name,
      type: purchase.package.type,

      regularPrice: Number(purchase.package.regularPrice),

      packagePrice: Number(purchase.package.packagePrice),

      durationMinutes: purchase.package.durationMinutes,

      primaryImageObjectKey:
        purchase.package.images.find((image) => image.isPrimary)?.objectKey ??
        purchase.package.images[0]?.objectKey ??
        null,

      images: purchase.package.images.map((image) => ({
        objectKey: image.objectKey,
        isPrimary: image.isPrimary,
        sortOrder: image.sortOrder,
      })),

      services: purchase.package.services.map((item) => ({
        id: item.service.id,
        name: item.service.name,
      })),

      branches: purchase.package.branches.map((item) => ({
        id: item.branch.id,
        name: item.branch.name,
      })),
    },

    quantity: purchase.quantity,

    unitPrice: Number(purchase.unitPrice),

    amount: Number(purchase.amount),

    paymentStatus: purchase.paymentStatus,

    reservationExpiresAt: purchase.reservationExpiresAt,

    purchasedAt: purchase.purchasedAt,

    createdAt: purchase.createdAt,
  };
};

type ICreateGroupPurchaseAppointmentPayload = {
  branchId: string;
  staffId?: string;
  date: string;
  startTime: string;
};

const createGroupPurchaseAppointment = async (
  customerId: string,
  purchaseId: string,
  payload: ICreateGroupPurchaseAppointmentPayload,
) => {
  const { branchId, staffId, date, startTime } = payload;

  // 1. Verify purchased package
  const purchase = await prisma.groupPurchase.findUnique({
    where: { id: purchaseId },
    include: {
      package: {
        select: {
          id: true,
          name: true,
          durationMinutes: true,
          status: true,
        },
      },
    },
  });

  if (!purchase) {
    throw new AppError("Group purchase not found", 404);
  }

  if (purchase.customerId !== customerId) {
    throw new AppError("Access denied", 403);
  }

  if (purchase.paymentStatus !== PaymentStatus.PAID) {
    throw new AppError("Group purchase is not paid", 400);
  }

  // 2. Check availability
  const availability = await AvailabilityService.getAvailableSlots({
    branchId,
    packageId: purchase.packageId,
    ...(staffId ? { staffId } : {}),
    date,
  });

  const requestedSlot = availability.slots.find(
    (slot) =>
      slot.startTime === startTime &&
      slot.available &&
      (!staffId || slot.staffId === staffId),
  );

  if (!requestedSlot) {
    throw new AppError("The selected time slot is no longer available", 409);
  }

  const resolvedStaffId = staffId ?? requestedSlot.staffId;
  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // 3. Serializable transaction
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const currentPurchase = await tx.groupPurchase.findUnique({
            where: { id: purchaseId },
            include: {
              package: {
                select: {
                  id: true,
                  name: true,
                  durationMinutes: true,
                  status: true,
                  branches: {
                    where: { branchId },
                    select: { branchId: true },
                  },
                },
              },
            },
          });

          if (
            !currentPurchase ||
            currentPurchase.customerId !== customerId ||
            currentPurchase.paymentStatus !== PaymentStatus.PAID
          ) {
            throw new AppError(
              "Group purchase is not eligible for booking",
              400,
            );
          }

          if (currentPurchase.package.status !== PackageStatus.ACTIVE) {
            throw new AppError("Package is inactive", 400);
          }

          if (currentPurchase.package.branches.length === 0) {
            throw new AppError("Package is not available at this branch", 400);
          }

          // 4. Check remaining purchased quantity
          const allocatedCount = await tx.appointment.count({
            where: {
              groupPurchaseId: purchaseId,
              appointmentStatus: {
                not: AppointmentStatus.CANCELLED,
              },
            },
          });

          if (allocatedCount >= currentPurchase.quantity) {
            throw new AppError("No remaining package quantity available", 409);
          }

          // 5. Calculate requested time
          const durationMinutes = currentPurchase.package.durationMinutes;

          const requestedStart = timeToMinutes(startTime);
          const requestedEnd = requestedStart + durationMinutes;
          const endTime = minutesToTime(requestedEnd);
          const now = new Date();

          // 6. Final availability checks
          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          await assertBranchHourlyCapacityAvailable(
            tx,
            branchId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          // 7. Create confirmed appointment
          const appointment = await tx.appointment.create({
            data: {
              customerId,
              branchId,
              staffId: resolvedStaffId,

              serviceId: null,
              packageId: currentPurchase.packageId,
              groupPurchaseId: purchaseId,

              bookingMethod: BookingMethod.GROUP_PURCHASE,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              paymentStatus: PaymentStatus.PAID,

              date: dateOnly,
              startTime,
              endTime,

              itemName: currentPurchase.package.name,
              durationMinutes,

              // No additional payment required
              price: new Prisma.Decimal(0),
              currency: "HKD",

              holdExpiresAt: null,
              qrToken: null,
              qrVerifiedAt: null,
              qrVerifiedBy: null,
            },
            select: {
              id: true,
              bookingMethod: true,
              appointmentStatus: true,
              paymentStatus: true,
              staffId: true,
            },
          });

          return {
            appointmentId: appointment.id,
            bookingMethod: appointment.bookingMethod,
            appointmentStatus: appointment.appointmentStatus,
            paymentStatus: appointment.paymentStatus,
            staffId: appointment.staffId,
            qrAvailable: false,
            additionalPaymentRequired: false,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );
    } catch (error) {
      const isConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isConflict && attempt < 3) {
        continue;
      }

      if (isConflict) {
        throw new AppError("Booking conflict. Please try again", 409);
      }

      throw error;
    }
  }

  throw new AppError("Unable to create appointment", 409);
};

export const groupPurchaseService = {
  createGroupPurchase,
  getMyGroupPurchases,
  getGroupPurchaseById,
  createGroupPurchaseAppointment,
};
