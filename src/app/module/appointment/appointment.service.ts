import {
  AppointmentStatus,
  BookingMethod,
  DayOfWeek,
  PackageStatus,
  PaymentProvider,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
  Role,
  ServiceStatus,
} from "../../../../generated/prisma/client.js";
import crypto from "node:crypto";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import httpStatus from "http-status";

import { AvailabilityService } from "../availability/availability.service.js";
import { notificationService } from "../notification/notification.service.js";

import {
  IAllAppointmentsQuery,
  IAppointmentDetails,
  IAppointmentQrResponse,
  IBranchAppointmentsQuery,
  ICancelAppointmentPayload,
  ICancelAppointmentResponse,
  ICompleteAppointmentPayload,
  ICompleteAppointmentResponse,
  ICreateDepositAppointmentPayload,
  ICreatePayNowAppointmentPayload,
  ICreateReserveAppointmentPayload,
  IDepositAppointmentResponse,
  IMarkNoShowPayload,
  IMarkNoShowResponse,
  IMyAppointmentsQuery,
  IMyAppointmentsResult,
  IPayNowAppointmentResponse,
  IRescheduleAppointmentPayload,
  IRescheduleAppointmentResponse,
  IReserveAppointmentResponse,
  IVerifyQrPayload,
  IVerifyQrResponse,
  TRecordRemainingPayment,
} from "./appointment.interface.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { notificationTemplates } from "../notification/notification.templates.js";

const PAY_NOW_HOLD_MINUTES = 5;
const MAX_TRANSACTION_RETRIES = 3;

// =====================================================
// EXPIRED PAYMENT HOLD LIFECYCLE
// =====================================================
const testPrismaTransaction = async () => {
  console.log("[DB TEST] Starting transaction test");

  const startedAt = Date.now();

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        console.log("[DB TEST] Transaction started");

        const rows = await tx.$queryRaw<{ value: number }[]>`SELECT 1 AS value`;

        return rows;
      },
      {
        maxWait: 10000,
        timeout: 15000,
      },
    );

    console.log("[DB TEST] SUCCESS:", result);
    console.log("[DB TEST] Duration:", Date.now() - startedAt, "ms");
  } catch (error) {
    console.error("[DB TEST] FAILED:", error);
  }
};
const expirePendingAppointmentIfNeeded = async (appointmentId: string) => {
  const now = new Date();

  await prisma.appointment.updateMany({
    where: {
      id: appointmentId,

      appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

      paymentStatus: PaymentStatus.PENDING,

      holdExpiresAt: {
        lte: now,
      },
    },

    data: {
      appointmentStatus: AppointmentStatus.EXPIRED,

      paymentStatus: PaymentStatus.FAILED,
    },
  });
};

const expirePendingAppointments = async () => {
  const now = new Date();

  const result = await prisma.appointment.updateMany({
    where: {
      appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

      paymentStatus: PaymentStatus.PENDING,

      holdExpiresAt: {
        lte: now,
      },
    },

    data: {
      appointmentStatus: AppointmentStatus.EXPIRED,

      paymentStatus: PaymentStatus.FAILED,
    },
  });

  return {
    expiredCount: result.count,
  };
};

export const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
};

export const minutesToTime = (minutes: number) => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const intervalsOverlap = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
) => {
  return startA < endB && endA > startB;
};

const getDayOfWeek = (date: string): DayOfWeek => {
  const value = new Date(`${date}T00:00:00.000Z`);

  const days: DayOfWeek[] = [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ];

  return days[value.getUTCDay()];
};

// =====================================================
// FINAL STAFF CONFLICT CHECK
// =====================================================

export const assertStaffSlotAvailable = async (
  tx: Prisma.TransactionClient,
  staffId: string,
  dateOnly: Date,
  requestedStart: number,
  requestedEnd: number,
  now: Date,
  excludeAppointmentId?: string,
) => {
  const blockingAppointments = await tx.appointment.findMany({
    where: {
      ...(excludeAppointmentId
        ? {
            id: {
              not: excludeAppointmentId,
            },
          }
        : {}),

      staffId,
      date: dateOnly,

      OR: [
        {
          appointmentStatus: {
            in: [AppointmentStatus.RESERVED, AppointmentStatus.CONFIRMED],
          },
        },

        {
          appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

          holdExpiresAt: {
            gt: now,
          },
        },
      ],
    },

    select: {
      startTime: true,
      endTime: true,
    },
  });

  const hasConflict = blockingAppointments.some((appointment) => {
    const existingStart = timeToMinutes(appointment.startTime);

    const existingEnd = timeToMinutes(appointment.endTime);

    return intervalsOverlap(
      requestedStart,
      requestedEnd,
      existingStart,
      existingEnd,
    );
  });

  if (hasConflict) {
    throw new AppError(
      "The selected staff is no longer available for this time slot",
      409,
    );
  }
};

// =====================================================
// FINAL BRANCH HOURLY CAPACITY CHECK
// =====================================================

export const assertBranchHourlyCapacityAvailable = async (
  tx: Prisma.TransactionClient,
  branchId: string,
  date: string,
  dateOnly: Date,
  requestedStart: number,
  requestedEnd: number,
  now: Date,
  excludeAppointmentId?: string,
) => {
  const day = getDayOfWeek(date);

  // ---------------------------------------------
  // Capacity configuration for this day
  // ---------------------------------------------

  const hourlyCapacity = await tx.branchHourlyCapacity.findUnique({
    where: {
      branchId_day: {
        branchId,
        day,
      },
    },

    select: {
      maxBookingsPerHour: true,
    },
  });

  if (!hourlyCapacity) {
    throw new AppError(
      "Branch hourly capacity is not configured for this day",
      409,
    );
  }

  const maxBookingsPerHour = hourlyCapacity.maxBookingsPerHour;

  // ---------------------------------------------
  // All branch-wide blocking appointments
  // ---------------------------------------------

  const branchBlockingAppointments = await tx.appointment.findMany({
    where: {
      ...(excludeAppointmentId
        ? {
            id: {
              not: excludeAppointmentId,
            },
          }
        : {}),

      branchId,
      date: dateOnly,

      OR: [
        {
          appointmentStatus: {
            in: [AppointmentStatus.RESERVED, AppointmentStatus.CONFIRMED],
          },
        },

        {
          appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

          holdExpiresAt: {
            gt: now,
          },
        },
      ],
    },

    select: {
      startTime: true,
      endTime: true,
    },
  });

  // ---------------------------------------------
  // Check every clock-hour bucket touched by
  // the requested appointment.
  //
  // Example:
  // 10:30–12:00
  // checks:
  // 10:00–11:00
  // 11:00–12:00
  // ---------------------------------------------

  let hourStart = Math.floor(requestedStart / 60) * 60;

  while (hourStart < requestedEnd) {
    const hourEnd = hourStart + 60;

    const used = branchBlockingAppointments.filter((appointment) => {
      const appointmentStart = timeToMinutes(appointment.startTime);

      const appointmentEnd = timeToMinutes(appointment.endTime);

      return intervalsOverlap(
        appointmentStart,
        appointmentEnd,
        hourStart,
        hourEnd,
      );
    }).length;

    if (used >= maxBookingsPerHour) {
      throw new AppError(
        "Branch hourly booking capacity has been reached",
        409,
      );
    }

    hourStart += 60;
  }
};

const createPayNowAppointment = async (
  customerId: string,
  payload: ICreatePayNowAppointmentPayload,
): Promise<IPayNowAppointmentResponse> => {
  console.log("🔥🔥🔥 CREATE PAY NOW FUNCTION CALLED 🔥🔥🔥");
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  console.log("\n========== PAY NOW BOOKING START ==========");
  console.log("Branch ID:", branchId);
  console.log("Service ID:", serviceId);
  console.log("Package ID:", packageId);
  console.log("Staff ID:", staffId);
  console.log("Date:", date);
  console.log("Start Time:", startTime);

  // =====================================================
  // 1. FIRST HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,

    ...(serviceId ? { serviceId } : {}),
    ...(packageId ? { packageId } : {}),
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
    console.log("[PAY_NOW] Requested slot unavailable");

    throw new AppError("The selected time slot is no longer available", 409);
  }

  // =====================================================
  // 2. RESOLVE STAFF
  // =====================================================

  const resolvedStaffId = staffId ?? requestedSlot.staffId;

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  console.log("[PAY_NOW] Resolved Staff ID:", resolvedStaffId);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      console.log(`[PAY_NOW] Transaction attempt: ${attempt}`);

      const result = await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 4. BOOKING TARGET SNAPSHOT
          // =============================================

          let itemName: string;

          let itemNameTranslations: Prisma.InputJsonValue | undefined;

          let durationMinutes: number;

          let price: Prisma.Decimal;

          if (serviceId) {
            // =============================================
            // SERVICE BOOKING
            // =============================================

            const service = await tx.service.findUnique({
              where: {
                id: serviceId,
              },

              select: {
                id: true,
                name: true,
                translations: true,
                price: true,
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
            });

            if (!service) {
              throw new AppError("Service not found", 404);
            }

            if (service.status !== ServiceStatus.ACTIVE) {
              throw new AppError("Service is inactive", 400);
            }

            if (service.branches.length === 0) {
              throw new AppError(
                "Service is not available at this branch",
                400,
              );
            }

            console.log("\n========== SERVICE DATA ==========");
            console.log("Service ID:", service.id);
            console.log("Service Name:", service.name);
            console.log(
              "Service Translations:",
              JSON.stringify(service.translations, null, 2),
            );
            console.log("==================================");

            itemName = service.name;

            itemNameTranslations =
              service.translations === null
                ? undefined
                : (service.translations as Prisma.InputJsonValue);

            durationMinutes = service.durationMinutes;

            price = service.price;
          } else {
            // =============================================
            // PACKAGE BOOKING
            // =============================================

            const packageData = await tx.package.findUnique({
              where: {
                id: packageId!,
              },

              select: {
                id: true,
                name: true,
                translations: true,
                packagePrice: true,
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
            });

            if (!packageData) {
              throw new AppError("Package not found", 404);
            }

            if (packageData.status !== PackageStatus.ACTIVE) {
              throw new AppError("Package is inactive", 400);
            }

            if (packageData.branches.length === 0) {
              throw new AppError(
                "Package is not available at this branch",
                400,
              );
            }

            console.log("\n========== PACKAGE DATA ==========");
            console.log("Package ID:", packageData.id);
            console.log("Package Name:", packageData.name);
            console.log(
              "Package Translations:",
              JSON.stringify(packageData.translations, null, 2),
            );
            console.log("==================================");

            itemName = packageData.name;

            itemNameTranslations =
              packageData.translations === null
                ? undefined
                : (packageData.translations as Prisma.InputJsonValue);

            durationMinutes = packageData.durationMinutes;

            price = packageData.packagePrice;
          }

          // =============================================
          // 5. DEBUG BOOKING SNAPSHOT
          // =============================================

          console.log("\n========== BOOKING SNAPSHOT ==========");
          console.log("Item Name:", itemName);
          console.log(
            "Item Name Translations:",
            JSON.stringify(itemNameTranslations, null, 2),
          );
          console.log("Duration Minutes:", durationMinutes);
          console.log("Price:", price.toString());
          console.log("======================================");

          if (itemNameTranslations === undefined) {
            console.warn(
              "[PAY_NOW WARNING] Source translations are missing. Appointment will use the base item name.",
            );
          }

          // =============================================
          // 6. REQUESTED TIME RANGE
          // =============================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =============================================
          // 7. FINAL STAFF AVAILABILITY RECHECK
          // =============================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[PAY_NOW] Staff availability verified");

          // =============================================
          // 8. FINAL BRANCH CAPACITY RECHECK
          // =============================================

          await assertBranchHourlyCapacityAvailable(
            tx,
            branchId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[PAY_NOW] Branch capacity verified");

          // =============================================
          // 9. TEMPORARY PAY-NOW HOLD
          // =============================================

          const holdExpiresAt = new Date(
            now.getTime() + PAY_NOW_HOLD_MINUTES * 60 * 1000,
          );

          // =============================================
          // 10. CREATE APPOINTMENT
          // =============================================

          const appointment = await tx.appointment.create({
            data: {
              customerId,

              branchId,

              staffId: resolvedStaffId,

              serviceId: serviceId ?? null,

              packageId: packageId ?? null,

              bookingMethod: BookingMethod.PAY_NOW,

              appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

              paymentStatus: PaymentStatus.PENDING,

              date: dateOnly,

              startTime,

              endTime,

              itemName,

              ...(itemNameTranslations !== undefined && {
                itemNameTranslations,
              }),

              durationMinutes,

              price,

              currency: "HKD",

              holdExpiresAt,

              qrToken: null,

              qrVerifiedAt: null,

              qrVerifiedBy: null,
            },

            select: {
              id: true,

              staffId: true,

              bookingMethod: true,

              appointmentStatus: true,

              paymentStatus: true,

              holdExpiresAt: true,

              // Debug: read saved snapshot
              itemName: true,

              itemNameTranslations: true,
            },
          });

          console.log("\n========== APPOINTMENT CREATED ==========");
          console.log("Appointment ID:", appointment.id);
          console.log("Saved Item Name:", appointment.itemName);
          console.log(
            "Saved Item Name Translations:",
            JSON.stringify(appointment.itemNameTranslations, null, 2),
          );
          console.log("Status:", appointment.appointmentStatus);
          console.log("Hold Expires At:", appointment.holdExpiresAt);
          console.log("=========================================");

          if (!appointment.holdExpiresAt) {
            throw new AppError("Appointment hold could not be created", 500);
          }

          return appointment;
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // =====================================================
      // 11. TRANSACTION COMMITTED
      // =====================================================

      console.log("\n========== TRANSACTION COMMITTED ==========");
      console.log("Appointment ID:", result.id);
      console.log(
        "Item Name Translations:",
        JSON.stringify(result.itemNameTranslations, null, 2),
      );
      console.log("===========================================");

      // =====================================================
      // 12. RESPONSE
      // =====================================================

      return {
        appointmentId: result.id,

        bookingMethod: "PAY_NOW",

        appointmentStatus: "PENDING_PAYMENT",

        paymentStatus: "PENDING",

        holdExpiresAt: result.holdExpiresAt!,

        qrAvailable: false,
      };
    } catch (error) {
      console.error(`[PAY_NOW ERROR] Transaction attempt ${attempt}:`, error);

      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isSerializableConflict && attempt < MAX_TRANSACTION_RETRIES) {
        console.warn(
          "[PAY_NOW] Serializable conflict. Retrying transaction...",
        );

        continue;
      }

      if (isSerializableConflict) {
        throw new AppError(
          "The selected time slot is no longer available",
          409,
        );
      }

      throw error;
    }
  }

  throw new AppError("The selected time slot is no longer available", 409);
};

const createDepositAppointment = async (
  customerId: string,
  payload: ICreateDepositAppointmentPayload,
): Promise<IDepositAppointmentResponse> => {
  await testPrismaTransaction();
  console.log("🔥🔥🔥 DEPOSIT SERVICE FUNCTION CALLED 🔥🔥🔥");
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  console.log("\n========== DEPOSIT BOOKING START ==========");
  console.log("Branch ID:", branchId);
  console.log("Service ID:", serviceId);
  console.log("Package ID:", packageId);
  console.log("Staff ID:", staffId);
  console.log("Date:", date);
  console.log("Start Time:", startTime);
  console.log("===========================================");

  // =====================================================
  // 1. FIRST HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,

    ...(serviceId ? { serviceId } : {}),

    ...(packageId ? { packageId } : {}),

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
    console.log("[DEPOSIT] Requested slot unavailable");

    throw new AppError("The selected time slot is no longer available", 409);
  }

  // =====================================================
  // 2. RESOLVE STAFF
  // =====================================================

  const resolvedStaffId = staffId ?? requestedSlot.staffId;

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  console.log("[DEPOSIT] Resolved Staff ID:", resolvedStaffId);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      console.log(`[DEPOSIT] Transaction attempt: ${attempt}`);

      const result = await prisma.$transaction(
        async (tx) => {
          // =================================================
          // 4. BRANCH + DEPOSIT POLICY
          // =================================================

          const branch = await tx.branch.findUnique({
            where: {
              id: branchId,
            },

            include: {
              bookingPolicy: true,
            },
          });

          if (!branch) {
            throw new AppError("Branch not found", 404);
          }

          if (!branch.bookingPolicy) {
            throw new AppError("Branch booking policy not found", 404);
          }

          if (!branch.bookingPolicy.depositEnabled) {
            throw new AppError(
              "Deposit booking is not enabled for this branch",
              400,
            );
          }

          if (branch.bookingPolicy.depositPercentage === null) {
            throw new AppError("Deposit percentage is not configured", 500);
          }

          const depositPercentage = new Prisma.Decimal(
            branch.bookingPolicy.depositPercentage,
          );

          if (depositPercentage.lte(0) || depositPercentage.gt(100)) {
            throw new AppError("Invalid deposit percentage configuration", 500);
          }

          console.log("\n========== DEPOSIT POLICY ==========");
          console.log("Branch ID:", branchId);
          console.log("Deposit Enabled:", branch.bookingPolicy.depositEnabled);
          console.log("Deposit Percentage:", depositPercentage.toString());
          console.log("====================================");

          // =================================================
          // 5. BOOKING TARGET + MULTILINGUAL SNAPSHOT
          // =================================================

          let itemName: string;

          let itemNameTranslations: Prisma.InputJsonValue | undefined;

          let durationMinutes: number;

          let price: Prisma.Decimal;

          if (serviceId) {
            // =============================================
            // SERVICE BOOKING
            // =============================================

            const service = await tx.service.findUnique({
              where: {
                id: serviceId,
              },

              select: {
                id: true,
                name: true,
                translations: true,
                price: true,
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
            });

            if (!service) {
              throw new AppError("Service not found", 404);
            }

            if (service.status !== ServiceStatus.ACTIVE) {
              throw new AppError("Service is inactive", 400);
            }

            if (service.branches.length === 0) {
              throw new AppError(
                "Service is not available at this branch",
                400,
              );
            }

            console.log("\n========== DEPOSIT SERVICE DATA ==========");
            console.log("Service ID:", service.id);
            console.log("Service Name:", service.name);
            console.log(
              "Service Translations:",
              JSON.stringify(service.translations, null, 2),
            );
            console.log("==========================================");

            // Booking-time service snapshot
            itemName = service.name;

            itemNameTranslations =
              service.translations === null
                ? undefined
                : (service.translations as Prisma.InputJsonValue);

            durationMinutes = service.durationMinutes;

            price = service.price;
          } else {
            // =============================================
            // PACKAGE BOOKING
            // =============================================

            const packageData = await tx.package.findUnique({
              where: {
                id: packageId!,
              },

              select: {
                id: true,
                name: true,
                translations: true,
                packagePrice: true,
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
            });

            if (!packageData) {
              throw new AppError("Package not found", 404);
            }

            if (packageData.status !== PackageStatus.ACTIVE) {
              throw new AppError("Package is inactive", 400);
            }

            if (packageData.branches.length === 0) {
              throw new AppError(
                "Package is not available at this branch",
                400,
              );
            }

            console.log("\n========== DEPOSIT PACKAGE DATA ==========");
            console.log("Package ID:", packageData.id);
            console.log("Package Name:", packageData.name);
            console.log(
              "Package Translations:",
              JSON.stringify(packageData.translations, null, 2),
            );
            console.log("==========================================");

            // Booking-time package snapshot
            itemName = packageData.name;

            itemNameTranslations =
              packageData.translations === null
                ? undefined
                : (packageData.translations as Prisma.InputJsonValue);

            durationMinutes = packageData.durationMinutes;

            price = packageData.packagePrice;
          }

          // =================================================
          // 6. DEBUG BOOKING SNAPSHOT
          // =================================================

          console.log("\n========== DEPOSIT BOOKING SNAPSHOT ==========");
          console.log("Item Name:", itemName);
          console.log(
            "Item Name Translations:",
            JSON.stringify(itemNameTranslations, null, 2),
          );
          console.log("Duration Minutes:", durationMinutes);
          console.log("Price:", price.toString());
          console.log("==============================================");

          if (itemNameTranslations === undefined) {
            console.warn(
              "[DEPOSIT WARNING] Source translations are missing. Appointment will use the base item name.",
            );
          }

          // =================================================
          // 7. DEPOSIT CALCULATION
          // =================================================

          const depositAmount = price
            .mul(depositPercentage)
            .div(100)
            .toDecimalPlaces(2);

          const remainingAmount = price.sub(depositAmount).toDecimalPlaces(2);

          console.log("\n========== DEPOSIT CALCULATION ==========");
          console.log("Total Price:", price.toString());
          console.log("Deposit Percentage:", depositPercentage.toString());
          console.log("Deposit Amount:", depositAmount.toString());
          console.log("Remaining Amount:", remainingAmount.toString());
          console.log("=========================================");

          // =================================================
          // 8. REQUESTED TIME RANGE
          // =================================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =================================================
          // 9. FINAL STAFF AVAILABILITY RECHECK
          // =================================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[DEPOSIT] Staff availability verified");

          // =================================================
          // 10. FINAL BRANCH CAPACITY RECHECK
          // =================================================

          await assertBranchHourlyCapacityAvailable(
            tx,
            branchId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[DEPOSIT] Branch capacity verified");

          // =================================================
          // 11. TEMPORARY DEPOSIT PAYMENT HOLD
          // =================================================

          const holdExpiresAt = new Date(
            now.getTime() + PAY_NOW_HOLD_MINUTES * 60 * 1000,
          );

          // =================================================
          // 12. CREATE DEPOSIT APPOINTMENT
          // =================================================

          console.log("\n========== BEFORE DEPOSIT CREATE ==========");
          console.log("Item Name:", itemName);
          console.log(
            "Translations being saved:",
            JSON.stringify(itemNameTranslations, null, 2),
          );
          console.log("===========================================");

          const appointment = await tx.appointment.create({
            data: {
              customerId,

              branchId,

              // Specific staff OR auto-selected staff
              staffId: resolvedStaffId,

              serviceId: serviceId ?? null,

              packageId: packageId ?? null,

              bookingMethod: BookingMethod.DEPOSIT,

              appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

              paymentStatus: PaymentStatus.PENDING,

              date: dateOnly,

              startTime,

              endTime,

              // Booking-time name snapshot
              itemName,

              // Booking-time multilingual snapshot
              ...(itemNameTranslations !== undefined && {
                itemNameTranslations,
              }),

              durationMinutes,

              price,

              currency: "HKD",

              depositPercentage,

              depositAmount,

              remainingAmount,

              // Temporary payment hold
              holdExpiresAt,

              // QR generated after successful deposit payment
              qrToken: null,

              qrVerifiedAt: null,

              qrVerifiedBy: null,
            },

            select: {
              id: true,

              staffId: true,

              bookingMethod: true,

              appointmentStatus: true,

              paymentStatus: true,

              price: true,

              depositPercentage: true,

              depositAmount: true,

              remainingAmount: true,

              holdExpiresAt: true,

              // Debug fields
              itemName: true,

              itemNameTranslations: true,
            },
          });

          console.log("\n========== DEPOSIT APPOINTMENT CREATED ==========");
          console.log("Appointment ID:", appointment.id);
          console.log("Saved Item Name:", appointment.itemName);
          console.log(
            "Saved Item Name Translations:",
            JSON.stringify(appointment.itemNameTranslations, null, 2),
          );
          console.log("Status:", appointment.appointmentStatus);
          console.log("Hold Expires At:", appointment.holdExpiresAt);
          console.log("=================================================");

          if (!appointment.holdExpiresAt) {
            throw new AppError("Appointment hold could not be created", 500);
          }

          return appointment;
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // =====================================================
      // 13. TRANSACTION COMMITTED
      // =====================================================

      console.log("\n========== DEPOSIT TRANSACTION COMMITTED ==========");
      console.log("Appointment ID:", result.id);
      console.log(
        "Item Name Translations:",
        JSON.stringify(result.itemNameTranslations, null, 2),
      );
      console.log("Deposit Amount:", result.depositAmount?.toString());
      console.log("Remaining Amount:", result.remainingAmount?.toString());
      console.log("===================================================");

      // =====================================================
      // 14. RESPONSE
      // =====================================================

      return {
        appointmentId: result.id,

        bookingMethod: "DEPOSIT",

        appointmentStatus: "PENDING_PAYMENT",

        paymentStatus: "PENDING",

        price: Number(result.price),

        depositPercentage: Number(result.depositPercentage),

        depositAmount: Number(result.depositAmount),

        remainingAmount: Number(result.remainingAmount),

        holdExpiresAt: result.holdExpiresAt!,

        qrAvailable: false,
      };
    } catch (error) {
      console.error(`[DEPOSIT ERROR] Transaction attempt ${attempt}:`, error);

      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isSerializableConflict && attempt < MAX_TRANSACTION_RETRIES) {
        console.warn(
          "[DEPOSIT] Serializable conflict. Retrying transaction...",
        );

        continue;
      }

      if (isSerializableConflict) {
        throw new AppError(
          "The selected time slot is no longer available",
          409,
        );
      }

      throw error;
    }
  }

  throw new AppError("The selected time slot is no longer available", 409);
};

const createReserveAppointment = async (
  customerId: string,
  payload: ICreateReserveAppointmentPayload,
): Promise<IReserveAppointmentResponse> => {
  console.log("🔥🔥🔥 RESERVE NOW SERVICE FUNCTION CALLED 🔥🔥🔥");

  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  console.log("\n========== RESERVE NOW BOOKING START ==========");
  console.log("Branch ID:", branchId);
  console.log("Service ID:", serviceId);
  console.log("Package ID:", packageId);
  console.log("Staff ID:", staffId);
  console.log("Date:", date);
  console.log("Start Time:", startTime);
  console.log("===============================================");

  // =====================================================
  // 1. FIRST HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,

    ...(serviceId ? { serviceId } : {}),
    ...(packageId ? { packageId } : {}),
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
    console.log("[RESERVE_NOW] Requested slot unavailable");

    throw new AppError("The selected time slot is no longer available", 409);
  }

  // =====================================================
  // 2. RESOLVE STAFF
  // =====================================================

  const resolvedStaffId = staffId ?? requestedSlot.staffId;

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  console.log("[RESERVE_NOW] Resolved Staff ID:", resolvedStaffId);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      console.log(`[RESERVE_NOW] Transaction attempt: ${attempt}`);

      const result = await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 4. BOOKING TARGET + MULTILINGUAL SNAPSHOT
          // =============================================

          let itemName: string;

          let itemNameTranslations: Prisma.InputJsonValue | undefined;

          let durationMinutes: number;

          let price: Prisma.Decimal;

          if (serviceId) {
            // ===========================================
            // SERVICE BOOKING
            // ===========================================

            const service = await tx.service.findUnique({
              where: {
                id: serviceId,
              },

              select: {
                id: true,
                name: true,
                translations: true,
                price: true,
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
            });

            if (!service) {
              throw new AppError("Service not found", 404);
            }

            if (service.status !== ServiceStatus.ACTIVE) {
              throw new AppError("Service is inactive", 400);
            }

            if (service.branches.length === 0) {
              throw new AppError(
                "Service is not available at this branch",
                400,
              );
            }

            console.log("\n========== RESERVE SERVICE DATA ==========");
            console.log("Service ID:", service.id);
            console.log("Service Name:", service.name);
            console.log(
              "Service Translations:",
              JSON.stringify(service.translations, null, 2),
            );
            console.log("==========================================");

            // Booking-time service snapshot

            itemName = service.name;

            itemNameTranslations =
              service.translations === null
                ? undefined
                : (service.translations as Prisma.InputJsonValue);

            durationMinutes = service.durationMinutes;

            price = service.price;
          } else {
            // ===========================================
            // PACKAGE BOOKING
            // ===========================================

            const packageData = await tx.package.findUnique({
              where: {
                id: packageId!,
              },

              select: {
                id: true,
                name: true,
                translations: true,
                packagePrice: true,
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
            });

            if (!packageData) {
              throw new AppError("Package not found", 404);
            }

            if (packageData.status !== PackageStatus.ACTIVE) {
              throw new AppError("Package is inactive", 400);
            }

            if (packageData.branches.length === 0) {
              throw new AppError(
                "Package is not available at this branch",
                400,
              );
            }

            console.log("\n========== RESERVE PACKAGE DATA ==========");
            console.log("Package ID:", packageData.id);
            console.log("Package Name:", packageData.name);
            console.log(
              "Package Translations:",
              JSON.stringify(packageData.translations, null, 2),
            );
            console.log("==========================================");

            // Booking-time package snapshot

            itemName = packageData.name;

            itemNameTranslations =
              packageData.translations === null
                ? undefined
                : (packageData.translations as Prisma.InputJsonValue);

            durationMinutes = packageData.durationMinutes;

            price = packageData.packagePrice;
          }

          // =============================================
          // 5. DEBUG BOOKING SNAPSHOT
          // =============================================

          console.log("\n========== RESERVE BOOKING SNAPSHOT ==========");
          console.log("Item Name:", itemName);
          console.log(
            "Item Name Translations:",
            JSON.stringify(itemNameTranslations, null, 2),
          );
          console.log("Duration Minutes:", durationMinutes);
          console.log("Price:", price.toString());
          console.log("==============================================");

          if (itemNameTranslations === undefined) {
            console.warn(
              "[RESERVE_NOW WARNING] Source translations are missing. Appointment will use the base item name.",
            );
          }

          // =============================================
          // 6. REQUESTED TIME RANGE
          // =============================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          console.log("\n========== RESERVE TIME RANGE ==========");
          console.log("Start Time:", startTime);
          console.log("End Time:", endTime);
          console.log("Duration:", durationMinutes);
          console.log("========================================");

          // =============================================
          // 7. FINAL STAFF AVAILABILITY RECHECK
          // =============================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[RESERVE_NOW] Staff availability verified");

          // =============================================
          // 8. FINAL BRANCH CAPACITY RECHECK
          // =============================================

          await assertBranchHourlyCapacityAvailable(
            tx,
            branchId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[RESERVE_NOW] Branch capacity verified");

          // =============================================
          // 9. SECURE QR TOKEN
          // =============================================

          const qrToken = crypto.randomBytes(32).toString("hex");

          console.log("[RESERVE_NOW] Secure QR token generated");

          // Do not print QR token in logs.

          // =============================================
          // 10. CREATE RESERVED APPOINTMENT
          // =============================================

          console.log("\n========== BEFORE RESERVE CREATE ==========");
          console.log("Item Name:", itemName);
          console.log(
            "Translations being saved:",
            JSON.stringify(itemNameTranslations, null, 2),
          );
          console.log("===========================================");

          const appointment = await tx.appointment.create({
            data: {
              customerId,

              branchId,

              staffId: resolvedStaffId,

              serviceId: serviceId ?? null,

              packageId: packageId ?? null,

              bookingMethod: BookingMethod.RESERVE_NOW,

              appointmentStatus: AppointmentStatus.RESERVED,

              paymentStatus: PaymentStatus.UNPAID,

              date: dateOnly,

              startTime,

              endTime,

              // Booking-time name snapshot
              itemName,

              // Booking-time multilingual snapshot
              ...(itemNameTranslations !== undefined && {
                itemNameTranslations,
              }),

              durationMinutes,

              price,

              currency: "HKD",

              // Reserve Now is not a temporary hold
              holdExpiresAt: null,

              qrToken,

              qrVerifiedAt: null,

              qrVerifiedBy: null,
            },

            select: {
              id: true,

              staffId: true,

              qrToken: true,

              itemName: true,

              itemNameTranslations: true,

              appointmentStatus: true,

              paymentStatus: true,
            },
          });

          console.log("\n========== RESERVE APPOINTMENT CREATED ==========");
          console.log("Appointment ID:", appointment.id);
          console.log("Saved Item Name:", appointment.itemName);
          console.log(
            "Saved Item Name Translations:",
            JSON.stringify(appointment.itemNameTranslations, null, 2),
          );
          console.log("Status:", appointment.appointmentStatus);
          console.log("Payment Status:", appointment.paymentStatus);
          console.log("QR Available:", Boolean(appointment.qrToken));
          console.log("=================================================");

          if (!appointment.qrToken) {
            throw new AppError("Reservation QR could not be created", 500);
          }

          // =============================================
          // 11. MULTILINGUAL BOOKING RESERVED NOTIFICATION
          // =============================================

          const translations = notificationTemplates.BOOKING_RESERVED(
            date,
            startTime,
          );

          await notificationService.createNotification(
            {
              userId: customerId,

              type: "BOOKING_RESERVED",

              title: translations.en!.title!,

              message: translations.en!.message!,

              translations,
            },
            tx,
          );

          console.log("[RESERVE_NOW] Booking reserved notification created");

          // =============================================
          // 12. RETURN APPOINTMENT FROM TRANSACTION
          // =============================================

          return appointment;
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // =================================================
      // 13. TRANSACTION COMMITTED
      // =================================================

      console.log("\n========== RESERVE TRANSACTION COMMITTED ==========");
      console.log("Appointment ID:", result.id);
      console.log(
        "Item Name Translations:",
        JSON.stringify(result.itemNameTranslations, null, 2),
      );
      console.log("Appointment Status:", result.appointmentStatus);
      console.log("Payment Status:", result.paymentStatus);
      console.log("QR Available:", Boolean(result.qrToken));
      console.log("===================================================");

      // =================================================
      // 14. RESPONSE
      // =================================================

      return {
        appointmentId: result.id,

        bookingMethod: "RESERVE_NOW",

        appointmentStatus: "RESERVED",

        paymentStatus: "UNPAID",

        qr: {
          available: true,

          token: result.qrToken!,
        },
      };
    } catch (error) {
      console.error(
        `[RESERVE_NOW ERROR] Transaction attempt ${attempt}:`,
        error,
      );

      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isSerializableConflict && attempt < MAX_TRANSACTION_RETRIES) {
        console.warn(
          "[RESERVE_NOW] Serializable conflict. Retrying transaction...",
        );

        continue;
      }

      if (isSerializableConflict) {
        throw new AppError(
          "The selected time slot is no longer available",
          409,
        );
      }

      throw error;
    }
  }

  throw new AppError("The selected time slot is no longer available", 409);
};

const getMyAppointments = async (
  customerId: string,
  query: IMyAppointmentsQuery,
  language: Language = DEFAULT_LANGUAGE,
): Promise<IMyAppointmentsResult> => {
  // =====================================================
  // 0. EXPIRE OLD PAYMENT HOLDS
  // =====================================================

  await expirePendingAppointments();

  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. APPOINTMENT TYPE FILTER
  // =====================================================

  const statusFilter =
    query.type === "UPCOMING"
      ? {
          in: [
            AppointmentStatus.PENDING_PAYMENT,
            AppointmentStatus.RESERVED,
            AppointmentStatus.CONFIRMED,
          ],
        }
      : {
          in: [
            AppointmentStatus.COMPLETED,
            AppointmentStatus.CANCELLED,
            AppointmentStatus.NO_SHOW,
            AppointmentStatus.EXPIRED,
          ],
        };

  // =====================================================
  // 3. FETCH CUSTOMER APPOINTMENTS
  // =====================================================

  const where: Prisma.AppointmentWhereInput = {
    customerId,
    appointmentStatus: statusFilter,
  };

  const [appointments, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      skip,
      take: limit,

      orderBy:
        query.type === "UPCOMING"
          ? [{ date: "asc" }, { startTime: "asc" }]
          : [{ date: "desc" }, { startTime: "desc" }],

      select: {
        id: true,

        bookingMethod: true,
        appointmentStatus: true,
        paymentStatus: true,

        date: true,
        startTime: true,
        endTime: true,

        itemName: true,
        price: true,

        depositPercentage: true,
        depositAmount: true,
        remainingAmount: true,

        qrToken: true,
        qrVerifiedAt: true,

        branch: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        package: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        // Actual payment and refund records
        payments: {
          select: {
            amount: true,
            status: true,
            refunds: {
              where: {
                status: "SUCCEEDED",
              },
              select: {
                amount: true,
              },
            },
          },
        },
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. RESPONSE DTO WITH LOCALIZATION
  // =====================================================

  const items = appointments.map((appointment) => {
    const localizedBranch = getLocalizedContent(
      appointment.branch.translations,
      language,
      {
        name: appointment.branch.name,
      },
    );

    const localizedService = appointment.service
      ? getLocalizedContent(appointment.service.translations, language, {
          name: appointment.itemName,
        })
      : null;

    const localizedPackage = appointment.package
      ? getLocalizedContent(appointment.package.translations, language, {
          name: appointment.itemName,
        })
      : null;

    // =====================================================
    // 5. QR STATE
    // =====================================================

    const qrAvailable =
      (appointment.bookingMethod === BookingMethod.RESERVE_NOW ||
        appointment.bookingMethod === BookingMethod.DEPOSIT) &&
      appointment.appointmentStatus === AppointmentStatus.RESERVED &&
      Boolean(appointment.qrToken) &&
      !appointment.qrVerifiedAt;

    // =====================================================
    // 6. G8 — PAYMENT SUMMARY
    // =====================================================

    const price = Number(appointment.price);

    const isDepositBooking =
      appointment.bookingMethod === BookingMethod.DEPOSIT;

    const depositPercentage = isDepositBooking
      ? Number(appointment.depositPercentage ?? 0)
      : 0;

    const depositAmount = isDepositBooking
      ? Number(appointment.depositAmount ?? 0)
      : null;

    const originalRemainingAmount = isDepositBooking
      ? Number(appointment.remainingAmount ?? price - (depositAmount ?? 0))
      : price;

    // =====================================================
    // 7. CALCULATE ACTUAL SUCCESSFUL PAYMENTS
    // =====================================================

    const grossPaid = appointment.payments.reduce((total, payment) => {
      if (
        payment.status === PaymentStatus.PAID ||
        payment.status === PaymentStatus.PARTIALLY_REFUNDED ||
        payment.status === PaymentStatus.REFUNDED
      ) {
        return total + Number(payment.amount);
      }

      return total;
    }, 0);

    const totalRefunded = appointment.payments.reduce((total, payment) => {
      const refunded = payment.refunds.reduce(
        (sum, refund) => sum + Number(refund.amount),
        0,
      );

      return total + refunded;
    }, 0);

    const netPaid = Math.max(0, Number((grossPaid - totalRefunded).toFixed(2)));

    // =====================================================
    // 8. APPOINTMENT COLLECTION STATE
    // =====================================================

    const closedStatuses: AppointmentStatus[] = [
      AppointmentStatus.CANCELLED,
      AppointmentStatus.EXPIRED,
      AppointmentStatus.NO_SHOW,
    ];
    const isClosedWithoutCollection = closedStatuses.includes(
      appointment.appointmentStatus,
    );

    let amountPaid = 0;
    let amountDue = 0;

    if (appointment.paymentStatus === PaymentStatus.PAID) {
      amountPaid = price;
      amountDue = 0;
    } else if (appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID) {
      amountPaid = netPaid;
      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
    } else if (appointment.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED) {
      amountPaid = netPaid;
      amountDue = 0;
    } else if (appointment.paymentStatus === PaymentStatus.REFUNDED) {
      amountPaid = 0;
      amountDue = 0;
    } else {
      amountPaid = netPaid;

      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
    }

    if (isClosedWithoutCollection) {
      amountDue = 0;
    }

    // =====================================================
    // 9. G8 — REMAINING BALANCE
    // =====================================================

    let remainingAmount = amountDue;

    if (appointment.paymentStatus === PaymentStatus.PAID) {
      remainingAmount = 0;
    }

    if (
      appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID &&
      isDepositBooking
    ) {
      remainingAmount = Math.max(
        0,
        Number(
          (
            originalRemainingAmount -
            Math.max(0, amountPaid - (depositAmount ?? 0))
          ).toFixed(2),
        ),
      );
    }

    if (isClosedWithoutCollection) {
      remainingAmount = 0;
    }

    // =====================================================
    // 10. FINAL RESPONSE DTO
    // =====================================================

    return {
      id: appointment.id,

      bookingMethod: appointment.bookingMethod,
      appointmentStatus: appointment.appointmentStatus,
      paymentStatus: appointment.paymentStatus,

      branch: {
        id: appointment.branch.id,
        name: localizedBranch.name,
      },

      service: appointment.service
        ? {
            id: appointment.service.id,
            name: localizedService?.name ?? appointment.itemName,
          }
        : null,

      package: appointment.package
        ? {
            id: appointment.package.id,
            name: localizedPackage?.name ?? appointment.itemName,
          }
        : null,

      staff: {
        id: appointment.staff.id,
        name: appointment.staff.name,
      },

      date: appointment.date.toISOString().slice(0, 10),

      startTime: appointment.startTime,
      endTime: appointment.endTime,

      price,

      depositPercentage,
      depositAmount,
      remainingAmount,

      amountPaid,
      amountDue,

      qrAvailable,
    };
  });

  // =====================================================
  // 11. PAGINATION RESPONSE
  // =====================================================

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};
const getAppointmentById = async (
  appointmentId: string,
  userId: string,
  role: Role,
  language: Language = DEFAULT_LANGUAGE,
): Promise<IAppointmentDetails> => {
  // =====================================================
  // 0. EXPIRE PAYMENT HOLD IF NEEDED
  // =====================================================

  await expirePendingAppointmentIfNeeded(appointmentId);

  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    include: {
      branch: {
        select: {
          id: true,
          name: true,
          translations: true,
        },
      },

      staff: {
        select: {
          id: true,
          name: true,
          userId: true,
        },
      },

      payments: {
        orderBy: {
          createdAt: "desc",
        },

        select: {
          id: true,
          amount: true,
          status: true,
          provider: true,
          salonPaymentMethod: true,
          paidAt: true,

          refunds: {
            where: {
              status: "SUCCEEDED",
            },

            select: {
              amount: true,
            },
          },
        },
      },
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 2. RBAC / RESOURCE SCOPE
  // =====================================================

  if (role === Role.CUSTOMER) {
    if (appointment.customerId !== userId) {
      throw new AppError("You are not allowed to access this appointment", 403);
    }
  }

  if (role === Role.STAFF) {
    if (appointment.staff.userId !== userId) {
      throw new AppError("You are not allowed to access this appointment", 403);
    }
  }

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: appointment.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError("You are not allowed to access this appointment", 403);
    }
  }

  // BRAND_OWNER = brand-wide access.

  // =====================================================
  // 3. LOCALIZATION
  // =====================================================

  const localizedBranch = getLocalizedContent(
    appointment.branch.translations,
    language,
    {
      name: appointment.branch.name,
    },
  );

  // Booking-time snapshot fallback.
  let localizedItemName = appointment.itemName;

  if (appointment.serviceId) {
    const service = await prisma.service.findUnique({
      where: {
        id: appointment.serviceId,
      },

      select: {
        translations: true,
      },
    });

    if (service) {
      const localizedService = getLocalizedContent(
        service.translations,
        language,
        {
          name: appointment.itemName,
        },
      );

      localizedItemName = localizedService.name;
    }
  } else if (appointment.packageId) {
    const packageData = await prisma.package.findUnique({
      where: {
        id: appointment.packageId,
      },

      select: {
        translations: true,
      },
    });

    if (packageData) {
      const localizedPackage = getLocalizedContent(
        packageData.translations,
        language,
        {
          name: appointment.itemName,
        },
      );

      localizedItemName = localizedPackage.name;
    }
  }

  // =====================================================
  // 4. QR STATE
  // =====================================================

  const qrAvailable =
    (appointment.bookingMethod === BookingMethod.RESERVE_NOW ||
      appointment.bookingMethod === BookingMethod.DEPOSIT) &&
    appointment.appointmentStatus === AppointmentStatus.RESERVED &&
    Boolean(appointment.qrToken) &&
    !appointment.qrVerifiedAt;

  const qrVerified = Boolean(appointment.qrVerifiedAt);

  // =====================================================
  // 5. QR VERIFIED-BY USER
  // =====================================================

  let verifiedBy: {
    id: string;
    name: string;
  } | null = null;

  if (appointment.qrVerifiedBy) {
    verifiedBy = await prisma.user.findUnique({
      where: {
        id: appointment.qrVerifiedBy,
      },

      select: {
        id: true,
        name: true,
      },
    });
  }

  // =====================================================
  // 6. REVIEW STATE
  // =====================================================

  const reviewAllowed =
    appointment.appointmentStatus === AppointmentStatus.COMPLETED;

  // =====================================================
  // 7. G8 — DEPOSIT INFORMATION
  // =====================================================

  const price = Number(appointment.price);

  const isDepositBooking = appointment.bookingMethod === BookingMethod.DEPOSIT;

  const depositPercentage = isDepositBooking
    ? Number(appointment.depositPercentage ?? 0)
    : 0;

  const depositAmount: number | null = isDepositBooking
    ? Number(appointment.depositAmount ?? 0)
    : null;

  // =====================================================
  // 8. ACTUAL PAYMENT & REFUND CALCULATION
  // =====================================================

  const successfulPaymentStatuses: PaymentStatus[] = [
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ];

  const grossPaid = appointment.payments.reduce((total, payment) => {
    if (successfulPaymentStatuses.includes(payment.status)) {
      return total + Number(payment.amount);
    }

    return total;
  }, 0);

  const totalRefunded = appointment.payments.reduce((total, payment) => {
    const refundedAmount = payment.refunds.reduce(
      (sum, refund) => sum + Number(refund.amount),
      0,
    );

    return total + refundedAmount;
  }, 0);

  const netPaid = Math.max(0, Number((grossPaid - totalRefunded).toFixed(2)));

  // =====================================================
  // 9. FINANCIAL STATE
  // =====================================================

  const closedStatuses: AppointmentStatus[] = [
    AppointmentStatus.CANCELLED,
    AppointmentStatus.EXPIRED,
    AppointmentStatus.NO_SHOW,
  ];

  const isClosedWithoutCollection = closedStatuses.includes(
    appointment.appointmentStatus,
  );

  let amountPaid = netPaid;
  let amountDue = 0;

  switch (appointment.paymentStatus) {
    case PaymentStatus.PAID:
      amountDue = 0;
      break;

    case PaymentStatus.PARTIALLY_PAID:
      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
      break;

    case PaymentStatus.PARTIALLY_REFUNDED:
      // Refund does not automatically reopen a salon payment obligation.
      amountDue = 0;
      break;

    case PaymentStatus.REFUNDED:
      amountDue = 0;
      break;

    case PaymentStatus.UNPAID:
    case PaymentStatus.PENDING:
    case PaymentStatus.FAILED:
      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
      break;

    default:
      amountDue = 0;
      break;
  }

  if (isClosedWithoutCollection) {
    amountDue = 0;
  }

  // =====================================================
  // 10. G8 — REMAINING BALANCE
  // =====================================================

  // Current amount collectible at salon.
  // Fully paid, refunded and closed bookings have no
  // remaining collection obligation.

  const remainingAmount = amountDue;

  // =====================================================
  // 11. LATEST SUCCESSFUL PAYMENT
  // =====================================================

  const latestPayment =
    appointment.payments
      .filter(
        (payment) =>
          payment.paidAt !== null &&
          successfulPaymentStatuses.includes(payment.status),
      )
      .sort(
        (a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0),
      )[0] ?? null;

  // =====================================================
  // 12. RESPONSE DTO
  // =====================================================

  return {
    id: appointment.id,

    bookingMethod: appointment.bookingMethod,

    appointmentStatus: appointment.appointmentStatus,

    paymentStatus: appointment.paymentStatus,

    branch: {
      id: appointment.branch.id,
      name: localizedBranch.name,
    },

    service: appointment.serviceId
      ? {
          id: appointment.serviceId,
          name: localizedItemName,
          durationMinutes: appointment.durationMinutes,
        }
      : null,

    package: appointment.packageId
      ? {
          id: appointment.packageId,
          name: localizedItemName,
          durationMinutes: appointment.durationMinutes,
        }
      : null,

    staff: {
      id: appointment.staff.id,
      name: appointment.staff.name,
    },

    date: appointment.date.toISOString().slice(0, 10),

    startTime: appointment.startTime,
    endTime: appointment.endTime,

    price,
    currency: appointment.currency,

    depositPercentage,
    depositAmount,
    remainingAmount,

    amountPaid,
    amountDue,

    payment: {
      method: latestPayment?.salonPaymentMethod ?? null,
      provider: latestPayment?.provider ?? null,
      paidAt: latestPayment?.paidAt ?? null,
    },

    qr: {
      available: qrAvailable,
      verified: qrVerified,
      verifiedAt: appointment.qrVerifiedAt,
      verifiedBy,
    },

    review: {
      allowed: reviewAllowed,
      submitted: false,
    },
  };
};
const createHongKongDateTime = (date: Date, time: string) => {
  const datePart = date.toISOString().slice(0, 10);

  return new Date(`${datePart}T${time}:00+08:00`);
};

const cancelAppointment = async (
  appointmentId: string,
  userId: string,
  role: Role,
  payload: ICancelAppointmentPayload,
): Promise<ICancelAppointmentResponse> => {
  const cancellableStatuses: AppointmentStatus[] = [
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
    include: {
      branch: {
        include: {
          bookingPolicy: true,
        },
      },
      staff: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 2. ROLE / OWNERSHIP VALIDATION
  // =====================================================

  if (role === Role.CUSTOMER && appointment.customerId !== userId) {
    throw new AppError("You are not allowed to cancel this appointment", 403);
  }

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: appointment.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError("You are not allowed to cancel this appointment", 403);
    }
  }

  if (role === Role.STAFF) {
    throw new AppError("You are not allowed to cancel this appointment", 403);
  }

  // =====================================================
  // 3. STATUS VALIDATION
  // =====================================================

  if (!cancellableStatuses.includes(appointment.appointmentStatus)) {
    throw new AppError(
      "Appointment cannot be cancelled in its current status",
      409,
    );
  }

  // =====================================================
  // 4. CUSTOMER CANCELLATION POLICY
  // =====================================================

  if (role === Role.CUSTOMER) {
    const policy = appointment.branch.bookingPolicy;

    if (!policy) {
      throw new AppError("Branch booking policy not found", 404);
    }

    const appointmentDateTime = createHongKongDateTime(
      appointment.date,
      appointment.startTime,
    );

    const cutoffMs = policy.cancellationCutoffHours * 60 * 60 * 1000;

    if (new Date() >= new Date(appointmentDateTime.getTime() - cutoffMs)) {
      throw new AppError(
        "Cancellation is no longer allowed for this appointment",
        422,
      );
    }
  }

  // =====================================================
  // 5. PAYMENT VALIDATION
  // =====================================================

  const isGroupPurchase =
    appointment.bookingMethod === BookingMethod.GROUP_PURCHASE &&
    appointment.groupPurchaseId !== null;

  if (
    appointment.bookingMethod === BookingMethod.GROUP_PURCHASE &&
    !appointment.groupPurchaseId
  ) {
    throw new AppError("Group purchase reference is missing", 409);
  }

  if (
    !isGroupPurchase &&
    (appointment.paymentStatus === PaymentStatus.PAID ||
      appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID)
  ) {
    throw new AppError(
      "Paid appointment cancellation requires refund processing",
      422,
    );
  }

  // =====================================================
  // 6. SERIALIZABLE TRANSACTION
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // ---------------------------------------------
          // Re-read current appointment
          // ---------------------------------------------

          const current = await tx.appointment.findUnique({
            where: {
              id: appointmentId,
            },
            select: {
              id: true,
              customerId: true,
              branchId: true,
              bookingMethod: true,
              groupPurchaseId: true,
              appointmentStatus: true,
              paymentStatus: true,
              date: true,
              startTime: true,
              branch: {
                select: {
                  bookingPolicy: {
                    select: {
                      cancellationCutoffHours: true,
                    },
                  },
                },
              },
            },
          });

          if (!current) {
            throw new AppError("Appointment not found", 404);
          }

          // ---------------------------------------------
          // Recheck ownership
          // ---------------------------------------------

          if (role === Role.CUSTOMER && current.customerId !== userId) {
            throw new AppError(
              "You are not allowed to cancel this appointment",
              403,
            );
          }

          // ---------------------------------------------
          // Recheck branch manager permission
          // ---------------------------------------------

          if (role === Role.BRANCH_MANAGER) {
            const managerBranch = await tx.branchManagerBranch.findUnique({
              where: {
                userId_branchId: {
                  userId,
                  branchId: current.branchId,
                },
              },
            });

            if (!managerBranch) {
              throw new AppError(
                "You are not allowed to cancel this appointment",
                403,
              );
            }
          }

          // ---------------------------------------------
          // Recheck status
          // ---------------------------------------------

          if (!cancellableStatuses.includes(current.appointmentStatus)) {
            throw new AppError(
              "Appointment cannot be cancelled in its current status",
              409,
            );
          }

          // ---------------------------------------------
          // Recheck cancellation cutoff
          // ---------------------------------------------

          if (role === Role.CUSTOMER) {
            const policy = current.branch.bookingPolicy;

            if (!policy) {
              throw new AppError("Branch booking policy not found", 404);
            }

            const appointmentDateTime = createHongKongDateTime(
              current.date,
              current.startTime,
            );

            const cutoffMs = policy.cancellationCutoffHours * 60 * 60 * 1000;

            if (
              new Date() >= new Date(appointmentDateTime.getTime() - cutoffMs)
            ) {
              throw new AppError(
                "Cancellation is no longer allowed for this appointment",
                422,
              );
            }
          }

          // ---------------------------------------------
          // Identify Group Purchase booking
          // ---------------------------------------------

          const isCurrentGroupPurchase =
            current.bookingMethod === BookingMethod.GROUP_PURCHASE &&
            current.groupPurchaseId !== null;

          if (
            current.bookingMethod === BookingMethod.GROUP_PURCHASE &&
            !current.groupPurchaseId
          ) {
            throw new AppError("Group purchase reference is missing", 409);
          }

          // ---------------------------------------------
          // Preserve existing paid booking restriction
          // ---------------------------------------------

          if (
            !isCurrentGroupPurchase &&
            (current.paymentStatus === PaymentStatus.PAID ||
              current.paymentStatus === PaymentStatus.PARTIALLY_PAID)
          ) {
            throw new AppError(
              "Paid appointment cancellation requires refund processing",
              422,
            );
          }

          // ---------------------------------------------
          // Validate linked Group Purchase
          // ---------------------------------------------

          let purchase: {
            id: string;
            customerId: string;
            quantity: number;
            paymentStatus: PaymentStatus;
          } | null = null;

          if (isCurrentGroupPurchase && current.groupPurchaseId) {
            purchase = await tx.groupPurchase.findUnique({
              where: {
                id: current.groupPurchaseId,
              },
              select: {
                id: true,
                customerId: true,
                quantity: true,
                paymentStatus: true,
              },
            });

            if (!purchase) {
              throw new AppError("Associated group purchase not found", 404);
            }

            if (purchase.customerId !== current.customerId) {
              throw new AppError("Group purchase ownership mismatch", 409);
            }

            if (purchase.paymentStatus !== PaymentStatus.PAID) {
              throw new AppError("Group purchase is not in a paid state", 409);
            }
          }

          // =================================================
          // 7. CANCEL APPOINTMENT
          // =================================================

          const updated = await tx.appointment.updateMany({
            where: {
              id: appointmentId,
              appointmentStatus: {
                in: cancellableStatuses,
              },
            },
            data: {
              appointmentStatus: AppointmentStatus.CANCELLED,
              cancelledAt: new Date(),
              cancellationReason: payload.reason.trim(),
            },
          });

          if (updated.count !== 1) {
            throw new AppError(
              "Appointment cannot be cancelled in its current status",
              409,
            );
          }

          // =================================================
          // 8. CALCULATE GROUP PURCHASE QUANTITY
          // =================================================

          let groupPurchaseSummary: ICancelAppointmentResponse["groupPurchase"] =
            undefined;

          if (isCurrentGroupPurchase && purchase) {
            const redeemedQuantity = await tx.appointment.count({
              where: {
                groupPurchaseId: purchase.id,
                appointmentStatus: {
                  not: AppointmentStatus.CANCELLED,
                },
              },
            });

            const remainingQuantity = Math.max(
              0,
              purchase.quantity - redeemedQuantity,
            );

            groupPurchaseSummary = {
              purchaseId: purchase.id,
              purchasedQuantity: purchase.quantity,
              redeemedQuantity,
              remainingQuantity,
            };
          }

          // =====================================================
          // 9. CREATE MULTILINGUAL NOTIFICATION
          // =====================================================

          const translations = notificationTemplates.BOOKING_CANCELLED();

          await notificationService.createNotification(
            {
              userId: current.customerId,

              type: "BOOKING_CANCELLED",

              title: translations.en!.title!,

              message: translations.en!.message!,

              translations,
            },
            tx,
          );

          return {
            appointmentId: current.id,
            groupPurchase: groupPurchaseSummary,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // =====================================================
      // 10. FINAL RESPONSE
      // =====================================================

      return {
        appointmentId: result.appointmentId,
        appointmentStatus: "CANCELLED",
        refundStatus: "NOT_REQUIRED",
        ...(result.groupPurchase && {
          groupPurchase: result.groupPurchase,
        }),
      };
    } catch (error) {
      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isSerializableConflict && attempt < MAX_TRANSACTION_RETRIES) {
        continue;
      }

      if (isSerializableConflict) {
        throw new AppError(
          "Appointment cancellation conflict. Please try again",
          409,
        );
      }

      throw error;
    }
  }

  throw new AppError("Unable to cancel appointment. Please try again", 409);
};

const rescheduleAppointment = async (
  appointmentId: string,
  customerId: string,
  payload: IRescheduleAppointmentPayload,
): Promise<IRescheduleAppointmentResponse> => {
  const { date, startTime, staffId } = payload;

  // =====================================================
  // 1. LOAD CURRENT APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    include: {
      branch: {
        include: {
          bookingPolicy: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 2. CUSTOMER OWNERSHIP
  // =====================================================

  if (appointment.customerId !== customerId) {
    throw new AppError(
      "You are not allowed to reschedule this appointment",
      403,
    );
  }

  // =====================================================
  // 3. VALID STATUS
  // =====================================================

  const reschedulableStatuses: AppointmentStatus[] = [
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  if (!reschedulableStatuses.includes(appointment.appointmentStatus)) {
    throw new AppError(
      "Appointment cannot be rescheduled in its current status",
      409,
    );
  }

  if (
    (appointment.bookingMethod === BookingMethod.RESERVE_NOW ||
      appointment.bookingMethod === BookingMethod.DEPOSIT) &&
    appointment.qrVerifiedAt
  ) {
    throw new AppError("Appointment can no longer be rescheduled", 422);
  }

  if (!appointment.branch.bookingPolicy) {
    throw new AppError("Branch booking policy not found", 404);
  }

  // =====================================================
  // 4. RESCHEDULE CUTOFF
  // =====================================================

  const currentAppointmentDate = appointment.date.toISOString().slice(0, 10);

  const currentAppointmentDateTime = new Date(
    `${currentAppointmentDate}T${appointment.startTime}:00+08:00`,
  );

  const cutoffMilliseconds =
    appointment.branch.bookingPolicy.rescheduleCutoffHours * 60 * 60 * 1000;

  const latestAllowedRescheduleTime = new Date(
    currentAppointmentDateTime.getTime() - cutoffMilliseconds,
  );

  if (new Date() >= latestAllowedRescheduleTime) {
    throw new AppError(
      "Reschedule is no longer allowed for this appointment",
      422,
    );
  }

  // =====================================================
  // 5. HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId: appointment.branchId,

    ...(appointment.serviceId
      ? {
          serviceId: appointment.serviceId,
        }
      : {}),

    ...(appointment.packageId
      ? {
          packageId: appointment.packageId,
        }
      : {}),

    ...(staffId
      ? {
          staffId,
        }
      : {}),

    date,

    excludeAppointmentId: appointmentId,
  });

  const selectedSlot = availability.slots.find(
    (slot) =>
      slot.startTime === startTime &&
      slot.available &&
      (!staffId || slot.staffId === staffId),
  );

  if (!selectedSlot) {
    throw new AppError("The selected time slot is no longer available", 409);
  }

  // =====================================================
  // 6. RESOLVE STAFF
  // =====================================================

  const resolvedStaffId = staffId ?? selectedSlot.staffId;

  const newDateOnly = new Date(`${date}T00:00:00.000Z`);

  const requestedStart = timeToMinutes(startTime);

  const requestedEnd = requestedStart + appointment.durationMinutes;

  const endTime = minutesToTime(requestedEnd);

  // =====================================================
  // 7. TRANSACTION + FINAL HYBRID RECHECK
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const current = await tx.appointment.findUnique({
            where: {
              id: appointmentId,
            },

            select: {
              id: true,
              customerId: true,
              branchId: true,
              appointmentStatus: true,
              qrVerifiedAt: true,
              bookingMethod: true,
            },
          });

          if (!current) {
            throw new AppError("Appointment not found", 404);
          }

          if (current.customerId !== customerId) {
            throw new AppError(
              "You are not allowed to reschedule this appointment",
              403,
            );
          }

          if (!reschedulableStatuses.includes(current.appointmentStatus)) {
            throw new AppError(
              "Appointment cannot be rescheduled in its current status",
              409,
            );
          }

          if (
            (current.bookingMethod === BookingMethod.RESERVE_NOW ||
              current.bookingMethod === BookingMethod.DEPOSIT) &&
            current.qrVerifiedAt
          ) {
            throw new AppError("Appointment can no longer be rescheduled", 422);
          }

          const now = new Date();

          // final staff check
          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            newDateOnly,
            requestedStart,
            requestedEnd,
            now,
            appointmentId,
          );

          // final branch capacity check
          await assertBranchHourlyCapacityAvailable(
            tx,
            current.branchId,
            date,
            newDateOnly,
            requestedStart,
            requestedEnd,
            now,
            appointmentId,
          );

          const updatedAppointment = await tx.appointment.update({
            where: {
              id: appointmentId,
            },

            data: {
              staffId: resolvedStaffId,
              date: newDateOnly,
              startTime,
              endTime,
            },

            select: {
              id: true,
              date: true,
              startTime: true,
              endTime: true,
            },
          });

          // =====================================================
          // CREATE MULTILINGUAL RESCHEDULE NOTIFICATION
          // =====================================================

          const translations = notificationTemplates.BOOKING_RESCHEDULED(
            date,
            startTime,
          );

          await notificationService.createNotification(
            {
              userId: current.customerId,

              type: "BOOKING_RESCHEDULED",

              title: translations.en!.title!,

              message: translations.en!.message!,

              translations,
            },
            tx,
          );

          return updatedAppointment;
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      return {
        appointmentId: result.id,
        date: result.date.toISOString().slice(0, 10),
        startTime: result.startTime,
        endTime: result.endTime,
      };
    } catch (error) {
      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isSerializableConflict && attempt < MAX_TRANSACTION_RETRIES) {
        continue;
      }

      if (isSerializableConflict) {
        throw new AppError(
          "The selected time slot is no longer available",
          409,
        );
      }

      throw error;
    }
  }

  throw new AppError("The selected time slot is no longer available", 409);
};

const getAppointmentQr = async (
  appointmentId: string,
  customerId: string,
): Promise<IAppointmentQrResponse> => {
  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    select: {
      id: true,
      customerId: true,

      bookingMethod: true,
      appointmentStatus: true,

      qrToken: true,
      qrVerifiedAt: true,
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 1. CUSTOMER OWNERSHIP
  // =====================================================

  if (appointment.customerId !== customerId) {
    throw new AppError(
      "You are not allowed to access this appointment QR",
      403,
    );
  }

  // =====================================================
  // 2. PAY NOW HAS NO QR
  // =====================================================

  if (appointment.bookingMethod === BookingMethod.PAY_NOW) {
    return {
      available: false,
      qrValue: null,
    };
  }

  // =====================================================
  // 3. RESERVE NOW QR AVAILABILITY
  // =====================================================

  const isQrAvailable =
    (appointment.bookingMethod === BookingMethod.RESERVE_NOW ||
      appointment.bookingMethod === BookingMethod.DEPOSIT) &&
    appointment.appointmentStatus === AppointmentStatus.RESERVED &&
    Boolean(appointment.qrToken) &&
    !appointment.qrVerifiedAt;

  if (!isQrAvailable || !appointment.qrToken) {
    return {
      available: false,
      qrValue: null,
    };
  }

  return {
    available: true,
    qrValue: `reservation:${appointment.qrToken}`,
  };
};

const verifyQr = async (
  userId: string,
  role: Role,
  payload: IVerifyQrPayload,
): Promise<IVerifyQrResponse> => {
  // =====================================================
  // 0. ROLE VALIDATION
  // =====================================================

  if (
    role !== Role.BRAND_OWNER &&
    role !== Role.BRANCH_MANAGER &&
    role !== Role.STAFF
  ) {
    throw new AppError("You are not allowed to verify appointment QR", 403);
  }

  // =====================================================
  // 1. NORMALIZE QR TOKEN
  // =====================================================

  const qrToken = payload.qrToken.startsWith("reservation:")
    ? payload.qrToken.slice("reservation:".length)
    : payload.qrToken;

  if (!qrToken) {
    throw new AppError("Invalid QR", 400);
  }

  // =====================================================
  // 2. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findFirst({
    where: {
      qrToken,
    },

    include: {
      staff: {
        select: {
          userId: true,
        },
      },

      branch: {
        include: {
          bookingPolicy: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new AppError("Invalid QR", 404);
  }

  // =====================================================
  // 3. BOOKING METHOD VALIDATION
  // =====================================================

  if (appointment.bookingMethod === BookingMethod.PAY_NOW) {
    throw new AppError("QR is not allowed for Pay Now appointments", 409);
  }

  if (
    appointment.bookingMethod !== BookingMethod.RESERVE_NOW &&
    appointment.bookingMethod !== BookingMethod.DEPOSIT
  ) {
    throw new AppError(
      "QR verification is not supported for this booking method",
      409,
    );
  }

  // =====================================================
  // 4. BRANCH VALIDATION
  // =====================================================

  if (appointment.branchId !== payload.branchId) {
    throw new AppError("QR does not belong to this branch", 403);
  }

  // =====================================================
  // 5. ROLE / BRANCH AUTHORIZATION
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: appointment.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError(
        "You are not allowed to verify QR for this branch",
        403,
      );
    }
  }

  if (role === Role.STAFF) {
    if (appointment.staff.userId !== userId) {
      throw new AppError(
        "You are not allowed to verify this appointment QR",
        403,
      );
    }
  }

  // =====================================================
  // 6. QR ALREADY USED
  // =====================================================

  if (appointment.qrVerifiedAt) {
    throw new AppError("QR has already been used", 409);
  }

  // =====================================================
  // 7. APPOINTMENT STATUS
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.RESERVED) {
    throw new AppError("QR cannot be verified for this appointment", 409);
  }

  // =====================================================
  // 8. PAYMENT VALIDATION
  // =====================================================

  if (appointment.bookingMethod === BookingMethod.RESERVE_NOW) {
    if (!payload.paymentMethod) {
      throw new AppError(
        "Payment method is required for reservation verification",
        400,
      );
    }

    if (appointment.paymentStatus !== PaymentStatus.UNPAID) {
      throw new AppError("Reservation payment has already been recorded", 409);
    }
  }

  if (appointment.bookingMethod === BookingMethod.DEPOSIT) {
    if (
      appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID &&
      appointment.paymentStatus !== PaymentStatus.PAID
    ) {
      throw new AppError("Deposit payment is not in a valid state", 409);
    }
  }

  // =====================================================
  // 9. QR EXPIRY
  // =====================================================

  const appointmentDate = appointment.date.toISOString().slice(0, 10);

  const appointmentDateTime = new Date(
    `${appointmentDate}T${appointment.startTime}:00+08:00`,
  );

  if (new Date() >= appointmentDateTime) {
    throw new AppError("QR has expired", 410);
  }

  // =====================================================
  // 10. VERIFIED-BY USER
  // =====================================================

  const verifiedByUser = await prisma.user.findUnique({
    where: {
      id: userId,
    },

    select: {
      id: true,
      name: true,
    },
  });

  if (!verifiedByUser) {
    throw new AppError("Verifier user not found", 404);
  }

  // =====================================================
  // 11. SERIALIZABLE TRANSACTION + RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 12. RECHECK CURRENT APPOINTMENT
          // =============================================

          const current = await tx.appointment.findUnique({
            where: {
              id: appointment.id,
            },

            select: {
              id: true,
              customerId: true,
              branchId: true,
              bookingMethod: true,
              appointmentStatus: true,
              paymentStatus: true,
              qrVerifiedAt: true,
              qrToken: true,
              price: true,
              currency: true,
              date: true,
              startTime: true,
              staff: {
                select: {
                  userId: true,
                },
              },
            },
          });

          if (!current || current.qrToken !== qrToken) {
            throw new AppError("Invalid QR", 404);
          }

          if (
            current.bookingMethod !== BookingMethod.RESERVE_NOW &&
            current.bookingMethod !== BookingMethod.DEPOSIT
          ) {
            throw new AppError(
              "QR verification is not supported for this booking method",
              409,
            );
          }

          if (current.branchId !== payload.branchId) {
            throw new AppError("QR does not belong to this branch", 403);
          }

          if (current.qrVerifiedAt) {
            throw new AppError("QR has already been used", 409);
          }

          if (current.appointmentStatus !== AppointmentStatus.RESERVED) {
            throw new AppError(
              "QR cannot be verified for this appointment",
              409,
            );
          }

          // =============================================
          // 13. FINAL AUTHORIZATION RECHECK
          // =============================================

          if (role === Role.STAFF) {
            if (current.staff.userId !== userId) {
              throw new AppError(
                "You are not allowed to verify this appointment QR",
                403,
              );
            }
          }

          if (role === Role.BRANCH_MANAGER) {
            const managerBranch = await tx.branchManagerBranch.findUnique({
              where: {
                userId_branchId: {
                  userId,
                  branchId: current.branchId,
                },
              },
            });

            if (!managerBranch) {
              throw new AppError(
                "You are not allowed to verify QR for this branch",
                403,
              );
            }
          }

          // =============================================
          // 14. FINAL QR EXPIRY CHECK
          // =============================================

          const currentDate = current.date.toISOString().slice(0, 10);

          const currentAppointmentDateTime = new Date(
            `${currentDate}T${current.startTime}:00+08:00`,
          );

          const qrVerifiedAt = new Date();

          if (qrVerifiedAt >= currentAppointmentDateTime) {
            throw new AppError("QR has expired", 410);
          }

          // =============================================
          // 15. PAYMENT STATE VALIDATION
          // =============================================

          if (current.bookingMethod === BookingMethod.RESERVE_NOW) {
            if (!payload.paymentMethod) {
              throw new AppError(
                "Payment method is required for reservation verification",
                400,
              );
            }

            if (current.paymentStatus !== PaymentStatus.UNPAID) {
              throw new AppError(
                "Reservation payment has already been recorded",
                409,
              );
            }
          }

          if (current.bookingMethod === BookingMethod.DEPOSIT) {
            if (
              current.paymentStatus !== PaymentStatus.PARTIALLY_PAID &&
              current.paymentStatus !== PaymentStatus.PAID
            ) {
              throw new AppError(
                "Deposit payment is not in a valid state",
                409,
              );
            }
          }

          // =============================================
          // 16. ATOMIC SINGLE-USE QR CLAIM
          // =============================================

          const claimResult = await tx.appointment.updateMany({
            where: {
              id: current.id,
              qrToken,
              qrVerifiedAt: null,
              appointmentStatus: AppointmentStatus.RESERVED,
              paymentStatus: current.paymentStatus,
            },

            data: {
              appointmentStatus: AppointmentStatus.CONFIRMED,

              ...(current.bookingMethod === BookingMethod.RESERVE_NOW
                ? {
                    paymentStatus: PaymentStatus.PAID,
                  }
                : {}),

              qrVerifiedAt,
              qrVerifiedBy: userId,
            },
          });

          if (claimResult.count !== 1) {
            throw new AppError(
              "QR has already been used or appointment state changed",
              409,
            );
          }

          // =============================================
          // 17. RECORD FULL SALON PAYMENT
          // =============================================

          let paymentId: string | null = null;

          if (current.bookingMethod === BookingMethod.RESERVE_NOW) {
            const payment = await tx.payment.create({
              data: {
                customerId: current.customerId,

                appointmentId: current.id,

                purpose: PaymentPurpose.APPOINTMENT,

                provider: PaymentProvider.SALON,

                salonPaymentMethod: payload.paymentMethod!,

                amount: current.price,

                currency: current.currency,

                status: PaymentStatus.PAID,

                paidAt: qrVerifiedAt,
              },
            });

            paymentId = payment.id;
          }

          // =============================================
          // 18. GET UPDATED APPOINTMENT
          // =============================================

          const updatedAppointment = await tx.appointment.findUniqueOrThrow({
            where: {
              id: current.id,
            },

            select: {
              id: true,
              customerId: true,
              appointmentStatus: true,
              paymentStatus: true,
              qrVerifiedAt: true,
            },
          });

          // =====================================================
          // 19. MULTILINGUAL CUSTOMER NOTIFICATION
          // =====================================================

          const translations =
            current.bookingMethod === BookingMethod.RESERVE_NOW
              ? notificationTemplates.BOOKING_CONFIRMED_RESERVE_NOW()
              : notificationTemplates.BOOKING_CONFIRMED_DEPOSIT();

          await notificationService.createNotification(
            {
              userId: current.customerId,

              type: "BOOKING_CONFIRMED",

              title: translations.en!.title!,

              message: translations.en!.message!,

              translations,
            },
            tx,
          );

          // =============================================
          // 20. AUDIT LOG
          // =============================================

          await auditLogService.createAuditLog(
            {
              userId,

              action: "QR_VERIFIED",

              entityType: "APPOINTMENT",

              entityId: current.id,

              metadata: {
                previousStatus: current.appointmentStatus,

                newStatus: AppointmentStatus.CONFIRMED,

                previousPaymentStatus: current.paymentStatus,

                newPaymentStatus: updatedAppointment.paymentStatus,

                branchId: current.branchId,

                bookingMethod: current.bookingMethod,

                paymentId,

                paymentMethod:
                  current.bookingMethod === BookingMethod.RESERVE_NOW
                    ? payload.paymentMethod
                    : null,

                paymentProvider:
                  current.bookingMethod === BookingMethod.RESERVE_NOW
                    ? PaymentProvider.SALON
                    : null,

                qrVerifiedAt: qrVerifiedAt.toISOString(),

                performedByRole: role,
              },
            },
            tx,
          );

          return updatedAppointment;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // =====================================================
      // 21. FINAL RESPONSE
      // =====================================================

      if (!result.qrVerifiedAt) {
        throw new AppError("QR verification failed", 500);
      }

      return {
        appointmentId: result.id,

        appointmentStatus: "CONFIRMED",

        paymentStatus: result.paymentStatus,

        qrVerifiedAt: result.qrVerifiedAt,

        verifiedBy: {
          id: verifiedByUser.id,
          name: verifiedByUser.name,
        },
      };
    } catch (error) {
      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      if (isSerializableConflict && attempt < MAX_TRANSACTION_RETRIES) {
        continue;
      }

      if (isSerializableConflict) {
        throw new AppError("QR verification conflict. Please try again", 409);
      }

      throw error;
    }
  }

  throw new AppError("Unable to verify QR. Please try again", 409);
};

const completeAppointment = async (
  appointmentId: string,
  userId: string,
  role: Role,
  payload: ICompleteAppointmentPayload,
): Promise<ICompleteAppointmentResponse> => {
  // =====================================================
  // 1. ROLE VALIDATION
  // =====================================================

  if (
    role !== Role.STAFF &&
    role !== Role.BRANCH_MANAGER &&
    role !== Role.BRAND_OWNER
  ) {
    throw new AppError("You are not allowed to complete appointments", 403);
  }

  // =====================================================
  // 2. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    include: {
      staff: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 3. ROLE / RESOURCE SCOPE
  // =====================================================

  if (role === Role.STAFF) {
    if (appointment.staff.userId !== userId) {
      throw new AppError(
        "You are not allowed to complete this appointment",
        403,
      );
    }
  }

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: appointment.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError(
        "You are not allowed to complete this appointment",
        403,
      );
    }
  }

  // BRAND_OWNER = brand-wide access.

  // =====================================================
  // 4. VALID APPOINTMENT STATUS
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
    throw new AppError(
      "Appointment cannot be completed in its current status",
      409,
    );
  }

  // =====================================================
  // 5. APPOINTMENT END TIME VALIDATION
  // =====================================================

  const allowEarlyCompletion =
    process.env.NODE_ENV === "development" &&
    process.env.ALLOW_EARLY_APPOINTMENT_COMPLETION === "true";

  if (!allowEarlyCompletion) {
    // Assumption:
    // appointment.date represents the booking calendar date
    // stored at UTC midnight.

    const appointmentDate = appointment.date.toISOString().slice(0, 10);

    const endTime = appointment.endTime;

    // Validate HH:mm format.
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
      throw new AppError("Invalid appointment end time", 500);
    }

    // Hong Kong local time is UTC+08:00.
    const appointmentEndDateTime = new Date(
      `${appointmentDate}T${endTime}:00+08:00`,
    );

    if (Number.isNaN(appointmentEndDateTime.getTime())) {
      throw new AppError("Invalid appointment end datetime", 500);
    }

    if (new Date() < appointmentEndDateTime) {
      throw new AppError(
        "Appointment cannot be completed before its scheduled end time",
        409,
      );
    }
  }

  // =====================================================
  // 6. COMPLETE TRANSACTIONALLY
  // =====================================================

  const completedAt = new Date();
  const completionNotes = payload.notes?.trim() || null;

  const result = await prisma.$transaction(async (tx) => {
    // Conditional update prevents concurrent requests from
    // completing the same appointment more than once.

    const updateResult = await tx.appointment.updateMany({
      where: {
        id: appointmentId,
        appointmentStatus: AppointmentStatus.CONFIRMED,
      },

      data: {
        appointmentStatus: AppointmentStatus.COMPLETED,
        completedAt,
        completionNotes,
      },
    });

    if (updateResult.count !== 1) {
      throw new AppError(
        "Appointment cannot be completed in its current status",
        409,
      );
    }

    const updatedAppointment = await tx.appointment.findUniqueOrThrow({
      where: {
        id: appointmentId,
      },

      select: {
        id: true,
        customerId: true,
        appointmentStatus: true,
        completedAt: true,
      },
    });

    // =====================================================
    // 7. MULTILINGUAL CUSTOMER NOTIFICATION
    // =====================================================

    const translations = notificationTemplates.SERVICE_COMPLETED();

    await notificationService.createNotification(
      {
        userId: updatedAppointment.customerId,

        type: "SERVICE_COMPLETED",

        title: translations.en!.title!,

        message: translations.en!.message!,

        translations,
      },
      tx,
    );

    // =====================================================
    // 8. AUDIT LOG
    // =====================================================

    await auditLogService.createAuditLog(
      {
        userId,

        action: "APPOINTMENT_COMPLETED",

        entityType: "APPOINTMENT",

        entityId: updatedAppointment.id,

        metadata: {
          previousStatus: AppointmentStatus.CONFIRMED,
          newStatus: AppointmentStatus.COMPLETED,
          completedAt: completedAt.toISOString(),
          notes: completionNotes,
          performedByRole: role,
        },
      },
      tx,
    );

    return updatedAppointment;
  });

  // =====================================================
  // 9. FINAL RESPONSE
  // =====================================================

  if (!result.completedAt) {
    throw new AppError("Appointment completion failed", 500);
  }

  return {
    appointmentId: result.id,
    appointmentStatus: "COMPLETED",
    completedAt: result.completedAt,
    reviewEnabled: true,
  };
};
const markNoShow = async (
  appointmentId: string,
  userId: string,
  role: Role,
  payload: IMarkNoShowPayload,
): Promise<IMarkNoShowResponse> => {
  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    select: {
      id: true,
      branchId: true,
      appointmentStatus: true,
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", 404);
  }

  // =====================================================
  // 2. BRANCH MANAGER SCOPE
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: appointment.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError(
        "You are not allowed to mark this appointment as no-show",
        403,
      );
    }
  }

  // BRAND_OWNER = brand-wide access.
  // Existing route-level authorization must remain enforced.

  // =====================================================
  // 3. VALID STATUS TRANSITION
  // =====================================================

  const noShowAllowedStatuses: AppointmentStatus[] = [
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  if (!noShowAllowedStatuses.includes(appointment.appointmentStatus)) {
    throw new AppError(
      "Appointment cannot be marked as no-show in its current status",
      409,
    );
  }

  // =====================================================
  // 4. PREPARE NO-SHOW DATA
  // =====================================================

  const noShowAt = new Date();

  const noShowReason = payload.reason.trim();

  // =====================================================
  // 5. UPDATE TRANSACTIONALLY
  // =====================================================

  const result = await prisma.$transaction(async (tx) => {
    // ===================================================
    // 5.1 RE-READ CURRENT APPOINTMENT
    // ===================================================

    const current = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },

      select: {
        id: true,
        customerId: true,
        appointmentStatus: true,
      },
    });

    if (!current) {
      throw new AppError("Appointment not found", 404);
    }

    // ===================================================
    // 5.2 RECHECK STATUS
    // ===================================================

    if (!noShowAllowedStatuses.includes(current.appointmentStatus)) {
      throw new AppError(
        "Appointment cannot be marked as no-show in its current status",
        409,
      );
    }

    // ===================================================
    // 5.3 ATOMIC STATUS UPDATE
    // ===================================================

    const updateResult = await tx.appointment.updateMany({
      where: {
        id: appointmentId,

        appointmentStatus: {
          in: noShowAllowedStatuses,
        },
      },

      data: {
        appointmentStatus: AppointmentStatus.NO_SHOW,

        noShowAt,

        noShowReason,
      },
    });

    if (updateResult.count !== 1) {
      throw new AppError(
        "Appointment cannot be marked as no-show in its current status",
        409,
      );
    }

    // ===================================================
    // 5.4 GET UPDATED APPOINTMENT
    // ===================================================

    const updatedAppointment = await tx.appointment.findUniqueOrThrow({
      where: {
        id: appointmentId,
      },

      select: {
        id: true,
        customerId: true,
        appointmentStatus: true,
      },
    });

    // ===================================================
    // 6. MULTILINGUAL CUSTOMER NOTIFICATION
    // ===================================================

    const translations = notificationTemplates.BOOKING_NO_SHOW();

    await notificationService.createNotification(
      {
        userId: updatedAppointment.customerId,

        type: "BOOKING_NO_SHOW",

        title: translations.en!.title!,

        message: translations.en!.message!,

        translations,
      },
      tx,
    );

    // ===================================================
    // 7. AUDIT LOG
    // ===================================================

    await auditLogService.createAuditLog(
      {
        userId,

        action: "APPOINTMENT_NO_SHOW",

        entityType: "APPOINTMENT",

        entityId: current.id,

        metadata: {
          previousStatus: current.appointmentStatus,

          newStatus: AppointmentStatus.NO_SHOW,

          reason: noShowReason,

          noShowAt: noShowAt.toISOString(),

          performedByRole: role,
        },
      },
      tx,
    );

    return updatedAppointment;
  });

  // =====================================================
  // 8. FINAL RESPONSE
  // =====================================================

  return {
    appointmentId: result.id,

    appointmentStatus: "NO_SHOW",
  };
};

const getBranchAppointments = async (
  branchId: string,
  userId: string,
  role: Role,
  query: IBranchAppointmentsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 0. EXPIRE OLD PENDING APPOINTMENTS
  // =====================================================

  await expirePendingAppointments();

  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
      name: true,
      translations: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. ROLE ACCESS CONTROL
  // =====================================================

  if (
    role !== Role.BRAND_OWNER &&
    role !== Role.BRANCH_MANAGER &&
    role !== Role.STAFF
  ) {
    throw new AppError(
      "You are not allowed to access branch appointments",
      403,
    );
  }

  let staffProfileId: string | null = null;

  // =====================================================
  // 2.1 BRANCH MANAGER ACCESS
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId,
        },
      },

      select: {
        userId: true,
      },
    });

    if (!managerBranch) {
      throw new AppError(
        "You are not allowed to access appointments for this branch",
        403,
      );
    }
  }

  // =====================================================
  // 2.2 STAFF ACCESS
  // =====================================================

  if (role === Role.STAFF) {
    const staff = await prisma.staff.findUnique({
      where: {
        userId,
      },

      select: {
        id: true,

        branches: {
          where: {
            branchId,
          },

          select: {
            branchId: true,
          },
        },
      },
    });

    if (!staff) {
      throw new AppError("Staff not found", 404);
    }

    if (staff.branches.length === 0) {
      throw new AppError(
        "You are not allowed to access appointments for this branch",
        403,
      );
    }

    staffProfileId = staff.id;
  }

  // BRAND_OWNER can access appointments from any branch.

  // =====================================================
  // 3. PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("page must be a positive integer", 400);
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 4. OPTIONAL DATE VALIDATION
  // =====================================================

  let appointmentDate: Date | undefined;

  if (query.date) {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!datePattern.test(query.date)) {
      throw new AppError("date must be in YYYY-MM-DD format", 400);
    }

    const parsedDate = new Date(`${query.date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== query.date
    ) {
      throw new AppError("Invalid appointment date", 400);
    }

    appointmentDate = parsedDate;
  }

  // =====================================================
  // 5. STATUS FILTER
  // =====================================================

  if (
    query.status &&
    query.appointmentStatus &&
    query.status !== query.appointmentStatus
  ) {
    throw new AppError(
      "status and appointmentStatus must have the same value",
      400,
    );
  }

  const status = query.status ?? query.appointmentStatus;

  if (
    status &&
    !Object.values(AppointmentStatus).includes(status as AppointmentStatus)
  ) {
    throw new AppError("Invalid appointment status", 400);
  }

  // =====================================================
  // 6. BOOKING METHOD VALIDATION
  // =====================================================

  if (
    query.bookingMethod &&
    !Object.values(BookingMethod).includes(query.bookingMethod as BookingMethod)
  ) {
    throw new AppError("Invalid booking method", 400);
  }

  // =====================================================
  // 7. PAYMENT STATUS VALIDATION
  // =====================================================

  if (
    query.paymentStatus &&
    !Object.values(PaymentStatus).includes(query.paymentStatus as PaymentStatus)
  ) {
    throw new AppError("Invalid payment status", 400);
  }

  // =====================================================
  // 8. BUILD PRISMA FILTER
  // =====================================================

  const where: Prisma.AppointmentWhereInput = {
    branchId,

    ...(appointmentDate && {
      date: appointmentDate,
    }),

    ...(status && {
      appointmentStatus: status as AppointmentStatus,
    }),

    ...(query.bookingMethod && {
      bookingMethod: query.bookingMethod as BookingMethod,
    }),

    ...(query.paymentStatus && {
      paymentStatus: query.paymentStatus as PaymentStatus,
    }),
  };

  // =====================================================
  // 8.1 STAFF FILTER
  // =====================================================

  if (role === Role.STAFF) {
    // Staff can only view their own appointments.
    where.staffId = staffProfileId!;
  } else if (query.staffId) {
    where.staffId = query.staffId;
  }

  // =====================================================
  // 9. FETCH APPOINTMENTS + COUNT
  // =====================================================

  const [appointments, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,

      skip,
      take: limit,

      orderBy: [
        {
          date: "desc",
        },
        {
          startTime: "asc",
        },
        {
          id: "asc",
        },
      ],

      select: {
        // -----------------------------------------------
        // APPOINTMENT
        // -----------------------------------------------

        id: true,

        bookingMethod: true,
        appointmentStatus: true,
        paymentStatus: true,

        date: true,
        startTime: true,
        endTime: true,

        itemName: true,
        itemNameTranslations: true,

        durationMinutes: true,

        price: true,
        currency: true,

        // -----------------------------------------------
        // DEPOSIT
        // -----------------------------------------------

        depositPercentage: true,
        depositAmount: true,
        remainingAmount: true,

        // -----------------------------------------------
        // QR VERIFICATION
        // -----------------------------------------------

        qrToken: true,
        qrVerifiedAt: true,

        verifiedByUser: {
          select: {
            id: true,
            name: true,
          },
        },

        // -----------------------------------------------
        // REVIEW
        // -----------------------------------------------

        review: {
          select: {
            id: true,
          },
        },

        // -----------------------------------------------
        // CUSTOMER
        // -----------------------------------------------

        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },

        // -----------------------------------------------
        // STAFF
        // -----------------------------------------------

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        // -----------------------------------------------
        // SERVICE
        // -----------------------------------------------

        serviceId: true,

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        // -----------------------------------------------
        // PACKAGE
        // -----------------------------------------------

        packageId: true,

        package: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 10. LOCALIZE BRANCH NAME
  // =====================================================

  const localizedBranch = getLocalizedContent(branch.translations, language, {
    name: branch.name,
  });

  // =====================================================
  // 11. FORMAT RESPONSE ITEMS
  // =====================================================

  const items = appointments.map((appointment) => {
    // ---------------------------------------------------
    // LOCALIZE APPOINTMENT ITEM
    // ---------------------------------------------------

    const localizedItem = getLocalizedContent(
      appointment.itemNameTranslations,
      language,
      {
        name: appointment.itemName,
      },
    );

    // ---------------------------------------------------
    // LOCALIZE SERVICE
    // ---------------------------------------------------

    const localizedService = appointment.service
      ? getLocalizedContent(appointment.service.translations, language, {
          name: appointment.service.name,
        })
      : null;

    // ---------------------------------------------------
    // LOCALIZE PACKAGE
    // ---------------------------------------------------

    const localizedPackage = appointment.package
      ? getLocalizedContent(appointment.package.translations, language, {
          name: appointment.package.name,
        })
      : null;

    // ---------------------------------------------------
    // PAYMENT VALUES
    // ---------------------------------------------------

    const price = Number(appointment.price);

    const depositPercentage = Number(appointment.depositPercentage ?? 0);

    const depositAmount = Number(appointment.depositAmount ?? 0);

    const remainingAmount = Number(appointment.remainingAmount ?? 0);

    // ---------------------------------------------------
    // QR STATUS
    // ---------------------------------------------------

    const qrAvailable = Boolean(appointment.qrToken);

    const qrVerified = Boolean(appointment.qrVerifiedAt);

    const verifiedBy = appointment.verifiedByUser
      ? {
          id: appointment.verifiedByUser.id,
          name: appointment.verifiedByUser.name,
        }
      : null;

    // ---------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------

    return {
      // ================================================
      // BASIC
      // ================================================

      id: appointment.id,

      bookingMethod: appointment.bookingMethod,

      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,

      // ================================================
      // CUSTOMER
      // ================================================

      customer: {
        id: appointment.customer.id,
        name: appointment.customer.name,
        phone: appointment.customer.phone,
      },

      // ================================================
      // BRANCH
      // ================================================

      branch: {
        id: branch.id,
        name: localizedBranch.name ?? branch.name,
      },

      // ================================================
      // STAFF
      // ================================================

      staff: {
        id: appointment.staff.id,
        name: appointment.staff.name,
      },

      // ================================================
      // SERVICE
      // ================================================

      service: appointment.serviceId
        ? {
            id: appointment.serviceId,

            name:
              localizedService?.name ??
              localizedItem.name ??
              appointment.itemName,
          }
        : null,

      // ================================================
      // PACKAGE
      // ================================================

      package: appointment.packageId
        ? {
            id: appointment.packageId,

            name:
              localizedPackage?.name ??
              localizedItem.name ??
              appointment.itemName,
          }
        : null,

      // ================================================
      // DATE / TIME
      // ================================================

      date: appointment.date.toISOString().slice(0, 10),

      startTime: appointment.startTime,
      endTime: appointment.endTime,

      durationMinutes: appointment.durationMinutes,

      // ================================================
      // PAYMENT
      // ================================================

      price,
      currency: appointment.currency,

      depositPercentage,
      depositAmount,
      remainingAmount,

      // ================================================
      // REVIEW
      // ================================================

      reviewed: appointment.review !== null,

      // ================================================
      // QR VERIFICATION
      // ================================================

      qrToken: appointment.qrToken,

      qrVerifiedAt: appointment.qrVerifiedAt,

      qrVerifiedBy: verifiedBy,

      // ================================================
      // QR SUMMARY
      // ================================================

      qr: {
        available: qrAvailable,
        verified: qrVerified,

        verifiedAt: appointment.qrVerifiedAt,

        verifiedBy,
      },
    };
  });

  // =====================================================
  // 12. PAGINATION
  // =====================================================

  const totalPages = Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,

      hasNextPage: page < totalPages,

      hasPreviousPage: page > 1,
    },
  };
};

const getAllAppointments = async (
  query: IAllAppointmentsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 0. EXPIRE OLD PAYMENT HOLDS
  // =====================================================

  await expirePendingAppointments();

  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);

  if (page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (limit < 1 || limit > 100) {
    throw new AppError("limit must be between 1 and 100", 400);
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. FILTERS
  // =====================================================

  const where: Prisma.AppointmentWhereInput = {};

  if (query.branchId) {
    where.branchId = query.branchId;
  }

  if (query.staffId) {
    where.staffId = query.staffId;
  }

  if (query.serviceId) {
    where.serviceId = query.serviceId;
  }

  if (query.packageId) {
    where.packageId = query.packageId;
  }

  if (query.bookingMethod) {
    where.bookingMethod = query.bookingMethod as BookingMethod;
  }

  if (query.appointmentStatus) {
    where.appointmentStatus = query.appointmentStatus as AppointmentStatus;
  }

  if (query.paymentStatus) {
    where.paymentStatus = query.paymentStatus as PaymentStatus;
  }

  if (query.from || query.to) {
    where.date = {};

    if (query.from) {
      where.date.gte = new Date(`${query.from}T00:00:00.000Z`);
    }

    if (query.to) {
      where.date.lte = new Date(`${query.to}T00:00:00.000Z`);
    }
  }

  // =====================================================
  // 3. FETCH + COUNT
  // =====================================================

  const [appointments, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,

      skip,
      take: limit,

      orderBy: [
        {
          date: "desc",
        },
        {
          startTime: "desc",
        },
      ],

      select: {
        id: true,

        bookingMethod: true,
        appointmentStatus: true,
        paymentStatus: true,

        date: true,
        startTime: true,
        endTime: true,

        itemName: true,
        durationMinutes: true,

        price: true,
        currency: true,

        branch: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },

        staff: {
          select: {
            id: true,
            name: true,
          },
        },

        serviceId: true,
        packageId: true,

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        package: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. LOCALIZED RESPONSE DTO
  // =====================================================

  const items = appointments.map((appointment) => {
    // Branch localization
    const localizedBranch = getLocalizedContent(
      appointment.branch.translations,
      language,
      {
        name: appointment.branch.name,
      },
    );

    // Service localization
    const localizedService = appointment.service
      ? getLocalizedContent(appointment.service.translations, language, {
          name: appointment.itemName,
        })
      : null;

    // Package localization
    const localizedPackage = appointment.package
      ? getLocalizedContent(appointment.package.translations, language, {
          name: appointment.itemName,
        })
      : null;

    return {
      id: appointment.id,

      bookingMethod: appointment.bookingMethod,

      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,

      branch: {
        id: appointment.branch.id,
        name: localizedBranch.name,
      },

      customer: {
        id: appointment.customer.id,
        name: appointment.customer.name,
        phone: appointment.customer.phone,
      },

      staff: {
        id: appointment.staff.id,
        name: appointment.staff.name,
      },

      service: appointment.serviceId
        ? {
            id: appointment.serviceId,

            // Localized name, fallback to booking-time snapshot
            name: localizedService?.name ?? appointment.itemName,
          }
        : null,

      package: appointment.packageId
        ? {
            id: appointment.packageId,

            // Localized name, fallback to booking-time snapshot
            name: localizedPackage?.name ?? appointment.itemName,
          }
        : null,

      date: appointment.date.toISOString().slice(0, 10),

      startTime: appointment.startTime,
      endTime: appointment.endTime,

      durationMinutes: appointment.durationMinutes,

      price: Number(appointment.price),
      currency: appointment.currency,
    };
  });

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
};

const recordRemainingPayment = async (
  appointmentId: string,
  payload: TRecordRemainingPayment,
  userId: string,
) => {
  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    include: {
      payments: true,
      branch: true,
    },
  });

  if (!appointment) {
    throw new AppError("Appointment not found", httpStatus.NOT_FOUND);
  }

  // =====================================================
  // 2. VALIDATE BOOKING METHOD
  // =====================================================

  if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
    throw new AppError(
      "Remaining payment is only available for deposit appointments",
      httpStatus.BAD_REQUEST,
    );
  }

  // =====================================================
  // 3. VALIDATE PAYMENT STATUS
  // =====================================================

  if (appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
    throw new AppError(
      "Appointment does not have an outstanding remaining payment",
      httpStatus.BAD_REQUEST,
    );
  }

  // =====================================================
  // 4. VALIDATE APPOINTMENT STATUS
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
    throw new AppError(
      "Appointment must be confirmed before recording remaining payment",
      httpStatus.BAD_REQUEST,
    );
  }

  // =====================================================
  // 5. CHECK EXISTING REMAINING PAYMENT
  // =====================================================

  const existingRemainingPayment = appointment.payments.find(
    (payment) =>
      payment.purpose === PaymentPurpose.APPOINTMENT_REMAINING &&
      payment.status === PaymentStatus.PAID,
  );

  if (existingRemainingPayment) {
    throw new AppError(
      "Remaining payment has already been recorded",
      httpStatus.BAD_REQUEST,
    );
  }

  // =====================================================
  // 6. CALCULATE REMAINING AMOUNT
  // =====================================================

  const totalPrice = Number(appointment.price);

  const depositAmount = Number(appointment.depositAmount ?? 0);

  const remainingAmount = Number((totalPrice - depositAmount).toFixed(2));

  if (remainingAmount <= 0) {
    throw new AppError("No remaining payment is due", httpStatus.BAD_REQUEST);
  }

  // =====================================================
  // 7. TRANSACTION
  // =====================================================

  const result = await prisma.$transaction(async (tx) => {
    // ===================================================
    // 7.1 ATOMIC PAYMENT STATUS CLAIM
    // ===================================================

    const claimResult = await tx.appointment.updateMany({
      where: {
        id: appointmentId,

        bookingMethod: BookingMethod.DEPOSIT,

        appointmentStatus: AppointmentStatus.CONFIRMED,

        paymentStatus: PaymentStatus.PARTIALLY_PAID,
      },

      data: {
        paymentStatus: PaymentStatus.PAID,
      },
    });

    if (claimResult.count !== 1) {
      throw new AppError(
        "Remaining payment has already been recorded or appointment state changed",
        409,
      );
    }

    // ===================================================
    // 7.2 CREATE SALON REMAINING PAYMENT
    // ===================================================

    const payment = await tx.payment.create({
      data: {
        customerId: appointment.customerId,

        appointmentId: appointment.id,

        purpose: PaymentPurpose.APPOINTMENT_REMAINING,

        provider: PaymentProvider.SALON,

        salonPaymentMethod: payload.paymentMethod,

        amount: remainingAmount,

        currency: "HKD",

        status: PaymentStatus.PAID,

        paidAt: new Date(),
      },
    });

    // ===================================================
    // 7.3 GET UPDATED APPOINTMENT
    // ===================================================

    const updatedAppointment = await tx.appointment.findUniqueOrThrow({
      where: {
        id: appointmentId,
      },
    });

    // ===================================================
    // 8. MULTILINGUAL CUSTOMER NOTIFICATION
    // ===================================================

    const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
      Number(payment.amount),
      payment.currency,
    );

    await notificationService.createNotification(
      {
        userId: updatedAppointment.customerId,

        type: "REMAINING_PAYMENT_RECEIVED",

        title: translations.en!.title!,

        message: translations.en!.message!,

        translations,
      },
      tx,
    );

    // ===================================================
    // 9. AUDIT LOG
    // ===================================================

    await auditLogService.createAuditLog(
      {
        userId,

        action: "REMAINING_PAYMENT_RECORDED",

        entityType: "APPOINTMENT",

        entityId: appointment.id,

        metadata: {
          paymentId: payment.id,

          previousPaymentStatus: appointment.paymentStatus,

          newPaymentStatus: updatedAppointment.paymentStatus,

          bookingMethod: appointment.bookingMethod,

          totalPrice,

          depositAmount,

          remainingAmount,

          paymentMethod: payload.paymentMethod,

          provider: PaymentProvider.SALON,
        },
      },
      tx,
    );

    // ===================================================
    // 10. RESPONSE
    // ===================================================

    return {
      appointmentId: updatedAppointment.id,

      bookingMethod: updatedAppointment.bookingMethod,

      appointmentStatus: updatedAppointment.appointmentStatus,

      paymentStatus: updatedAppointment.paymentStatus,

      price: Number(updatedAppointment.price),

      depositAmount: Number(updatedAppointment.depositAmount ?? 0),

      remainingAmount,

      remainingPayment: {
        id: payment.id,

        amount: Number(payment.amount),

        paymentMethod: payment.salonPaymentMethod,

        provider: payment.provider,

        status: payment.status,

        paidAt: payment.paidAt,
      },
    };
  });

  return result;
};

export const appointmentService = {
  createPayNowAppointment,
  createDepositAppointment,
  createReserveAppointment,
  getMyAppointments,
  getAppointmentById,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentQr,
  verifyQr,
  completeAppointment,
  markNoShow,
  getBranchAppointments,
  getAllAppointments,
  recordRemainingPayment,
  expirePendingAppointmentIfNeeded,
  expirePendingAppointments,
};
