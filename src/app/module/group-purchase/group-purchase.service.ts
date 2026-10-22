import config from "../../config/index.js";
import { notificationService } from "../notification/notification.service.js";
import {
  AppointmentStatus,
  BookingMethod,
  GroupPurchaseFlow,
  ListingStatus,
  PackageStatus,
  PackageType,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  RefundStatus,
  Role,
  SalonPaymentMethod,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import crypto from "node:crypto";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import {
  assertBranchHourlyCapacityAvailable,
  assertStaffSlotAvailable,
  minutesToTime,
  resolveAvailableStaff,
  timeToMinutes,
} from "../appointment/appointment.service.js";
import { AvailabilityService } from "../availability/availability.service.js";
import { uploadService } from "../upload/upload.service.js";

import { ICreateGroupPurchasePayload } from "./group-purchase.interface.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { notificationTemplates } from "../notification/notification.templates.js";
import { presentGroupPurchase } from "./group-purchase.presentation.js";

const initialAppointmentSelect = {
  id: true, bookingMethod: true, appointmentStatus: true, paymentStatus: true,
  branchId: true, staffId: true, date: true, startTime: true, endTime: true, qrVerifiedAt: true,
} as const;
const presentInitialAppointment = <T extends { id: string; bookingMethod: BookingMethod }>(appointments: T[], method: BookingMethod | null) => {
  const appointment = appointments.find(item => item.bookingMethod === method);
  return appointment ? { ...appointment, appointmentId: appointment.id } : null;
};

const GROUP_PURCHASE_RESERVATION_MINUTES = 5;

const createGroupPurchase = async (
  customerId: string,
  payload: ICreateGroupPurchasePayload,
) => {
  const maxRetries = 3;


  const purchaseFlow =
    payload.purchaseFlow ?? GroupPurchaseFlow.BUY_NOW_BOOK_LATER;

  const isBookNow = purchaseFlow === GroupPurchaseFlow.BUY_NOW_BOOK_NOW;

  // =====================================================
  // 1. VALIDATE REQUEST
  // =====================================================

  if (
    purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_LATER &&
    purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_NOW
  ) {
    throw new AppError("Invalid purchase flow", 400);
  }

  if (!Number.isSafeInteger(payload.quantity) || payload.quantity < 1) {
    throw new AppError("Quantity must be a positive integer", 400);
  }

  if (isBookNow && !config.enable_book_now_purchase) {
    throw new AppError("Book Now payment integration is not enabled yet", 422);
  }

  if (isBookNow) {
    if (
      !payload.bookingMethod ||
      !payload.branchId ||
      !payload.date ||
      !payload.startTime
    ) {
      throw new AppError(
        "bookingMethod, branchId, date and startTime are required",
        400,
      );
    }

    if (
      payload.bookingMethod !== BookingMethod.PAY_NOW &&
      payload.bookingMethod !== BookingMethod.DEPOSIT &&
      payload.bookingMethod !== BookingMethod.RESERVE_NOW
    ) {
      throw new AppError("Invalid booking method", 400);
    }

    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.date) ||
      !/^\d{2}:\d{2}$/.test(payload.startTime)
    ) {
      throw new AppError("Invalid appointment date or time", 400);
    }
  } else if (
    payload.bookingMethod ||
    payload.branchId ||
    payload.staffId ||
    payload.date ||
    payload.startTime
  ) {
    throw new AppError("Booking details are not allowed for Buy Later", 400);
  }

  // =====================================================
  // 2. PRECHECK AVAILABLE SLOT FOR BOOK NOW
  // =====================================================

  if (isBookNow) {
    const availability = await AvailabilityService.getAvailableSlots({
      branchId: payload.branchId!,
      packageId: payload.packageId,
      staffId: payload.staffId ?? undefined,
      date: payload.date!,
    });

    const requestedSlot = availability.slots.find(
      (slot) =>
        slot.startTime === payload.startTime &&
        slot.available === true &&
        (!payload.staffId || slot.staffId === payload.staffId),
    );

    if (!requestedSlot) {
      throw new AppError("Selected appointment slot is unavailable", 409);
    }
  }

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION
  // =====================================================

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // =================================================
          // 4. LOAD PACKAGE
          // =================================================

          const packageData = await tx.package.findUnique({
            where: {
              id: payload.packageId,
            },
          });

          if (!packageData) {
            throw new AppError("Package not found", 404);
          }
          if (packageData.type !== PackageType.GROUP_PURCHASE_PACKAGE) {
            throw new AppError("Package is not a group purchase package", 422);
          }

          if (packageData.status !== PackageStatus.ACTIVE) {
            throw new AppError("Package is inactive", 422);
          }

          if (packageData.listingStatus !== ListingStatus.LISTED) {
            throw new AppError("Package is delisted", 422);
          }

          if (packageData.salesStartAt && now < packageData.salesStartAt) {
            throw new AppError("Package sale has not started", 422);
          }

          if (packageData.salesEndAt && now > packageData.salesEndAt) {
            throw new AppError("Package sale has ended", 422);
          }

          // =================================================
          // 5. VALIDATE BOOKING AND BRANCH POLICY
          // =================================================

          let selectedStaffId: string | null = null;
          let appointmentEndTime: string | null = null;
          let appointmentDate: Date | null = null;

          let depositPercentage: Prisma.Decimal | null = null;
          let depositAmount: Prisma.Decimal | null = null;
          let remainingAmount: Prisma.Decimal | null = null;

          const unitPrice = packageData.packagePrice;
          const amount = unitPrice.mul(payload.quantity);

          if (isBookNow) {
            const branch = await tx.branch.findUnique({
              where: {
                id: payload.branchId!,
              },
              include: {
                bookingPolicy: true,
              },
            });

            if (!branch) {
              throw new AppError("Branch not found", 404);
            }

            if (branch.status !== "ACTIVE") {
              throw new AppError("Branch is inactive", 422);
            }

            const packageBranch = await tx.packageBranch.findFirst({
              where: {
                packageId: packageData.id,
                branchId: branch.id,
              },
            });

            if (!packageBranch) {
              throw new AppError(
                "Package is not available at this branch",
                422,
              );
            }

            const policy = branch.bookingPolicy;

            if (!policy) {
              throw new AppError("Branch booking policy not configured", 422);
            }

            const bookingMethod = payload.bookingMethod as BookingMethod;

            if (!policy.allowedBookingMethods.includes(bookingMethod)) {
              throw new AppError(
                `${bookingMethod} booking is not enabled for this branch`,
                422,
              );
            }

            if (bookingMethod === BookingMethod.DEPOSIT) {
              if (!policy.depositEnabled) {
                throw new AppError(
                  "Deposit booking is disabled for this branch",
                  422,
                );
              }

              if (policy.depositPercentage === null) {
                throw new AppError("Deposit percentage is not configured", 422);
              }
              depositPercentage = new Prisma.Decimal(policy.depositPercentage);

              if (depositPercentage.lte(0) || depositPercentage.gte(100)) {
                throw new AppError(
                  "Deposit percentage must be greater than 0 and less than 100",
                  422,
                );
              }

              depositAmount = amount
                .mul(depositPercentage)
                .div(100)
                .toDecimalPlaces(2);

              remainingAmount = amount.sub(depositAmount);

              if (depositAmount.lte(0) || remainingAmount.lte(0)) {
                throw new AppError(
                  "Invalid deposit amount for package purchase",
                  422,
                );
              }
            }

            const requestedStart = timeToMinutes(payload.startTime!);

            const requestedEnd = requestedStart + packageData.durationMinutes;

            if (requestedStart < 0 || requestedEnd > 24 * 60) {
              throw new AppError("Invalid appointment time", 400);
            }

            appointmentEndTime = minutesToTime(requestedEnd);

            appointmentDate = new Date(`${payload.date}T00:00:00.000Z`);

            if (Number.isNaN(appointmentDate.getTime())) {
              throw new AppError("Invalid appointment date", 400);
            }

            // Recheck staff eligibility and slot availability
            // inside the Serializable transaction.
            const resolvedStaff = await resolveAvailableStaff({
              tx,
              branchId: branch.id,
              packageId: packageData.id,
              staffId: payload.staffId ?? undefined,
              date: payload.date!,
              dateOnly: appointmentDate,
              requestedStart,
              requestedEnd,
              now,
            });

            selectedStaffId = resolvedStaff;

            await assertBranchHourlyCapacityAvailable(
              tx,
              branch.id,
              payload.date!,
              appointmentDate,
              requestedStart,
              requestedEnd,
              now,
            );
          }

          // =================================================
          // 6. RELEASE EXPIRED BUY-LATER RESERVATIONS
          // =================================================

          const expiredPurchases = await tx.groupPurchase.findMany({
            where: {
              packageId: packageData.id,
              purchaseFlow: GroupPurchaseFlow.BUY_NOW_BOOK_LATER,
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

          let releasedQuantity = 0;

          if (expiredPurchases.length > 0) {
            releasedQuantity = expiredPurchases.reduce(
              (total, purchase) => total + purchase.quantity,
              0,
            );

            const changed = await tx.groupPurchase.updateMany({
              where: {
                id: {
                  in: expiredPurchases.map((p) => p.id),
                },
                purchaseFlow: GroupPurchaseFlow.BUY_NOW_BOOK_LATER,
                paymentStatus: PaymentStatus.PENDING,
                reservationExpiresAt: {
                  lte: now,
                },
              },
              data: {
                paymentStatus: PaymentStatus.FAILED,
              },
            });

            if (changed.count !== expiredPurchases.length) {
              throw new AppError(
                "Purchase reservation changed during expiry processing",
                409,
              );
            }

            const released = await tx.package.updateMany({
              where: {
                id: packageData.id,
                reservedQuantity: {
                  gte: releasedQuantity,
                },
              },
              data: {
                reservedQuantity: {
                  decrement: releasedQuantity,
                },
              },
            });

            if (released.count !== 1) {
              throw new AppError(
                "Unable to release expired package inventory",
                409,
              );
            }
          }

          // =================================================
          // 7. CHECK PACKAGE CAPACITY
          // =================================================

          if (packageData.capacity !== null) {
            const remainingQuantity =
              packageData.capacity -
              packageData.soldQuantity -
              packageData.reservedQuantity +
              releasedQuantity;

            if (payload.quantity > remainingQuantity) {
              throw new AppError(
                "Requested quantity exceeds remaining package capacity",
                409,
              );
            }
          }

          // =================================================
          // 8. CUSTOMER PURCHASE LIMIT
          // =================================================

          if (packageData.purchaseLimitPerCustomer !== null) {
            const summary = await tx.groupPurchase.aggregate({
              where: {
                customerId,
                packageId: packageData.id,
                OR: [
                  {
                    paymentStatus: {
                      in: [
                        PaymentStatus.PAID,
                        PaymentStatus.PARTIALLY_PAID,
                        PaymentStatus.UNPAID,
                      ],
                    },
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

            const currentQuantity = summary._sum.quantity ?? 0;

            if (
              currentQuantity + payload.quantity >
              packageData.purchaseLimitPerCustomer
            ) {
              throw new AppError(
                "Package purchase limit per customer exceeded",
                422,
              );
            }
          }

          // =================================================
          // 9. RESERVE OR SELL INVENTORY
          // =================================================

          const isReserveNow =
            isBookNow && payload.bookingMethod === BookingMethod.RESERVE_NOW;

          const inventoryUpdated = await tx.package.updateMany({
            where: {
              id: packageData.id,
              ...(packageData.capacity !== null
                ? {
                    soldQuantity: {
                      lte:
                        packageData.capacity -
                        packageData.reservedQuantity +
                        releasedQuantity -
                        payload.quantity,
                    },
                  }
                : {}),
            },
            data: isReserveNow
              ? {
                  soldQuantity: {
                    increment: payload.quantity,
                  },
                }
              : {
                  reservedQuantity: {
                    increment: payload.quantity,
                  },
                },
          });

          if (inventoryUpdated.count !== 1) {
            throw new AppError("Unable to reserve package inventory", 409);
          }

          // =================================================
          // 10. PURCHASE PAYMENT STATE
          // =================================================

          const purchasePaymentStatus = isReserveNow
            ? PaymentStatus.UNPAID
            : PaymentStatus.PENDING;

          const reservationExpiresAt = isReserveNow
            ? null
            : new Date(
                now.getTime() + GROUP_PURCHASE_RESERVATION_MINUTES * 60 * 1000,
              );

          // =================================================
          // 11. CREATE GROUP PURCHASE
          // =================================================

          const groupPurchase = await tx.groupPurchase.create({
            data: {
              customerId,
              packageId: packageData.id,
              purchaseFlow,
              bookingMethod: isBookNow
                ? (payload.bookingMethod as BookingMethod)
                : null,
              quantity: payload.quantity,
              unitPrice,
              amount,
              paymentStatus: purchasePaymentStatus,
              reservationExpiresAt,
              depositPercentage,
              depositAmount,
              remainingAmount,
            },
          });

          // =================================================
          // 12. CREATE FIRST BOOK NOW APPOINTMENT
          // =================================================

          let firstAppointment = null;

          if (isBookNow) {
            if (!selectedStaffId || !appointmentDate || !appointmentEndTime) {
              throw new AppError("Unable to resolve appointment details", 409);
            }

            const bookingMethod = payload.bookingMethod as BookingMethod;

            const appointmentStatus = isReserveNow
              ? AppointmentStatus.RESERVED
              : AppointmentStatus.PENDING_PAYMENT;

            const appointmentPaymentStatus = isReserveNow
              ? PaymentStatus.UNPAID
              : PaymentStatus.PENDING;

            const qrToken = isReserveNow
              ? crypto.randomBytes(32).toString("hex")
              : null;

            const appointment = await tx.appointment.create({
              data: {
                customerId,
                branchId: payload.branchId!,
                staffId: selectedStaffId,
                packageId: packageData.id,
                groupPurchaseId: groupPurchase.id,
                bookingMethod,
                appointmentStatus,
                paymentStatus: appointmentPaymentStatus,
                date: appointmentDate,
                startTime: payload.startTime!,
                endTime: appointmentEndTime,
                durationMinutes: packageData.durationMinutes,
                itemName: packageData.name,
                itemNameTranslations:
                  packageData.translations ?? Prisma.JsonNull,
                price: new Prisma.Decimal(0),
                currency: "HKD",
                holdExpiresAt: reservationExpiresAt,
                qrToken,
                depositPercentage,
                depositAmount,
                remainingAmount,
              },
            });

            firstAppointment = {
              appointmentId: appointment.id,
              appointmentStatus: appointment.appointmentStatus,
              paymentStatus: appointment.paymentStatus,
              branchId: appointment.branchId,
              staffId: appointment.staffId,
              date: appointment.date,
              startTime: appointment.startTime,
              endTime: appointment.endTime,
              qrToken: appointment.qrToken,
            };
          }

          // =================================================
          // 13. RESPONSE
          // =================================================

          return {
            ...presentGroupPurchase(groupPurchase),
            purchaseId: groupPurchase.id,
            packageId: groupPurchase.packageId,
            purchaseFlow: groupPurchase.purchaseFlow,
            bookingMethod: groupPurchase.bookingMethod,
            quantity: groupPurchase.quantity,
            unitPrice: Number(groupPurchase.unitPrice),
            amount: Number(groupPurchase.amount),
            paymentStatus: groupPurchase.paymentStatus,
            reservationExpiresAt: groupPurchase.reservationExpiresAt,
            depositPercentage:
              groupPurchase.depositPercentage === null
                ? null
                : Number(groupPurchase.depositPercentage),
            depositAmount:
              groupPurchase.depositAmount === null
                ? null
                : Number(groupPurchase.depositAmount),
            remainingAmount:
              groupPurchase.remainingAmount === null
                ? null
                : Number(groupPurchase.remainingAmount),
            firstAppointment,
            redemption: {
              purchasedQuantity: groupPurchase.quantity,
              redeemedQuantity: isBookNow ? 1 : 0,
              remainingQuantity: groupPurchase.quantity - (isBookNow ? 1 : 0),
              canBookAppointment: false,
            },
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

      if (isConflict && attempt < maxRetries) {
        continue;
      }

      if (isConflict) {
        throw new AppError("Purchase conflict. Please try again", 409);
      }

      throw error;
    }
  }

  throw new AppError("Unable to process group purchase. Please try again", 409);
};

const getMyGroupPurchases = async (
  customerId: string,
  query: Record<string, any>,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. PAGINATION VALIDATION
  // =====================================================

  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be a positive integer", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. STATUS FILTER VALIDATION
  // =====================================================

  const status = query.status as string | undefined;

  if (status !== undefined && status !== "ACTIVE" && status !== "EXPIRED") {
    throw new AppError("status must be ACTIVE or EXPIRED", 400);
  }

  const now = new Date();

  // =====================================================
  // 3. DEFINE EXPIRED CONDITION
  // =====================================================

  // Existing Group Purchase lifecycle:
  //
  // PENDING + deadline passed -> expired
  // FAILED                    -> expired
  // PAID                      -> not payment-expired
  //
  // FAILED is treated as expired because the existing
  // expiry and late-payment flows use this status.

  const expiredCondition: Prisma.GroupPurchaseWhereInput = {
    OR: [
      {
        paymentStatus: PaymentStatus.FAILED,
      },
      {
        paymentStatus: PaymentStatus.PENDING,

        reservationExpiresAt: {
          lte: now,
        },
      },
    ],
  };

  // =====================================================
  // 4. BUILD CUSTOMER FILTER
  // =====================================================

  const where: Prisma.GroupPurchaseWhereInput = {
    customerId,

    ...(status === "ACTIVE"
      ? {
          NOT: expiredCondition,
        }
      : {}),

    ...(status === "EXPIRED"
      ? {
          AND: [expiredCondition],
        }
      : {}),
  };

  // =====================================================
  // 5. FETCH CUSTOMER GROUP PURCHASES + COUNT
  // =====================================================

  const [purchases, totalPurchaseCount] = await prisma.$transaction([
    prisma.groupPurchase.findMany({
      where,

      take: limit,
      skip,

      orderBy: {
        createdAt: "desc",
      },

      include: {
        appointments: { select: initialAppointmentSelect },
        package: {
          select: {
            id: true,
            name: true,
            translations: true,
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
    }),

    prisma.groupPurchase.count({
      where,
    }),
  ]);

  // =====================================================
  // 6. GET REDEMPTION COUNTS FOR CURRENT PAGE
  // =====================================================

  const purchaseIds = purchases.map((purchase) => purchase.id);

  const redemptionCounts =
    purchaseIds.length > 0
      ? await prisma.appointment.groupBy({
          by: ["groupPurchaseId"],

          where: {
            groupPurchaseId: {
              in: purchaseIds,
            },

            appointmentStatus: {
              not: AppointmentStatus.CANCELLED,
            },
          },

          _count: {
            _all: true,
          },
        })
      : [];

  // Avoid separate count queries for every purchase.

  const redemptionCountMap = new Map(
    redemptionCounts.map((item) => [item.groupPurchaseId, item._count._all]),
  );

  // =====================================================
  // 7. GENERATE SIGNED PRIMARY IMAGE URLS
  // =====================================================

  // Same package can appear in multiple purchases.
  // Generate a signed URL once per unique object key.

  const imageKeys = [
    ...new Set(
      purchases
        .map((purchase) => purchase.package.images[0]?.objectKey)
        .filter((key): key is string => Boolean(key)),
    ),
  ];

  const signedImageEntries = await Promise.all(
    imageKeys.map(async (objectKey) => {
      const imageUrl = await uploadService.getImageUrl(objectKey);

      return [objectKey, imageUrl] as const;
    }),
  );

  const signedImageMap = new Map(signedImageEntries);

  // =====================================================
  // 8. BUILD MULTILINGUAL RESPONSE
  // =====================================================

  const items = purchases.map((purchase) => {
    // ===================================================
    // 8.1 LOCALIZED PACKAGE NAME
    // ===================================================

    const localizedPackage = getLocalizedContent(
      purchase.package.translations,
      language,
      {
        name: purchase.package.name,
      },
    );

    // ===================================================
    // 8.2 PAYMENT EXPIRY
    // ===================================================

    const deadlinePassed =
      purchase.reservationExpiresAt !== null &&
      purchase.reservationExpiresAt <= now;

    const paymentExpired =
      purchase.paymentStatus === PaymentStatus.FAILED ||
      (purchase.paymentStatus === PaymentStatus.PENDING && deadlinePassed);

    // Keep actual database payment status unchanged.
    // The scheduled expiry job persists FAILED and
    // releases reserved inventory.

    const effectivePaymentStatus =
      paymentExpired && purchase.paymentStatus === PaymentStatus.PENDING
        ? PaymentStatus.FAILED
        : purchase.paymentStatus;

    // ===================================================
    // 8.3 REDEMPTION SUMMARY
    // ===================================================

    const purchasedQuantity = purchase.quantity;

    const redeemedQuantity = redemptionCountMap.get(purchase.id) ?? 0;

    const remainingQuantity = Math.max(0, purchasedQuantity - redeemedQuantity);

    const canBookAppointment =
      purchase.paymentStatus === PaymentStatus.PAID && remainingQuantity > 0;

    // ===================================================
    // 8.4 PRIMARY IMAGE
    // ===================================================

    const primaryImageObjectKey = purchase.package.images[0]?.objectKey ?? null;

    const primaryImageUrl = primaryImageObjectKey
      ? (signedImageMap.get(primaryImageObjectKey) ?? null)
      : null;

    // ===================================================
    // 8.5 FINAL PURCHASE RESPONSE
    // ===================================================

    return {
      ...presentGroupPurchase(purchase, purchase.appointments.some(item => item.bookingMethod === purchase.bookingMethod && item.qrVerifiedAt !== null)),
      firstAppointment: presentInitialAppointment(purchase.appointments, purchase.bookingMethod),
      id: purchase.id,

      package: {
        id: purchase.package.id,

        name: localizedPackage.name,

        type: purchase.package.type,

        primaryImageObjectKey,

        primaryImageUrl,
      },

      quantity: purchase.quantity,

      unitPrice: Number(purchase.unitPrice),

      amount: Number(purchase.amount),

      // Actual persisted database status.
      paymentStatus: purchase.paymentStatus,

      // Frontend-friendly calculated status.
      effectivePaymentStatus,

      // G5: payment reservation expiry indicator.
      paymentExpired,

      reservationExpiresAt: purchase.reservationExpiresAt,

      purchasedAt: purchase.purchasedAt,

      createdAt: purchase.createdAt,

      redemption: {
        purchasedQuantity,

        redeemedQuantity,

        remainingQuantity,

        canBookAppointment,
      },
    };
  });

  // =====================================================
  // 9. PAGINATION
  // =====================================================

  const totalPages = Math.ceil(totalPurchaseCount / limit);

  return {
    items,

    pagination: {
      page,
      limit,

      total: totalPurchaseCount,

      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};
const getGroupPurchaseById = async (
  purchaseId: string,
  userId: string,
  role: string,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. FETCH GROUP PURCHASE
  // =====================================================

  const purchase = await prisma.groupPurchase.findUnique({
    where: {
      id: purchaseId,
    },

    include: {
      appointments: { select: initialAppointmentSelect },
      package: {
        select: {
          id: true,
          name: true,
          translations: true,
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
                  translations: true,
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
                  translations: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // =====================================================
  // 2. VALIDATE PURCHASE
  // =====================================================

  if (!purchase) {
    throw new AppError("Group purchase not found", 404);
  }

  // Customer can only see own purchase.
  if (role === "CUSTOMER" && purchase.customerId !== userId) {
    throw new AppError(
      "You are not allowed to access this group purchase",
      403,
    );
  }
  if (role === Role.BRANCH_MANAGER) {
    const branches = await prisma.branchManagerBranch.findMany({ where: { userId }, select: { branchId: true } });
    if (!purchase.appointments.some(item => branches.some(branch => branch.branchId === item.branchId))) {
      throw new AppError("You are not allowed to access this group purchase", 403);
    }
  }

  // =====================================================
  // 3. LOCALIZE PACKAGE NAME
  // =====================================================

  const localizedPackage = getLocalizedContent(
    purchase.package.translations,
    language,
    {
      name: purchase.package.name,
    },
  );

  // =====================================================
  // 4. GROUP PURCHASE REDEMPTION SUMMARY
  // =====================================================

  // Keep this status filter consistent with
  // createGroupPurchaseAppointment().
  //
  // CANCELLED appointments do not consume quantity.
  // All other appointment statuses currently do.

  const redeemedQuantity = await prisma.appointment.count({
    where: {
      groupPurchaseId: purchase.id,
      appointmentStatus: {
        not: AppointmentStatus.CANCELLED,
      },
    },
  });

  const purchasedQuantity = purchase.quantity;

  const remainingQuantity = Math.max(0, purchasedQuantity - redeemedQuantity);

  const canBookAppointment =
    purchase.paymentStatus === PaymentStatus.PAID && remainingQuantity > 0;

  // =====================================================
  // 5. RESPONSE WITH MULTILINGUAL CONTENT
  // =====================================================

  return {
    ...presentGroupPurchase(purchase, purchase.appointments.some(item => item.bookingMethod === purchase.bookingMethod && item.qrVerifiedAt !== null)),
    firstAppointment: presentInitialAppointment(purchase.appointments, purchase.bookingMethod),
    id: purchase.id,

    package: {
      id: purchase.package.id,

      // Localized package name
      name: localizedPackage.name,

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

      // =================================================
      // LOCALIZED SERVICES
      // =================================================

      services: purchase.package.services.map((item) => {
        const localizedService = getLocalizedContent(
          item.service.translations,
          language,
          {
            name: item.service.name,
          },
        );

        return {
          id: item.service.id,
          name: localizedService.name,
        };
      }),

      // =================================================
      // LOCALIZED BRANCHES
      // =================================================

      branches: purchase.package.branches.map((item) => {
        const localizedBranch = getLocalizedContent(
          item.branch.translations,
          language,
          {
            name: item.branch.name,
          },
        );

        return {
          id: item.branch.id,
          name: localizedBranch.name,
        };
      }),
    },

    quantity: purchase.quantity,

    unitPrice: Number(purchase.unitPrice),

    amount: Number(purchase.amount),

    paymentStatus: purchase.paymentStatus,

    reservationExpiresAt: purchase.reservationExpiresAt,

    purchasedAt: purchase.purchasedAt,

    createdAt: purchase.createdAt,

    // =====================================================
    // 6. CUSTOMER-FACING REDEMPTION INFORMATION
    // =====================================================

    redemption: {
      purchasedQuantity,
      redeemedQuantity,
      remainingQuantity,
      canBookAppointment,
    },
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

  // =====================================================
  // 1. VERIFY PURCHASED PACKAGE
  // =====================================================

  const purchase = await prisma.groupPurchase.findUnique({
    where: {
      id: purchaseId,
    },
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

  // =====================================================
  // 2. FULL PURCHASE PAYMENT REQUIRED
  // =====================================================

  if (purchase.paymentStatus !== PaymentStatus.PAID) {
    throw new AppError(
      "Full package payment is required before booking another appointment",
      409,
    );
  }

  // =====================================================
  // 3. CHECK AVAILABILITY
  // =====================================================

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

  // =====================================================
  // 4. SERIALIZABLE TRANSACTION + RETRY
  // =====================================================

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 4.1 RECHECK PURCHASE
          // =============================================

          await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id" = ${purchaseId} FOR UPDATE`;
          const currentPurchase = await tx.groupPurchase.findUnique({
            where: {
              id: purchaseId,
            },
            include: {
              package: {
                select: {
                  id: true,
                  name: true,
                  translations: true,
                  durationMinutes: true,
                  status: true,
                  branches: {
                    where: {
                      branchId,
                    },
                    select: {
                      branchId: true,
                    },
                  },
                },
              },
            },
          });

          if (!currentPurchase) {
            throw new AppError("Group purchase not found", 404);
          }

          if (currentPurchase.customerId !== customerId) {
            throw new AppError("Access denied", 403);
          }

          // =============================================
          // 4.2 VERIFY FULL PAYMENT
          // =============================================

          if (currentPurchase.paymentStatus !== PaymentStatus.PAID) {
            throw new AppError(
              "Full package payment is required before booking another appointment",
              409,
            );
          }

          // =============================================
          // 4.3 VALIDATE PACKAGE
          // =============================================

          if (currentPurchase.package.status !== PackageStatus.ACTIVE) {
            throw new AppError("Package is inactive", 400);
          }

          if (currentPurchase.package.branches.length === 0) {
            throw new AppError("Package is not available at this branch", 400);
          }

          // =============================================
          // 5. CHECK REMAINING PURCHASED QUANTITY
          // =============================================

          // Includes the initial BUY_NOW_BOOK_NOW
          // appointment, if one was created.
          //
          // Cancelled appointments follow the existing
          // policy and do not consume package quantity.

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

          // =============================================
          // 6. CALCULATE REQUESTED TIME
          // =============================================

          const durationMinutes = currentPurchase.package.durationMinutes;

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =============================================
          // 7. FINAL AVAILABILITY CHECKS
          // =============================================

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

          // =============================================
          // 8. MULTILINGUAL PACKAGE SNAPSHOT
          // =============================================

          const itemNameTranslations =
            currentPurchase.package.translations === null
              ? undefined
              : (currentPurchase.package.translations as Prisma.InputJsonValue);

          // =============================================
          // 9. CREATE REDEMPTION APPOINTMENT
          // =============================================

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

              ...(itemNameTranslations !== undefined && {
                itemNameTranslations,
              }),

              durationMinutes,

              // Package was already fully paid.
              // No additional charge for redemption.

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

          // =============================================
          // 10. TEAM NOTIFICATION
          // =============================================

          await notificationService.notifyAppointmentTeam(
            appointment.id,
            {
              type: "BOOKING_CREATED",
              title: "New booking",
            },
            tx,
          );

          // =============================================
          // 11. RESPONSE
          // =============================================

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

export const recordGroupPurchaseRemainingPayment = async (
  purchaseId: string,
  payload: {
    paymentMethod: SalonPaymentMethod;
  },
  userId: string,
  role: Role,
) => {
  // =====================================================
  // 1. ROLE AUTHORIZATION
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError(
      "You are not authorized to record group purchase payments",
      403,
    );
  }

  // =====================================================
  // 2. VALIDATE PAYMENT METHOD
  // =====================================================

  if (!Object.values(SalonPaymentMethod).includes(payload.paymentMethod)) {
    throw new AppError("Invalid salon payment method", 400);
  }

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION + RETRY
  // =====================================================

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const now = new Date();

          // =============================================
          // 4. FIND GROUP PURCHASE
          // =============================================

          await tx.$queryRaw`SELECT "id" FROM "GroupPurchase" WHERE "id" = ${purchaseId} FOR UPDATE`;
          const purchase = await tx.groupPurchase.findUnique({
            where: {
              id: purchaseId,
            },
            select: {
              id: true,
              customerId: true,
              amount: true,
              depositAmount: true,
              purchaseFlow: true,
              bookingMethod: true,
              paymentStatus: true,

              appointments: {
                select: {
                  id: true,
                  branchId: true,
                  bookingMethod: true,
                  appointmentStatus: true,
                  paymentStatus: true,
                  qrVerifiedAt: true,
                  createdAt: true,
                },
                orderBy: {
                  createdAt: "asc",
                },
              },
            },
          });

          if (!purchase) {
            throw new AppError("Group purchase not found", 404);
          }

          // =============================================
          // 5. VALIDATE PURCHASE FLOW
          // =============================================

          if (purchase.purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_NOW) {
            throw new AppError(
              "Remaining payment is only available for Book Now purchases",
              400,
            );
          }

          const isDeposit = purchase.bookingMethod === BookingMethod.DEPOSIT;

          const isReserveNow =
            purchase.bookingMethod === BookingMethod.RESERVE_NOW;

          if (!isDeposit && !isReserveNow) {
            throw new AppError(
              "This booking method does not support remaining payment",
              400,
            );
          }

          // =============================================
          // 6. VALIDATE FIRST APPOINTMENT
          // =============================================

          const initialAppointments = purchase.appointments.filter(item => item.bookingMethod === purchase.bookingMethod);
          const appointment = initialAppointments.length === 1 ? initialAppointments[0] : null;

          if (!appointment) {
            throw new AppError("Group purchase appointment not found", 409);
          }

          if (appointment.bookingMethod !== purchase.bookingMethod) {
            throw new AppError(
              "Initial appointment booking method mismatch",
              409,
            );
          }

          // =============================================
          // 7. BRANCH MANAGER AUTHORIZATION
          // =============================================

          if (role === Role.BRANCH_MANAGER) {
            const managerBranch = await tx.branchManagerBranch.findUnique({
              where: {
                userId_branchId: {
                  userId,
                  branchId: appointment.branchId,
                },
              },
            });

            if (!managerBranch) {
              throw new AppError(
                "You are not authorized to record payments for this branch",
                403,
              );
            }
          }

          // =============================================
          // 8. VALIDATE PURCHASE PAYMENT STATUS
          // =============================================

          const expectedPaymentStatus = isDeposit
            ? PaymentStatus.PARTIALLY_PAID
            : PaymentStatus.UNPAID;

          if (purchase.paymentStatus !== expectedPaymentStatus) {
            throw new AppError(
              "Group purchase does not have an outstanding remaining payment",
              409,
            );
          }

          // =============================================
          // 9. VALIDATE QR VERIFICATION
          // =============================================

          if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
            throw new AppError(
              "First appointment must be confirmed before recording remaining payment",
              409,
            );
          }

          if (!appointment.qrVerifiedAt) {
            throw new AppError(
              "Reservation QR must be verified before recording remaining payment",
              409,
            );
          }

          if (appointment.paymentStatus !== expectedPaymentStatus) {
            throw new AppError(
              "Initial appointment payment status mismatch",
              409,
            );
          }

          // =============================================
          // 10. CALCULATE REMAINING AMOUNT
          // =============================================

          const totalAmount = purchase.amount;

          const depositAmount = isDeposit
            ? purchase.depositAmount
            : new Prisma.Decimal(0);

          if (
            !totalAmount.isFinite() ||
            totalAmount.lte(0) ||
            !depositAmount ||
            !depositAmount.isFinite() ||
            depositAmount.lt(0)
          ) {
            throw new AppError("Invalid group purchase payment amounts", 409);
          }

          const remainingAmount = totalAmount.minus(depositAmount);

          if (remainingAmount.lte(0)) {
            throw new AppError("No remaining payment is due", 409);
          }

          // =============================================
          // 11. CHECK EXISTING SALON PAYMENT
          // =============================================

          const existingRemainingPayment = await tx.payment.findFirst({
            where: {
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              status: PaymentStatus.PAID,
              provider: PaymentProvider.SALON,
            },
            select: {
              id: true,
            },
          });

          if (existingRemainingPayment) {
            throw new AppError(
              "Remaining payment has already been recorded",
              409,
            );
          }

          // =============================================
          // 12. ATOMIC PURCHASE STATUS CLAIM
          // =============================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchase.id,
              purchaseFlow: GroupPurchaseFlow.BUY_NOW_BOOK_NOW,
              bookingMethod: purchase.bookingMethod,
              paymentStatus: expectedPaymentStatus,
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError(
              "Group purchase remaining payment conflict",
              409,
            );
          }

          // =============================================
          // 13. UPDATE INITIAL APPOINTMENT
          // =============================================

          const updatedAppointment = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              groupPurchaseId: purchase.id,
              bookingMethod: purchase.bookingMethod,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              paymentStatus: expectedPaymentStatus,
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedAppointment.count !== 1) {
            throw new AppError(
              "Group purchase appointment payment conflict",
              409,
            );
          }

          // =============================================
          // 14. CREATE SALON PAYMENT RECORD
          // =============================================

          const payment = await tx.payment.create({
            data: {
              customerId: purchase.customerId,
              groupPurchaseId: purchase.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.SALON,
              salonPaymentMethod: payload.paymentMethod,
              amount: remainingAmount,
              currency: "HKD",
              status: PaymentStatus.PAID,
              paidAt: now,
            },
          });

          // =============================================
          // 15. CUSTOMER NOTIFICATION
          // =============================================

          const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
            Number(payment.amount),
            payment.currency,
          );

          await notificationService.createNotification(
            {
              appointmentId: appointment.id,
              userId: purchase.customerId,
              type: "REMAINING_PAYMENT_RECEIVED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // =============================================
          // 16. AUDIT LOG
          // =============================================

          await auditLogService.createAuditLog(
            {
              userId,
              action: "REMAINING_PAYMENT_RECORDED",
              entityType: "GROUP_PURCHASE",
              entityId: purchase.id,
              metadata: {
                paymentId: payment.id,
                appointmentId: appointment.id,
                branchId: appointment.branchId,
                bookingMethod: purchase.bookingMethod,
                previousPaymentStatus: expectedPaymentStatus,
                newPaymentStatus: PaymentStatus.PAID,
                totalAmount: Number(totalAmount),
                depositAmount: Number(depositAmount),
                remainingAmount: Number(remainingAmount),
                paymentMethod: payload.paymentMethod,
                provider: PaymentProvider.SALON,
              },
            },
            tx,
          );

          // =============================================
          // 17. RESPONSE
          // =============================================

          return {
            purchaseId: purchase.id,
            appointmentId: appointment.id,
            bookingMethod: purchase.bookingMethod,
            appointmentStatus: appointment.appointmentStatus,
            paymentStatus: PaymentStatus.PAID,
            totalAmount: Number(totalAmount),
            depositAmount: Number(depositAmount),
            remainingAmount: Number(remainingAmount),
            remainingPayment: {
              id: payment.id,
              amount: Number(payment.amount),
              paymentMethod: payment.salonPaymentMethod,
              provider: payment.provider,
              status: payment.status,
              paidAt: payment.paidAt,
            },
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 10000,
          timeout: 15000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034" &&
        attempt < 3
      ) {
        continue;
      }

      throw error;
    }
  }

  throw new AppError("Group purchase remaining payment retry failed", 409);
};

export const groupPurchaseService = {
  createGroupPurchase,
  getMyGroupPurchases,
  getGroupPurchaseById,
  createGroupPurchaseAppointment,
  recordGroupPurchaseRemainingPayment,
};
