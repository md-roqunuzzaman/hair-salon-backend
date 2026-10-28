import { snapshotData } from "../cancellation-refund/policy.snapshot.js";
import { isSnapshot } from "../cancellation-refund/policy.calculation.js";
import {
  cancelWithPolicy,
  previewAppointment,
} from "../cancellation-refund/cancellation-refund.service.js";
import { logUnexpectedError } from "../../utils/normalize-error.js";
import {
  AppointmentStatus,
  BookingMethod,
  DayOfWeek,
  GroupPurchaseFlow,
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
import { generateOrderNumber } from "../../utils/generateOrderNumber.js";
import { getPaymentDisplayStatus } from "../../utils/getPaymentDisplayStatus.js";

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
    logUnexpectedError(error, {
      source: "src/app/module/appointment/appointment.service.ts:81",
    });
  }
};
const expirePendingAppointmentIfNeeded = async (appointmentId: string) => {
  await expirePendingAppointments(appointmentId);
};

const expirePendingAppointments = async (appointmentId?: string) => {
  return prisma.$transaction(
    async (tx) => {
      const now = new Date();

      // =====================================================
      // 1. FILTER ONLY NORMAL PENDING APPOINTMENTS
      // =====================================================

      const where = {
        ...(appointmentId && {
          id: appointmentId,
        }),

        // IMPORTANT:
        // Group Purchase-linked appointments are managed
        // by the Group Purchase expiry lifecycle.
        groupPurchaseId: null,

        appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

        paymentStatus: PaymentStatus.PENDING,

        holdExpiresAt: {
          lte: now,
        },
      };

      // =====================================================
      // 2. FETCH EXPIRED APPOINTMENTS
      // =====================================================

      const appointments = await tx.appointment.findMany({
        where,

        select: {
          id: true,
          customerId: true,
        },

        take: 100,
      });

      let expiredCount = 0;

      // =====================================================
      // 3. PROCESS EACH APPOINTMENT
      // =====================================================

      for (const appointment of appointments) {
        // =================================================
        // 4. ATOMIC EXPIRY CLAIM
        // =================================================

        const changed = await tx.appointment.updateMany({
          where: {
            ...where,
            id: appointment.id,
          },

          data: {
            appointmentStatus: AppointmentStatus.EXPIRED,

            paymentStatus: PaymentStatus.FAILED,

            holdExpiresAt: null,
          },
        });

        if (changed.count !== 1) {
          continue;
        }

        // =================================================
        // 5. MULTILINGUAL CUSTOMER NOTIFICATION
        // =================================================

        await notificationService.createNotification(
          {
            userId: appointment.customerId,

            appointmentId: appointment.id,

            type: "BOOKING_EXPIRED",

            title: "Booking expired",

            message:
              "Your booking expired because payment was not completed before the deadline. Please make a new booking.",

            translations: {
              "zh-CN": {
                title: "预约已过期",
                message: "您未在付款期限内完成付款，预约已过期。请重新预约。",
              },

              "zh-HK": {
                title: "預約已過期",
                message: "您未在付款期限內完成付款，預約已過期。請重新預約。",
              },
            },
          },
          tx,
        );

        expiredCount++;
      }

      // =====================================================
      // 6. RESPONSE
      // =====================================================

      return {
        expiredCount,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
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

type ResolveAvailableStaffParams = {
  tx: Prisma.TransactionClient;
  branchId: string;
  serviceId?: string | null;
  packageId?: string | null;
  staffId?: string | null;
  date: string;
  dateOnly: Date;
  requestedStart: number;
  requestedEnd: number;
  now: Date;
  excludeAppointmentId?: string;
};

export const resolveAvailableStaff = async ({
  tx,
  branchId,
  serviceId,
  packageId,
  staffId,
  date,
  dateOnly,
  requestedStart,
  requestedEnd,
  now,
  excludeAppointmentId,
}: ResolveAvailableStaffParams): Promise<string> => {
  // =====================================================
  // 1. VALIDATE REQUESTED TIME
  // =====================================================

  if (
    requestedStart < 0 ||
    requestedEnd > 24 * 60 ||
    requestedStart >= requestedEnd
  ) {
    throw new AppError("Invalid booking time range", 400);
  }

  // =====================================================
  // 2. GET DAY OF WEEK
  // =====================================================

  const dayNames = [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ];

  const day = dayNames[new Date(`${date}T00:00:00.000Z`).getUTCDay()];

  // =====================================================
  // 3. VALIDATE BRANCH BUSINESS HOURS
  // =====================================================

  const businessHour = await tx.branchBusinessHour.findFirst({
    where: {
      branchId,
      day,
    },
    select: {
      isClosed: true,
      openTime: true,
      closeTime: true,
    },
  });

  if (
    !businessHour ||
    businessHour.isClosed ||
    !businessHour.openTime ||
    !businessHour.closeTime
  ) {
    throw new AppError("Branch is closed on this day", 409);
  }

  if (
    requestedStart < timeToMinutes(businessHour.openTime) ||
    requestedEnd > timeToMinutes(businessHour.closeTime)
  ) {
    throw new AppError(
      "Requested booking time is outside branch business hours",
      409,
    );
  }

  // =====================================================
  // 4. FIND ELIGIBLE STAFF
  // =====================================================

  const eligibleStaff = await tx.staff.findMany({
    where: {
      ...(staffId ? { id: staffId } : {}),

      status: "ACTIVE",

      branches: {
        some: {
          branchId,
        },
      },

      ...(serviceId
        ? {
            services: {
              some: {
                serviceId,
              },
            },
          }
        : {
            packages: {
              some: {
                packageId: packageId!,
              },
            },
          }),
    },

    select: {
      id: true,
    },

    orderBy: {
      id: "asc",
    },
  });

  if (eligibleStaff.length === 0) {
    throw new AppError(
      staffId
        ? "Selected staff is not eligible for this booking"
        : "No eligible staff available for this booking",
      409,
    );
  }

  const staffIds = eligibleStaff.map((staff) => staff.id);

  // =====================================================
  // 5. FETCH STAFF SCHEDULES
  // =====================================================

  const schedules = await tx.staffSchedule.findMany({
    where: {
      staffId: {
        in: staffIds,
      },
      branchId,
      day,
    },
    select: {
      staffId: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 6. FETCH STAFF UNAVAILABILITY
  // =====================================================

  const unavailability = await tx.staffUnavailability.findMany({
    where: {
      staffId: {
        in: staffIds,
      },
      date: dateOnly,
    },
    select: {
      staffId: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 7. FETCH BLOCKING APPOINTMENTS
  // =====================================================

  const blockingAppointments = await tx.appointment.findMany({
    where: {
      ...(excludeAppointmentId
        ? {
            id: {
              not: excludeAppointmentId,
            },
          }
        : {}),

      staffId: {
        in: staffIds,
      },

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
      staffId: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 8. CHECK STAFF CANDIDATES
  // =====================================================

  const overlaps = (
    startA: number,
    endA: number,
    startB: number,
    endB: number,
  ) => startA < endB && endA > startB;

  for (const staff of eligibleStaff) {
    // Check schedule covers the complete booking.
    const hasValidSchedule = schedules.some((schedule) => {
      if (schedule.staffId !== staff.id) return false;

      return (
        requestedStart >= timeToMinutes(schedule.startTime) &&
        requestedEnd <= timeToMinutes(schedule.endTime)
      );
    });

    if (!hasValidSchedule) continue;

    // Check breaks, leave and other unavailability.
    const isUnavailable = unavailability.some((item) => {
      if (item.staffId !== staff.id) return false;

      return overlaps(
        requestedStart,
        requestedEnd,
        timeToMinutes(item.startTime),
        timeToMinutes(item.endTime),
      );
    });

    if (isUnavailable) continue;

    // Check existing appointments and active holds.
    const hasAppointmentConflict = blockingAppointments.some((appointment) => {
      if (appointment.staffId !== staff.id) return false;

      return overlaps(
        requestedStart,
        requestedEnd,
        timeToMinutes(appointment.startTime),
        timeToMinutes(appointment.endTime),
      );
    });

    if (hasAppointmentConflict) continue;

    // Staff is eligible and available.
    return staff.id;
  }

  // =====================================================
  // 9. NO STAFF AVAILABLE
  // =====================================================

  throw new AppError(
    staffId
      ? "Selected staff is no longer available for this time slot"
      : "No staff is currently available for this time slot",
    409,
  );
};

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
  // 10:30â€“12:00
  // checks:
  // 10:00â€“11:00
  // 11:00â€“12:00
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
  console.log("CREATE PAY NOW FUNCTION CALLED");

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
  // 2. PREPARE BOOKING DATE
  // =====================================================

  // Do not assign staff from requestedSlot.staffId.
  // AUTO staff assignment happens inside the transaction.

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    const orderNumber = generateOrderNumber();

    try {
      console.log(`[PAY_NOW] Transaction attempt: ${attempt}`);

      const result = await prisma.$transaction(
        async (tx) => {
          // =====================================================
          // 4. MERCHANT BOOKING METHOD VALIDATION
          // =====================================================

          const bookingPolicy = await tx.branchBookingPolicy.findUnique({
            where: {
              branchId,
            },
            select: {
              allowedBookingMethods: true,
            },
          });

          if (!bookingPolicy) {
            throw new AppError("Branch booking policy not found", 404);
          }

          if (
            !bookingPolicy.allowedBookingMethods.includes(BookingMethod.PAY_NOW)
          ) {
            throw new AppError(
              "PAY_NOW booking is not enabled for this branch",
              400,
            );
          }

          console.log("[PAY_NOW] Merchant booking method verified");

          // =====================================================
          // 5. BOOKING TARGET SNAPSHOT
          // =====================================================

          let itemName: string;

          let itemNameTranslations: Prisma.InputJsonValue | undefined;

          let durationMinutes: number;

          let price: Prisma.Decimal;

          if (serviceId) {
            // =====================================================
            // SERVICE BOOKING
            // =====================================================

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
            // =====================================================
            // PACKAGE BOOKING
            // =====================================================

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

          // =====================================================
          // 6. DEBUG BOOKING SNAPSHOT
          // =====================================================

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

          // =====================================================
          // 7. REQUESTED TIME RANGE
          // =====================================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =====================================================
          // 8. SMART STAFF RESOLUTION INSIDE TRANSACTION
          // =====================================================

          // Specific Staff:
          // Validate and assign only the requested staff.
          //
          // Any Staff:
          // Find an eligible staff who is available now.
          // Skip busy or unavailable staff automatically.

          const resolvedStaffId = await resolveAvailableStaff({
            tx,
            branchId,
            serviceId,
            packageId,
            staffId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          });

          console.log(
            "[PAY_NOW] Staff assigned inside transaction:",
            resolvedStaffId,
          );

          console.log(
            "[PAY_NOW] Staff selection mode:",
            staffId ? "SELECTED" : "AUTO",
          );

          // =====================================================
          // 9. FINAL BRANCH CAPACITY RECHECK
          // =====================================================

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

          // =====================================================
          // 10. TEMPORARY PAY-NOW HOLD
          // =====================================================

          const holdExpiresAt = new Date(
            now.getTime() + PAY_NOW_HOLD_MINUTES * 60 * 1000,
          );

          // =====================================================
          // 11. CREATE APPOINTMENT
          // =====================================================

          const appointment = await tx.appointment.create({
            data: {
              ...(await snapshotData(tx, branchId, "SERVICE")),
              customerId,
              orderNumber,

              branchId,

              // Resolved inside the Serializable transaction.
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
              orderNumber: true,
              staffId: true,

              bookingMethod: true,

              appointmentStatus: true,

              paymentStatus: true,

              holdExpiresAt: true,

              itemName: true,

              itemNameTranslations: true,
            },
          });

          await notificationService.notifyAppointmentTeam(
            appointment.id,
            {
              type: "BOOKING_CREATED",
              title: "New booking",
            },
            tx,
          );

          console.log("\n========== APPOINTMENT CREATED ==========");
          console.log("Appointment ID:", appointment.id);
          console.log("Assigned Staff ID:", appointment.staffId);
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
      // 12. TRANSACTION COMMITTED
      // =====================================================

      console.log("\n========== TRANSACTION COMMITTED ==========");
      console.log("Appointment ID:", result.id);
      console.log("Assigned Staff ID:", result.staffId);
      console.log(
        "Item Name Translations:",
        JSON.stringify(result.itemNameTranslations, null, 2),
      );
      console.log("===========================================");

      // =====================================================
      // 13. RESPONSE
      // =====================================================

      return {
        appointmentId: result.id,
        orderNumber: result.orderNumber!,
        bookingMethod: "PAY_NOW",

        appointmentStatus: "PENDING_PAYMENT",

        paymentStatus: "PENDING",

        holdExpiresAt: result.holdExpiresAt!,

        qrAvailable: false,
      };
    } catch (error) {
      logUnexpectedError(error, {
        source:
          "src/app/module/appointment/appointment.service.ts:createPayNowAppointment",
      });

      // ============================================
      // 1. SERIALIZABLE TRANSACTION CONFLICT
      // ============================================

      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      // ============================================
      // 2. ORDER NUMBER UNIQUE COLLISION
      // ============================================

      const isOrderNumberCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes("orderNumber");

      // ============================================
      // 3. RETRY ORDER NUMBER COLLISION
      // ============================================

      if (isOrderNumberCollision && attempt < MAX_TRANSACTION_RETRIES) {
        console.warn("[PAY_NOW] Order number collision. Retrying...");
        continue;
      }

      if (isOrderNumberCollision) {
        throw new AppError(
          "Could not generate a unique order number. Please try again.",
          503,
        );
      }

      // ============================================
      // 4. EXISTING SERIALIZABLE RETRY
      // ============================================

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

      // ============================================
      // 5. OTHER ERRORS
      // ============================================

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

  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  // =====================================================
  // 1. INITIAL AVAILABILITY CHECK
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
    throw new AppError("The selected time slot is no longer available", 409);
  }

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 2. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    const orderNumber = generateOrderNumber();
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // =================================================
          // 3. BRANCH + DEPOSIT POLICY
          // =================================================

          const branch = await tx.branch.findUnique({
            where: { id: branchId },
            include: { bookingPolicy: true },
          });

          if (!branch) {
            throw new AppError("Branch not found", 404);
          }

          if (!branch.bookingPolicy) {
            throw new AppError("Branch booking policy not found", 404);
          }

          if (
            !branch.bookingPolicy.allowedBookingMethods.includes(
              BookingMethod.DEPOSIT,
            )
          ) {
            throw new AppError(
              "DEPOSIT booking is not enabled for this branch",
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

          // =================================================
          // 4. BOOKING TARGET + MULTILINGUAL SNAPSHOT
          // =================================================

          let itemName: string;
          let itemNameTranslations: Prisma.InputJsonValue | undefined;
          let durationMinutes: number;
          let price: Prisma.Decimal;

          if (serviceId) {
            const service = await tx.service.findUnique({
              where: { id: serviceId },
              select: {
                id: true,
                name: true,
                translations: true,
                price: true,
                durationMinutes: true,
                status: true,
                branches: {
                  where: { branchId },
                  select: { branchId: true },
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

            itemName = service.name;

            itemNameTranslations =
              service.translations === null
                ? undefined
                : (service.translations as Prisma.InputJsonValue);

            durationMinutes = service.durationMinutes;
            price = service.price;
          } else {
            const packageData = await tx.package.findUnique({
              where: { id: packageId! },
              select: {
                id: true,
                name: true,
                translations: true,
                packagePrice: true,
                durationMinutes: true,
                status: true,
                branches: {
                  where: { branchId },
                  select: { branchId: true },
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

            itemName = packageData.name;

            itemNameTranslations =
              packageData.translations === null
                ? undefined
                : (packageData.translations as Prisma.InputJsonValue);

            durationMinutes = packageData.durationMinutes;
            price = packageData.packagePrice;
          }

          // =================================================
          // 5. DEPOSIT CALCULATION
          // =================================================

          const depositAmount = price
            .mul(depositPercentage)
            .div(100)
            .toDecimalPlaces(2);

          const remainingAmount = price.sub(depositAmount).toDecimalPlaces(2);

          // =================================================
          // 6. REQUESTED TIME RANGE
          // =================================================

          const requestedStart = timeToMinutes(startTime);
          const requestedEnd = requestedStart + durationMinutes;
          const endTime = minutesToTime(requestedEnd);
          const now = new Date();

          // =================================================
          // 7. RESOLVE AVAILABLE STAFF INSIDE TRANSACTION
          // =================================================

          const resolvedStaffId = await resolveAvailableStaff({
            tx,
            branchId,
            serviceId,
            packageId,
            staffId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          });

          console.log(
            "[DEPOSIT] Staff selection:",
            staffId ? "SPECIFIC" : "AUTO",
          );

          console.log("[DEPOSIT] Resolved staff ID:", resolvedStaffId);

          // =================================================
          // 8. FINAL STAFF AVAILABILITY RECHECK
          // =================================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          // =================================================
          // 9. FINAL BRANCH CAPACITY RECHECK
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

          // =================================================
          // 10. TEMPORARY DEPOSIT PAYMENT HOLD
          // =================================================

          const holdExpiresAt = new Date(
            now.getTime() + PAY_NOW_HOLD_MINUTES * 60 * 1000,
          );

          // =================================================
          // 11. CREATE DEPOSIT APPOINTMENT
          // =================================================

          const appointment = await tx.appointment.create({
            data: {
              ...(await snapshotData(tx, branchId, "SERVICE")),
              customerId,
              orderNumber,
              branchId,

              staffId: resolvedStaffId,

              serviceId: serviceId ?? null,
              packageId: packageId ?? null,

              bookingMethod: BookingMethod.DEPOSIT,

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

              depositPercentage,
              depositAmount,
              remainingAmount,

              holdExpiresAt,

              qrToken: null,
              qrVerifiedAt: null,
              qrVerifiedBy: null,
            },
            select: {
              id: true,
              orderNumber: true,
              staffId: true,
              bookingMethod: true,
              appointmentStatus: true,
              paymentStatus: true,
              price: true,
              depositPercentage: true,
              depositAmount: true,
              remainingAmount: true,
              holdExpiresAt: true,
              itemName: true,
              itemNameTranslations: true,
            },
          });

          // =================================================
          // 12. EXISTING TEAM NOTIFICATION
          // =================================================

          await notificationService.notifyAppointmentTeam(
            appointment.id,
            {
              type: "BOOKING_CREATED",
              title: "New booking",
            },
            tx,
          );

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
      // 13. RESPONSE
      // =====================================================

      return {
        appointmentId: result.id,
        orderNumber: result.orderNumber!,

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
      logUnexpectedError(error, {
        source:
          "src/app/module/appointment/appointment.service.ts:createDepositAppointment",
      });

      // ============================================
      // SERIALIZABLE TRANSACTION CONFLICT
      // ============================================

      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      // ============================================
      // ORDER NUMBER UNIQUE COLLISION
      // ============================================

      const isOrderNumberCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes("orderNumber");

      // ============================================
      // RETRY ORDER NUMBER COLLISION
      // ============================================

      if (isOrderNumberCollision && attempt < MAX_TRANSACTION_RETRIES) {
        console.warn("[DEPOSIT] Order number collision. Retrying...");
        continue;
      }

      if (isOrderNumberCollision) {
        throw new AppError(
          "Could not generate a unique order number. Please try again.",
          503,
        );
      }

      // ============================================
      // EXISTING SERIALIZABLE RETRY
      // ============================================

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
  console.log("[RESERVE_NOW] Service function called");

  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  console.log("\n========== RESERVE NOW BOOKING START ==========");
  console.log("Branch ID:", branchId);
  console.log("Service ID:", serviceId);
  console.log("Package ID:", packageId);
  console.log("Staff Selection:", staffId ? "SPECIFIC" : "AUTO");
  console.log("Date:", date);
  console.log("Start Time:", startTime);
  console.log("===============================================");

  // =====================================================
  // 1. INITIAL AVAILABILITY CHECK
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
    throw new AppError("The selected time slot is no longer available", 409);
  }

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 2. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    const orderNumber = generateOrderNumber();
    try {
      console.log(`[RESERVE_NOW] Transaction attempt: ${attempt}`);

      const result = await prisma.$transaction(
        async (tx) => {
          // =================================================
          // 3. MERCHANT BOOKING METHOD VALIDATION
          // =================================================

          const bookingPolicy = await tx.branchBookingPolicy.findUnique({
            where: {
              branchId,
            },
            select: {
              allowedBookingMethods: true,
            },
          });

          if (!bookingPolicy) {
            throw new AppError("Branch booking policy not found", 404);
          }

          if (
            !bookingPolicy.allowedBookingMethods.includes(
              BookingMethod.RESERVE_NOW,
            )
          ) {
            throw new AppError(
              "RESERVE_NOW booking is not enabled for this branch",
              400,
            );
          }

          // =================================================
          // 4. BOOKING TARGET + MULTILINGUAL SNAPSHOT
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

            itemName = packageData.name;

            itemNameTranslations =
              packageData.translations === null
                ? undefined
                : (packageData.translations as Prisma.InputJsonValue);

            durationMinutes = packageData.durationMinutes;

            price = packageData.packagePrice;
          }

          // =================================================
          // 5. REQUESTED TIME RANGE
          // =================================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =================================================
          // 6. RESOLVE AVAILABLE STAFF INSIDE TRANSACTION
          // =================================================

          const resolvedStaffId = await resolveAvailableStaff({
            tx,
            branchId,
            serviceId,
            packageId,
            staffId,
            date,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          });

          console.log(
            "[RESERVE_NOW] Staff selection mode:",
            staffId ? "SPECIFIC" : "AUTO",
          );

          console.log("[RESERVE_NOW] Resolved Staff ID:", resolvedStaffId);

          // =================================================
          // 7. FINAL STAFF AVAILABILITY RECHECK
          // =================================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          console.log("[RESERVE_NOW] Staff availability verified");

          // =================================================
          // 8. FINAL BRANCH CAPACITY RECHECK
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

          console.log("[RESERVE_NOW] Branch capacity verified");

          // =================================================
          // 9. SECURE QR TOKEN
          // =================================================

          const qrToken = crypto.randomBytes(32).toString("hex");

          // Never log the QR token.

          // =================================================
          // 10. CREATE RESERVED APPOINTMENT
          // =================================================

          const appointment = await tx.appointment.create({
            data: {
              ...(await snapshotData(tx, branchId, "SERVICE")),
              customerId,
              orderNumber,

              branchId,

              // Specific Staff OR Any Staff
              staffId: resolvedStaffId,

              serviceId: serviceId ?? null,

              packageId: packageId ?? null,

              bookingMethod: BookingMethod.RESERVE_NOW,

              appointmentStatus: AppointmentStatus.RESERVED,

              paymentStatus: PaymentStatus.UNPAID,

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

              // RESERVE_NOW does not use a temporary payment hold.
              holdExpiresAt: null,

              qrToken,

              qrVerifiedAt: null,

              qrVerifiedBy: null,
            },
            select: {
              id: true,
              orderNumber: true,
              staffId: true,

              qrToken: true,

              itemName: true,

              itemNameTranslations: true,

              appointmentStatus: true,

              paymentStatus: true,
            },
          });

          if (!appointment.qrToken) {
            throw new AppError("Reservation QR could not be created", 500);
          }

          console.log("[RESERVE_NOW] Appointment created:", appointment.id);

          console.log("[RESERVE_NOW] Assigned staff:", appointment.staffId);

          // =================================================
          // 11. MULTILINGUAL BOOKING RESERVED NOTIFICATION
          // =================================================

          const translations = notificationTemplates.BOOKING_RESERVED(
            date,
            startTime,
          );

          await notificationService.createNotification(
            {
              appointmentId: appointment.id,

              userId: customerId,

              type: "BOOKING_RESERVED",

              title: translations.en!.title!,

              message: translations.en!.message!,

              translations,
            },
            tx,
          );

          console.log("[RESERVE_NOW] Booking notification created");

          // =================================================
          // 12. RETURN APPOINTMENT FROM TRANSACTION
          // =================================================

          return appointment;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // =====================================================
      // 13. RESPONSE
      // =====================================================

      return {
        appointmentId: result.id,
        orderNumber: result.orderNumber!,

        bookingMethod: "RESERVE_NOW",

        appointmentStatus: "RESERVED",

        paymentStatus: "UNPAID",

        qr: {
          available: true,

          token: result.qrToken!,
        },
      };
    } catch (error) {
      logUnexpectedError(error, {
        source:
          "src/app/module/appointment/appointment.service.ts:createReserveAppointment",
      });

      // ============================================
      // SERIALIZABLE TRANSACTION CONFLICT
      // ============================================

      const isSerializableConflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034";

      // ============================================
      // ORDER NUMBER UNIQUE COLLISION
      // ============================================

      const isOrderNumberCollision =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(error.meta?.target) &&
        error.meta.target.includes("orderNumber");

      // ============================================
      // RETRY ORDER NUMBER COLLISION
      // ============================================

      if (isOrderNumberCollision && attempt < MAX_TRANSACTION_RETRIES) {
        console.warn("[RESERVE_NOW] Order number collision. Retrying...");
        continue;
      }

      if (isOrderNumberCollision) {
        throw new AppError(
          "Could not generate a unique order number. Please try again.",
          503,
        );
      }

      // ============================================
      // EXISTING SERIALIZABLE RETRY
      // ============================================

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
        orderNumber: true,

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
            purpose: true,
            status: true,
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
    // 5. QR STATE - ALL BOOKING METHODS
    // =====================================================

    const qrEligibleStatuses: AppointmentStatus[] = [
      AppointmentStatus.RESERVED,
      AppointmentStatus.CONFIRMED,
    ];

    const qrAvailable =
      qrEligibleStatuses.includes(appointment.appointmentStatus) &&
      Boolean(appointment.qrToken) &&
      !appointment.qrVerifiedAt;

    // =====================================================
    // 6. PAYMENT SUMMARY
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
    // 7. ACTUAL SUCCESSFUL PAYMENTS
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
      const refunded = payment.refunds.reduce(
        (sum, refund) => sum + Number(refund.amount),
        0,
      );

      return total + refunded;
    }, 0);

    const netPaid = Math.max(0, Number((grossPaid - totalRefunded).toFixed(2)));

    // =====================================================
    // 8. VERIFY ACTUAL DEPOSIT PAYMENT
    // =====================================================

    const depositPaid =
      isDepositBooking &&
      appointment.payments.some((payment) => {
        if (payment.purpose !== "APPOINTMENT_DEPOSIT") {
          return false;
        }

        if (!successfulPaymentStatuses.includes(payment.status)) {
          return false;
        }

        if (!payment.paidAt) {
          return false;
        }

        const refundedAmount = payment.refunds.reduce(
          (sum, refund) => sum + Number(refund.amount),
          0,
        );

        const depositNetPaid = Number(
          (Number(payment.amount) - refundedAmount).toFixed(2),
        );

        return depositNetPaid > 0;
      });

    // =====================================================
    // 9. PAYMENT DISPLAY STATUS
    // =====================================================

    const paymentDisplayStatus = getPaymentDisplayStatus(
      appointment.paymentStatus,
      appointment.bookingMethod,
      depositPaid,
    );

    // =====================================================
    // 10. APPOINTMENT COLLECTION STATE
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

    if (appointment.paymentStatus === PaymentStatus.PAID) {
      amountDue = 0;
    } else if (appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID) {
      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
    } else if (appointment.paymentStatus === PaymentStatus.PARTIALLY_REFUNDED) {
      amountDue = 0;
    } else if (appointment.paymentStatus === PaymentStatus.REFUNDED) {
      amountDue = 0;
    } else {
      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
    }

    if (isClosedWithoutCollection) {
      amountDue = 0;
    }

    // =====================================================
    // 11. REMAINING BALANCE
    // =====================================================

    let remainingAmount = amountDue;

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
    // 12. FINAL RESPONSE DTO
    // =====================================================

    return {
      id: appointment.id,
      orderNumber: appointment.orderNumber,

      bookingMethod: appointment.bookingMethod,
      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,
      paymentDisplayStatus,

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
  // 13. PAGINATION RESPONSE
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
          purpose: true,
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

  // QR availability for all supported booking methods.
  // A QR must exist, remain unused, and the appointment
  // must be in an eligible state.

  const qrEligibleStatuses: AppointmentStatus[] = [
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  const qrAvailable =
    qrEligibleStatuses.includes(appointment.appointmentStatus) &&
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
  // 7. DEPOSIT INFORMATION
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
  // 9. VERIFY SUCCESSFUL DEPOSIT PAYMENT
  // =====================================================

  const depositPaid =
    isDepositBooking &&
    appointment.payments.some((payment) => {
      if (payment.purpose !== "APPOINTMENT_DEPOSIT") {
        return false;
      }

      if (!successfulPaymentStatuses.includes(payment.status)) {
        return false;
      }

      if (!payment.paidAt) {
        return false;
      }

      const refundedAmount = payment.refunds.reduce(
        (sum, refund) => sum + Number(refund.amount),
        0,
      );

      const depositNetPaid = Number(
        (Number(payment.amount) - refundedAmount).toFixed(2),
      );

      return depositNetPaid > 0;
    });

  // =====================================================
  // 10. PAYMENT DISPLAY STATUS
  // =====================================================

  const paymentDisplayStatus = getPaymentDisplayStatus(
    appointment.paymentStatus,
    appointment.bookingMethod,
    depositPaid,
  );

  // =====================================================
  // 11. FINANCIAL STATE
  // =====================================================

  const closedStatuses: AppointmentStatus[] = [
    AppointmentStatus.CANCELLED,
    AppointmentStatus.EXPIRED,
    AppointmentStatus.NO_SHOW,
  ];

  const isClosedWithoutCollection = closedStatuses.includes(
    appointment.appointmentStatus,
  );

  const amountPaid = netPaid;

  let amountDue = 0;

  switch (appointment.paymentStatus) {
    case PaymentStatus.PAID:
      amountDue = 0;
      break;

    case PaymentStatus.PARTIALLY_PAID:
      amountDue = Math.max(0, Number((price - amountPaid).toFixed(2)));
      break;

    case PaymentStatus.PARTIALLY_REFUNDED:
      // Refund does not automatically reopen payment obligation.
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
  // 12. REMAINING BALANCE
  // =====================================================

  const remainingAmount = amountDue;

  // =====================================================
  // 13. LATEST SUCCESSFUL PAYMENT
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
  // 14. RESPONSE DTO
  // =====================================================

  return {
    id: appointment.id,
    orderNumber: appointment.orderNumber,

    bookingMethod: appointment.bookingMethod,

    appointmentStatus: appointment.appointmentStatus,

    paymentStatus: appointment.paymentStatus,

    paymentDisplayStatus,

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
  // 3. BLOCK CANCELLATION AFTER QR CHECK-IN
  // =====================================================

  if (appointment.qrVerifiedAt !== null) {
    throw new AppError(
      "Appointment cannot be cancelled because the customer has already checked in",
      409,
    );
  }

  // =====================================================
  // 4. NEW CANCELLATION POLICY FLOW
  // =====================================================

  if (
    isSnapshot(appointment.cancellationPolicySnapshot) &&
    !appointment.cancellationPolicySnapshot.legacy
  ) {
    const preview = await previewAppointment(appointmentId, userId, role);

    return (await cancelWithPolicy(appointmentId, userId, role, {
      reason: payload.reason,
      idempotencyKey: "existing-route-" + appointmentId,
      previewToken: preview.previewToken,
    })) as unknown as ICancelAppointmentResponse;
  }

  // =====================================================
  // 5. STATUS VALIDATION
  // =====================================================

  if (!cancellableStatuses.includes(appointment.appointmentStatus)) {
    throw new AppError(
      "Appointment cannot be cancelled in its current status",
      409,
    );
  }

  // =====================================================
  // 6. CUSTOMER CANCELLATION POLICY
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
  // 7. GROUP PURCHASE IDENTIFICATION
  // =====================================================

  const isGroupPurchaseRedemption =
    appointment.bookingMethod === BookingMethod.GROUP_PURCHASE &&
    appointment.groupPurchaseId !== null;

  const isInitialBookNowAppointment =
    appointment.groupPurchaseId !== null &&
    appointment.bookingMethod !== BookingMethod.GROUP_PURCHASE;

  if (
    appointment.bookingMethod === BookingMethod.GROUP_PURCHASE &&
    !appointment.groupPurchaseId
  ) {
    throw new AppError("Group purchase reference is missing", 409);
  }

  // =====================================================
  // 8. BLOCK INITIAL BOOK NOW CANCELLATION
  // =====================================================

  if (isInitialBookNowAppointment) {
    throw new AppError(
      "Initial Book Now appointment cancellation requires package-level cancellation processing",
      409,
    );
  }

  // =====================================================
  // 9. PRESERVE PAID BOOKING RESTRICTION
  // =====================================================

  if (
    !isGroupPurchaseRedemption &&
    (appointment.paymentStatus === PaymentStatus.PAID ||
      appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID)
  ) {
    throw new AppError(
      "Paid appointment cancellation requires refund processing",
      422,
    );
  }

  // =====================================================
  // 10. SERIALIZABLE TRANSACTION + RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 10.1 RE-READ CURRENT APPOINTMENT
          // =============================================

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
              qrVerifiedAt: true,
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

          // =============================================
          // 10.2 RECHECK AUTHORIZATION
          // =============================================

          if (role === Role.CUSTOMER && current.customerId !== userId) {
            throw new AppError(
              "You are not allowed to cancel this appointment",
              403,
            );
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
                "You are not allowed to cancel this appointment",
                403,
              );
            }
          }

          // =============================================
          // 10.3 RECHECK QR VERIFICATION
          // =============================================

          if (current.qrVerifiedAt !== null) {
            throw new AppError(
              "Appointment cannot be cancelled because the customer has already checked in",
              409,
            );
          }

          // =============================================
          // 10.4 RECHECK APPOINTMENT STATUS
          // =============================================

          if (!cancellableStatuses.includes(current.appointmentStatus)) {
            throw new AppError(
              "Appointment cannot be cancelled in its current status",
              409,
            );
          }

          // =============================================
          // 10.5 RECHECK CUSTOMER CUTOFF
          // =============================================

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

          // =============================================
          // 10.6 IDENTIFY GROUP PURCHASE TYPE
          // =============================================

          const isCurrentRedemption =
            current.bookingMethod === BookingMethod.GROUP_PURCHASE &&
            current.groupPurchaseId !== null;

          const isCurrentInitialBookNow =
            current.groupPurchaseId !== null &&
            current.bookingMethod !== BookingMethod.GROUP_PURCHASE;

          if (
            current.bookingMethod === BookingMethod.GROUP_PURCHASE &&
            !current.groupPurchaseId
          ) {
            throw new AppError("Group purchase reference is missing", 409);
          }

          // =============================================
          // 10.7 BLOCK INITIAL BOOK NOW
          // =============================================

          if (isCurrentInitialBookNow) {
            throw new AppError(
              "Initial Book Now appointment cancellation requires package-level cancellation processing",
              409,
            );
          }

          // =============================================
          // 10.8 PRESERVE PAID BOOKING RESTRICTION
          // =============================================

          if (
            !isCurrentRedemption &&
            (current.paymentStatus === PaymentStatus.PAID ||
              current.paymentStatus === PaymentStatus.PARTIALLY_PAID)
          ) {
            throw new AppError(
              "Paid appointment cancellation requires refund processing",
              422,
            );
          }

          // =============================================
          // 10.9 VALIDATE GROUP PURCHASE
          // =============================================

          let purchase: {
            id: string;
            customerId: string;
            quantity: number;
            paymentStatus: PaymentStatus;
          } | null = null;

          if (isCurrentRedemption && current.groupPurchaseId) {
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

          // =============================================
          // 11. ATOMIC APPOINTMENT CANCELLATION
          // =============================================

          const updated = await tx.appointment.updateMany({
            where: {
              id: appointmentId,
              appointmentStatus: {
                in: cancellableStatuses,
              },

              // NEW: QR must remain unverified.
              qrVerifiedAt: null,

              // Preserve linked appointment type.
              bookingMethod: current.bookingMethod,

              groupPurchaseId: current.groupPurchaseId,
            },
            data: {
              appointmentStatus: AppointmentStatus.CANCELLED,

              cancelledAt: new Date(),

              cancellationReason: payload.reason.trim(),
            },
          });

          if (updated.count !== 1) {
            throw new AppError(
              "Appointment cancellation conflict or customer already checked in",
              409,
            );
          }

          // =============================================
          // 12. CALCULATE PACKAGE QUANTITY
          // =============================================

          let groupPurchaseSummary: ICancelAppointmentResponse["groupPurchase"] =
            undefined;

          if (isCurrentRedemption && purchase) {
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

          // =============================================
          // 13. CUSTOMER NOTIFICATION
          // =============================================

          const translations = notificationTemplates.BOOKING_CANCELLED();

          await notificationService.createNotification(
            {
              appointmentId: current.id,
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
      // 14. FINAL RESPONSE
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
              staffId: true,
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
              appointmentId: current.id,
              previousStaffId: current.staffId,
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
  // =====================================================
  // 0. EXPIRE PENDING PAYMENT HOLD IF NECESSARY
  // =====================================================

  await expirePendingAppointmentIfNeeded(appointmentId);

  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    select: {
      id: true,
      customerId: true,

      groupPurchaseId: true,

      groupPurchase: {
        select: {
          purchaseFlow: true,
          paymentStatus: true,
        },
      },

      bookingMethod: true,
      appointmentStatus: true,
      paymentStatus: true,

      qrToken: true,
      qrVerifiedAt: true,
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
      "You are not allowed to access this appointment QR",
      403,
    );
  }

  const unavailable = (): IAppointmentQrResponse => ({
    available: false,
    qrValue: null,
  });

  // =====================================================
  // 3. ELIGIBLE APPOINTMENT STATUS
  // =====================================================

  const eligibleStatuses: AppointmentStatus[] = [
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  if (!eligibleStatuses.includes(appointment.appointmentStatus)) {
    return unavailable();
  }

  // =====================================================
  // 4. GROUP PURCHASE FLOW VALIDATION
  // =====================================================

  const isGroupPurchase = appointment.groupPurchaseId !== null;

  if (isGroupPurchase) {
    if (!appointment.groupPurchase) {
      return unavailable();
    }

    const purchaseFlow = appointment.groupPurchase.purchaseFlow;

    if (appointment.bookingMethod === BookingMethod.GROUP_PURCHASE) {
      // BUY_NOW_BOOK_LATER:
      // QR is generated when the customer books an appointment
      // using a fully paid Group Purchase.

      if (purchaseFlow !== GroupPurchaseFlow.BUY_NOW_BOOK_LATER) {
        return unavailable();
      }

      if (appointment.groupPurchase.paymentStatus !== PaymentStatus.PAID) {
        return unavailable();
      }

      if (
        appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
        appointment.paymentStatus !== PaymentStatus.PAID
      ) {
        return unavailable();
      }
    } else {
      // DIRECT_BOOK:
      // Appointment is created during the purchase flow.

      if (purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK) {
        return unavailable();
      }

      if (
        appointment.bookingMethod !== BookingMethod.PAY_NOW &&
        appointment.bookingMethod !== BookingMethod.DEPOSIT &&
        appointment.bookingMethod !== BookingMethod.RESERVE_NOW
      ) {
        return unavailable();
      }

      // Prevent QR access if the Group Purchase itself
      // has not reached the required payment state.

      if (appointment.bookingMethod === BookingMethod.PAY_NOW) {
        if (appointment.groupPurchase.paymentStatus !== PaymentStatus.PAID) {
          return unavailable();
        }
      }

      if (appointment.bookingMethod === BookingMethod.DEPOSIT) {
        if (
          appointment.groupPurchase.paymentStatus !==
            PaymentStatus.PARTIALLY_PAID &&
          appointment.groupPurchase.paymentStatus !== PaymentStatus.PAID
        ) {
          return unavailable();
        }
      }

      if (appointment.bookingMethod === BookingMethod.RESERVE_NOW) {
        if (
          appointment.groupPurchase.paymentStatus !== PaymentStatus.UNPAID &&
          appointment.groupPurchase.paymentStatus !== PaymentStatus.PAID
        ) {
          return unavailable();
        }
      }
    }
  } else {
    // Normal bookings must not use GROUP_PURCHASE booking method.

    if (appointment.bookingMethod === BookingMethod.GROUP_PURCHASE) {
      return unavailable();
    }
  }

  // =====================================================
  // 5. BOOKING METHOD / PAYMENT VALIDATION
  // =====================================================

  if (appointment.bookingMethod === BookingMethod.PAY_NOW) {
    // PAY_NOW QR becomes available only after full payment.

    if (
      appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
      appointment.paymentStatus !== PaymentStatus.PAID
    ) {
      return unavailable();
    }
  } else if (appointment.bookingMethod === BookingMethod.DEPOSIT) {
    // Deposit must already be paid.
    // Appointment can be RESERVED or CONFIRMED.

    if (
      appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID &&
      appointment.paymentStatus !== PaymentStatus.PAID
    ) {
      return unavailable();
    }
  } else if (appointment.bookingMethod === BookingMethod.RESERVE_NOW) {
    // RESERVE_NOW may be unpaid before salon check-in.

    if (
      appointment.paymentStatus !== PaymentStatus.UNPAID &&
      appointment.paymentStatus !== PaymentStatus.PAID
    ) {
      return unavailable();
    }
  } else if (appointment.bookingMethod === BookingMethod.GROUP_PURCHASE) {
    // Fully paid Group Purchase redemption appointment.
    // No additional payment is required.

    if (
      !isGroupPurchase ||
      appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
      appointment.paymentStatus !== PaymentStatus.PAID
    ) {
      return unavailable();
    }
  } else {
    return unavailable();
  }

  // =====================================================
  // 6. QR TOKEN VALIDATION
  // =====================================================

  if (!appointment.qrToken || appointment.qrVerifiedAt) {
    return unavailable();
  }

  // =====================================================
  // 7. FINAL RESPONSE
  // =====================================================

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

  const isSupportedBookingMethod = (method: BookingMethod) =>
    method === BookingMethod.PAY_NOW ||
    method === BookingMethod.RESERVE_NOW ||
    method === BookingMethod.DEPOSIT ||
    method === BookingMethod.GROUP_PURCHASE;

  const expectedStatusFor = (method: BookingMethod) =>
    method === BookingMethod.PAY_NOW || method === BookingMethod.GROUP_PURCHASE
      ? AppointmentStatus.CONFIRMED
      : AppointmentStatus.RESERVED;

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

  const isGroupPurchaseAppointment = appointment.groupPurchaseId !== null;

  // =====================================================
  // 3. BOOKING METHOD VALIDATION
  // =====================================================

  if (!isSupportedBookingMethod(appointment.bookingMethod)) {
    throw new AppError(
      "QR verification is not supported for this booking method",
      409,
    );
  }

  if (
    appointment.bookingMethod === BookingMethod.GROUP_PURCHASE &&
    !isGroupPurchaseAppointment
  ) {
    throw new AppError(
      "Group Purchase appointment is not linked to a purchase",
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
  // 7. EXPECTED APPOINTMENT STATUS
  // =====================================================

  const expectedAppointmentStatus = expectedStatusFor(
    appointment.bookingMethod,
  );

  if (appointment.appointmentStatus !== expectedAppointmentStatus) {
    throw new AppError("QR cannot be verified for this appointment", 409);
  }

  // =====================================================
  // 8. PAYMENT VALIDATION
  // =====================================================

  if (
    appointment.bookingMethod === BookingMethod.PAY_NOW ||
    appointment.bookingMethod === BookingMethod.GROUP_PURCHASE
  ) {
    if (appointment.paymentStatus !== PaymentStatus.PAID) {
      throw new AppError(
        "Appointment must be fully paid before QR verification",
        409,
      );
    }
  }

  if (appointment.bookingMethod === BookingMethod.RESERVE_NOW) {
    if (!isGroupPurchaseAppointment && !payload.paymentMethod) {
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

  const qrVerificationRule =
    appointment.branch.bookingPolicy?.qrVerificationRule ?? "BEFORE_START_TIME";

  const appointmentDate = appointment.date.toISOString().slice(0, 10);

  const expiryTime =
    qrVerificationRule === "BEFORE_END_TIME"
      ? appointment.endTime
      : appointment.startTime;

  const qrExpiryDateTime = new Date(
    `${appointmentDate}T${expiryTime}:00+08:00`,
  );

  if (Number.isNaN(qrExpiryDateTime.getTime())) {
    throw new AppError("Invalid appointment QR expiry time", 500);
  }

  if (new Date() >= qrExpiryDateTime) {
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
              groupPurchaseId: true,

              bookingMethod: true,
              appointmentStatus: true,
              paymentStatus: true,

              qrVerifiedAt: true,
              qrToken: true,

              price: true,
              currency: true,

              date: true,
              startTime: true,
              endTime: true,

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

          // =============================================
          // 12.1 RECHECK BOOKING METHOD
          // =============================================

          if (!isSupportedBookingMethod(current.bookingMethod)) {
            throw new AppError(
              "QR verification is not supported for this booking method",
              409,
            );
          }

          // =============================================
          // 12.2 RECHECK BRANCH
          // =============================================

          if (current.branchId !== payload.branchId) {
            throw new AppError("QR does not belong to this branch", 403);
          }

          // =============================================
          // 12.3 RECHECK SINGLE-USE QR
          // =============================================

          if (current.qrVerifiedAt) {
            throw new AppError("QR has already been used", 409);
          }

          // =============================================
          // 12.4 RECHECK APPOINTMENT STATUS
          // =============================================

          const currentExpectedStatus = expectedStatusFor(
            current.bookingMethod,
          );

          if (current.appointmentStatus !== currentExpectedStatus) {
            throw new AppError(
              "QR cannot be verified for this appointment",
              409,
            );
          }

          const currentIsGroupPurchase = current.groupPurchaseId !== null;

          // =============================================
          // 13. GROUP PURCHASE VALIDATION
          // =============================================

          if (currentIsGroupPurchase) {
            const purchase = await tx.groupPurchase.findUnique({
              where: {
                id: current.groupPurchaseId!,
              },

              select: {
                id: true,
                customerId: true,
                purchaseFlow: true,
                bookingMethod: true,
                paymentStatus: true,
              },
            });

            if (!purchase) {
              throw new AppError("Group purchase not found", 404);
            }

            if (purchase.customerId !== current.customerId) {
              throw new AppError("Group purchase customer mismatch", 409);
            }

            if (current.bookingMethod === BookingMethod.GROUP_PURCHASE) {
              // BUY_NOW_BOOK_LATER:
              // Purchase was paid first.
              // QR was generated when an appointment
              // was subsequently booked.

              if (
                purchase.purchaseFlow !==
                  GroupPurchaseFlow.BUY_NOW_BOOK_LATER ||
                purchase.paymentStatus !== PaymentStatus.PAID
              ) {
                throw new AppError(
                  "Group Purchase redemption is not eligible for QR verification",
                  409,
                );
              }
            } else {
              // DIRECT_BOOK:
              // Appointment was created during purchase.

              if (
                purchase.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
                purchase.bookingMethod !== current.bookingMethod
              ) {
                throw new AppError("Group purchase appointment mismatch", 409);
              }

              const expectedPurchasePaymentStatus =
                current.bookingMethod === BookingMethod.PAY_NOW
                  ? PaymentStatus.PAID
                  : current.bookingMethod === BookingMethod.DEPOSIT
                    ? PaymentStatus.PARTIALLY_PAID
                    : PaymentStatus.UNPAID;

              if (purchase.paymentStatus !== expectedPurchasePaymentStatus) {
                throw new AppError(
                  "Group purchase payment state is invalid for QR verification",
                  409,
                );
              }
            }
          } else if (current.bookingMethod === BookingMethod.GROUP_PURCHASE) {
            throw new AppError(
              "Group Purchase appointment is not linked to a purchase",
              409,
            );
          }

          // =============================================
          // 14. FINAL AUTHORIZATION RECHECK
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
          // 15. FINAL QR EXPIRY CHECK
          // =============================================

          const currentBookingPolicy = await tx.branchBookingPolicy.findUnique({
            where: {
              branchId: current.branchId,
            },

            select: {
              qrVerificationRule: true,
            },
          });

          const currentQrRule =
            currentBookingPolicy?.qrVerificationRule ?? "BEFORE_START_TIME";

          const currentDate = current.date.toISOString().slice(0, 10);

          const currentExpiryTime =
            currentQrRule === "BEFORE_END_TIME"
              ? current.endTime
              : current.startTime;

          const currentQrExpiryDateTime = new Date(
            `${currentDate}T${currentExpiryTime}:00+08:00`,
          );

          if (Number.isNaN(currentQrExpiryDateTime.getTime())) {
            throw new AppError("Invalid appointment QR expiry time", 500);
          }

          const qrVerifiedAt = new Date();

          if (qrVerifiedAt >= currentQrExpiryDateTime) {
            throw new AppError("QR has expired", 410);
          }

          // =============================================
          // 16. FINAL PAYMENT VALIDATION
          // =============================================

          if (
            current.bookingMethod === BookingMethod.PAY_NOW ||
            current.bookingMethod === BookingMethod.GROUP_PURCHASE
          ) {
            if (current.paymentStatus !== PaymentStatus.PAID) {
              throw new AppError(
                "Appointment must be fully paid before QR verification",
                409,
              );
            }
          }

          if (current.bookingMethod === BookingMethod.RESERVE_NOW) {
            if (!currentIsGroupPurchase && !payload.paymentMethod) {
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
          // 17. ATOMIC SINGLE-USE QR CLAIM
          // =============================================

          const claimResult = await tx.appointment.updateMany({
            where: {
              id: current.id,
              qrToken,
              qrVerifiedAt: null,

              appointmentStatus: currentExpectedStatus,

              paymentStatus: current.paymentStatus,
            },

            data: {
              appointmentStatus: AppointmentStatus.CONFIRMED,

              // Only normal RESERVE_NOW collects
              // full salon payment during QR verification.

              ...(current.bookingMethod === BookingMethod.RESERVE_NOW &&
              !currentIsGroupPurchase
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
          // 18. RECORD NORMAL RESERVE_NOW PAYMENT
          // =============================================

          let paymentId: string | null = null;

          if (
            current.bookingMethod === BookingMethod.RESERVE_NOW &&
            !currentIsGroupPurchase
          ) {
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
          // 19. GET UPDATED APPOINTMENT
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

          // =============================================
          // 20. CUSTOMER NOTIFICATION
          // =============================================

          // PAY_NOW and GROUP_PURCHASE redemption
          // are already confirmed.
          // Avoid duplicate confirmation notifications.

          if (
            current.bookingMethod !== BookingMethod.PAY_NOW &&
            current.bookingMethod !== BookingMethod.GROUP_PURCHASE
          ) {
            const translations =
              current.bookingMethod === BookingMethod.RESERVE_NOW
                ? notificationTemplates.BOOKING_CONFIRMED_RESERVE_NOW()
                : notificationTemplates.BOOKING_CONFIRMED_DEPOSIT();

            await notificationService.createNotification(
              {
                appointmentId: current.id,
                userId: current.customerId,

                type: "BOOKING_CONFIRMED",

                title: translations.en!.title!,
                message: translations.en!.message!,

                translations,
              },
              tx,
            );
          }

          // =============================================
          // 21. AUDIT LOG
          // =============================================

          await auditLogService.createAuditLog(
            {
              userId,
              action: "QR_VERIFIED",
              entityType: "APPOINTMENT",
              entityId: current.id,

              metadata: {
                previousStatus: current.appointmentStatus,

                newStatus: updatedAppointment.appointmentStatus,

                previousPaymentStatus: current.paymentStatus,

                newPaymentStatus: updatedAppointment.paymentStatus,

                branchId: current.branchId,

                bookingMethod: current.bookingMethod,

                groupPurchaseId: current.groupPurchaseId,

                paymentId,

                paymentMethod:
                  current.bookingMethod === BookingMethod.RESERVE_NOW &&
                  !currentIsGroupPurchase
                    ? payload.paymentMethod
                    : null,

                paymentProvider:
                  current.bookingMethod === BookingMethod.RESERVE_NOW &&
                  !currentIsGroupPurchase
                    ? PaymentProvider.SALON
                    : null,

                qrVerifiedAt: qrVerifiedAt.toISOString(),

                performedByRole: role,

                qrVerificationRule: currentQrRule,
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
      // 22. FINAL RESPONSE
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
        appointmentId: updatedAppointment.id,
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
      qrVerifiedAt: true,
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
  // 3.1 PREVENT NO-SHOW AFTER QR VERIFICATION
  // =====================================================

  if (appointment.qrVerifiedAt !== null) {
    throw new AppError(
      "Appointment cannot be marked as no-show because the customer has already checked in",
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
        qrVerifiedAt: true,
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
    // 5.3 RECHECK QR VERIFICATION
    // ===================================================

    if (current.qrVerifiedAt !== null) {
      throw new AppError(
        "Appointment cannot be marked as no-show because the customer has already checked in",
        409,
      );
    }

    // ===================================================
    // 5.4 ATOMIC STATUS UPDATE
    // ===================================================

    const updateResult = await tx.appointment.updateMany({
      where: {
        id: appointmentId,

        appointmentStatus: {
          in: noShowAllowedStatuses,
        },

        // Protect against concurrent QR verification.
        qrVerifiedAt: null,
      },

      data: {
        appointmentStatus: AppointmentStatus.NO_SHOW,

        noShowAt,

        noShowReason,
      },
    });

    if (updateResult.count !== 1) {
      throw new AppError(
        "Appointment cannot be marked as no-show because its status or QR verification has changed",
        409,
      );
    }

    // ===================================================
    // 5.5 GET UPDATED APPOINTMENT
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
        appointmentId: updatedAppointment.id,
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

          qrVerified: false,
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

  if (role === Role.STAFF) {
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

      orderBy: [{ date: "desc" }, { startTime: "asc" }, { id: "asc" }],

      select: {
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

        depositPercentage: true,
        depositAmount: true,
        remainingAmount: true,

        qrToken: true,
        qrVerifiedAt: true,

        verifiedByUser: {
          select: {
            id: true,
            name: true,
          },
        },

        review: {
          select: {
            id: true,
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

        service: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        packageId: true,

        package: {
          select: {
            id: true,
            name: true,
            translations: true,
          },
        },

        // NEW: Actual deposit payment and refund records
        payments: {
          select: {
            purpose: true,
            amount: true,
            status: true,
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

  const successfulPaymentStatuses: PaymentStatus[] = [
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ];

  const items = appointments.map((appointment) => {
    const localizedItem = getLocalizedContent(
      appointment.itemNameTranslations,
      language,
      {
        name: appointment.itemName,
      },
    );

    const localizedService = appointment.service
      ? getLocalizedContent(appointment.service.translations, language, {
          name: appointment.service.name,
        })
      : null;

    const localizedPackage = appointment.package
      ? getLocalizedContent(appointment.package.translations, language, {
          name: appointment.package.name,
        })
      : null;

    // =====================================================
    // 12. PAYMENT VALUES
    // =====================================================

    const price = Number(appointment.price);

    const depositPercentage = Number(appointment.depositPercentage ?? 0);

    const depositAmount = Number(appointment.depositAmount ?? 0);

    const remainingAmount = Number(appointment.remainingAmount ?? 0);

    // =====================================================
    // 13. VERIFY ACTUAL DEPOSIT PAYMENT
    // =====================================================

    const depositPaid =
      appointment.bookingMethod === BookingMethod.DEPOSIT &&
      appointment.payments.some((payment) => {
        if (payment.purpose !== "APPOINTMENT_DEPOSIT") {
          return false;
        }

        if (!successfulPaymentStatuses.includes(payment.status)) {
          return false;
        }

        if (!payment.paidAt) {
          return false;
        }

        const refundedAmount = payment.refunds.reduce(
          (sum, refund) => sum + Number(refund.amount),
          0,
        );

        const netDeposit = Number(
          (Number(payment.amount) - refundedAmount).toFixed(2),
        );

        return netDeposit > 0;
      });

    // =====================================================
    // 14. PAYMENT DISPLAY STATUS
    // =====================================================

    const paymentDisplayStatus = getPaymentDisplayStatus(
      appointment.paymentStatus,
      appointment.bookingMethod,
      depositPaid,
    );

    // =====================================================
    // 15. QR STATUS
    // =====================================================

    const qrEligibleStatuses: AppointmentStatus[] = [
      AppointmentStatus.RESERVED,
      AppointmentStatus.CONFIRMED,
    ];

    const qrAvailable =
      qrEligibleStatuses.includes(appointment.appointmentStatus) &&
      Boolean(appointment.qrToken) &&
      !appointment.qrVerifiedAt;

    const qrVerified = Boolean(appointment.qrVerifiedAt);

    const verifiedBy = appointment.verifiedByUser
      ? {
          id: appointment.verifiedByUser.id,
          name: appointment.verifiedByUser.name,
        }
      : null;

    // =====================================================
    // 16. RESPONSE
    // =====================================================

    return {
      id: appointment.id,

      bookingMethod: appointment.bookingMethod,
      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,
      paymentDisplayStatus,

      customer: {
        id: appointment.customer.id,
        name: appointment.customer.name,
        phone: appointment.customer.phone,
      },

      branch: {
        id: branch.id,
        name: localizedBranch.name ?? branch.name,
      },

      staff: {
        id: appointment.staff.id,
        name: appointment.staff.name,
      },

      service: appointment.serviceId
        ? {
            id: appointment.serviceId,
            name:
              localizedService?.name ??
              localizedItem.name ??
              appointment.itemName,
          }
        : null,

      package: appointment.packageId
        ? {
            id: appointment.packageId,
            name:
              localizedPackage?.name ??
              localizedItem.name ??
              appointment.itemName,
          }
        : null,

      date: appointment.date.toISOString().slice(0, 10),

      startTime: appointment.startTime,
      endTime: appointment.endTime,

      durationMinutes: appointment.durationMinutes,

      price,
      currency: appointment.currency,

      depositPercentage,
      depositAmount,
      remainingAmount,

      reviewed: appointment.review !== null,

      qrToken: appointment.qrToken,
      qrVerifiedAt: appointment.qrVerifiedAt,
      qrVerifiedBy: verifiedBy,

      qr: {
        available: qrAvailable,
        verified: qrVerified,
        verifiedAt: appointment.qrVerifiedAt,
        verifiedBy,
      },
    };
  });

  // =====================================================
  // 17. PAGINATION
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

  if (!Number.isSafeInteger(page) || page < 1) {
    throw new AppError("page must be a positive integer", 400);
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
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
        {
          id: "asc",
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

        // =================================================
        // NEW: PAYMENT AND REFUND RECORDS
        // =================================================

        payments: {
          select: {
            purpose: true,
            amount: true,
            status: true,
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
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. SUCCESSFUL PAYMENT STATUSES
  // =====================================================

  const successfulPaymentStatuses: PaymentStatus[] = [
    PaymentStatus.PAID,
    PaymentStatus.PARTIALLY_REFUNDED,
    PaymentStatus.REFUNDED,
  ];

  // =====================================================
  // 5. LOCALIZED RESPONSE DTO
  // =====================================================

  const items = appointments.map((appointment) => {
    // ---------------------------------------------------
    // BRANCH LOCALIZATION
    // ---------------------------------------------------

    const localizedBranch = getLocalizedContent(
      appointment.branch.translations,
      language,
      {
        name: appointment.branch.name,
      },
    );

    // ---------------------------------------------------
    // SERVICE LOCALIZATION
    // ---------------------------------------------------

    const localizedService = appointment.service
      ? getLocalizedContent(appointment.service.translations, language, {
          name: appointment.itemName,
        })
      : null;

    // ---------------------------------------------------
    // PACKAGE LOCALIZATION
    // ---------------------------------------------------

    const localizedPackage = appointment.package
      ? getLocalizedContent(appointment.package.translations, language, {
          name: appointment.itemName,
        })
      : null;

    // =====================================================
    // 6. VERIFY ACTUAL DEPOSIT PAYMENT
    // =====================================================

    const depositPaid =
      appointment.bookingMethod === BookingMethod.DEPOSIT &&
      appointment.payments.some((payment) => {
        if (payment.purpose !== "APPOINTMENT_DEPOSIT") {
          return false;
        }

        if (!successfulPaymentStatuses.includes(payment.status)) {
          return false;
        }

        if (!payment.paidAt) {
          return false;
        }

        const refundedAmount = payment.refunds.reduce(
          (sum, refund) => sum + Number(refund.amount),
          0,
        );

        const netDeposit = Number(
          (Number(payment.amount) - refundedAmount).toFixed(2),
        );

        return netDeposit > 0;
      });

    // =====================================================
    // 7. PAYMENT DISPLAY STATUS
    // =====================================================

    const paymentDisplayStatus = getPaymentDisplayStatus(
      appointment.paymentStatus,
      appointment.bookingMethod,
      depositPaid,
    );

    // =====================================================
    // 8. RESPONSE
    // =====================================================

    return {
      id: appointment.id,

      bookingMethod: appointment.bookingMethod,

      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,

      // Frontend-friendly derived payment status
      paymentDisplayStatus,

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

            name: localizedService?.name ?? appointment.itemName,
          }
        : null,

      package: appointment.packageId
        ? {
            id: appointment.packageId,

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

  // =====================================================
  // 9. PAGINATION
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
const recordRemainingPayment = async (
  appointmentId: string,
  payload: TRecordRemainingPayment,
  userId: string,
) => {
  // =====================================================
  // SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // =====================================================
          // 1. LOCK APPOINTMENT
          // =====================================================

          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "Appointment"
            WHERE "id" = ${appointmentId}
            FOR UPDATE
          `;

          if (locked.length !== 1) {
            throw new AppError("Appointment not found", httpStatus.NOT_FOUND);
          }

          // =====================================================
          // 2. FIND APPOINTMENT
          // =====================================================

          const appointment = await tx.appointment.findUniqueOrThrow({
            where: {
              id: appointmentId,
            },
            include: {
              payments: true,
              branch: true,
            },
          });

          // =====================================================
          // 3. BLOCK GROUP PURCHASE
          // =====================================================

          if (appointment.groupPurchaseId !== null) {
            throw new AppError(
              "Use the group purchase remaining-payment endpoint for this appointment",
              409,
            );
          }

          // =====================================================
          // 4. VALIDATE BOOKING METHOD
          // =====================================================

          if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
            throw new AppError(
              "Remaining payment is only available for deposit appointments",
              httpStatus.BAD_REQUEST,
            );
          }

          // =====================================================
          // 5. VALIDATE APPOINTMENT STATE
          // =====================================================

          if (appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
            throw new AppError(
              "Appointment does not have an outstanding remaining payment",
              409,
            );
          }

          if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
            throw new AppError(
              "Appointment must be confirmed before recording remaining payment",
              409,
            );
          }

          if (!appointment.qrVerifiedAt) {
            throw new AppError("Appointment QR verification is required", 409);
          }

          // =====================================================
          // 6. CHECK EXISTING REMAINING PAYMENTS
          // =====================================================

          const existingRemainingPayments = appointment.payments.filter(
            (payment) =>
              payment.purpose === PaymentPurpose.APPOINTMENT_REMAINING &&
              (payment.status === PaymentStatus.PENDING ||
                payment.status === PaymentStatus.PAID ||
                payment.status === PaymentStatus.PARTIALLY_REFUNDED),
          );

          if (
            existingRemainingPayments.some(
              (payment) =>
                payment.status === PaymentStatus.PAID ||
                payment.status === PaymentStatus.PARTIALLY_REFUNDED,
            )
          ) {
            throw new AppError(
              "Remaining payment has already been recorded",
              409,
            );
          }

          // IMPORTANT:
          // Do not allow salon payment while Stripe payment
          // may still succeed asynchronously.

          if (
            existingRemainingPayments.some(
              (payment) =>
                payment.provider === PaymentProvider.STRIPE &&
                payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("STRIPE_REMAINING_PAYMENT_PENDING", 409);
          }

          if (
            existingRemainingPayments.some(
              (payment) => payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError("REMAINING_PAYMENT_ATTEMPT_PENDING", 409);
          }

          // =====================================================
          // 7. CALCULATE REMAINING AMOUNT
          // =====================================================

          const totalPrice = appointment.price;

          const depositAmount =
            appointment.depositAmount ?? new Prisma.Decimal(0);

          if (
            !totalPrice.isFinite() ||
            !depositAmount.isFinite() ||
            depositAmount.lte(0)
          ) {
            throw new AppError("Invalid appointment deposit amount", 409);
          }

          const remainingAmount = totalPrice.minus(depositAmount);

          if (!remainingAmount.isFinite() || remainingAmount.lte(0)) {
            throw new AppError("No remaining payment is due", 409);
          }

          if (
            appointment.remainingAmount !== null &&
            !appointment.remainingAmount.equals(remainingAmount)
          ) {
            throw new AppError("Appointment remaining amount mismatch", 409);
          }

          if (appointment.currency !== "HKD") {
            throw new AppError("Unsupported appointment currency", 409);
          }

          // =====================================================
          // 8. GUARDED APPOINTMENT SETTLEMENT
          // =====================================================

          const claimResult = await tx.appointment.updateMany({
            where: {
              id: appointmentId,
              groupPurchaseId: null,
              bookingMethod: BookingMethod.DEPOSIT,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
              qrVerifiedAt: {
                not: null,
              },
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

          // =====================================================
          // 9. CREATE SALON PAYMENT
          // =====================================================

          const now = new Date();

          const payment = await tx.payment.create({
            data: {
              customerId: appointment.customerId,
              appointmentId: appointment.id,
              purpose: PaymentPurpose.APPOINTMENT_REMAINING,
              provider: PaymentProvider.SALON,
              salonPaymentMethod: payload.paymentMethod,
              amount: remainingAmount,
              currency: appointment.currency,
              status: PaymentStatus.PAID,
              paidAt: now,
            },
          });

          // =====================================================
          // 10. GET UPDATED APPOINTMENT
          // =====================================================

          const updatedAppointment = await tx.appointment.findUniqueOrThrow({
            where: {
              id: appointmentId,
            },
          });

          // =====================================================
          // 11. MULTILINGUAL NOTIFICATION
          // =====================================================

          const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
            Number(remainingAmount),
            appointment.currency,
          );

          await notificationService.createNotification(
            {
              appointmentId: updatedAppointment.id,
              userId: updatedAppointment.customerId,
              type: "REMAINING_PAYMENT_RECEIVED",
              title: translations.en!.title!,
              message: translations.en!.message!,
              translations,
            },
            tx,
          );

          // =====================================================
          // 12. AUDIT LOG
          // =====================================================

          await auditLogService.createAuditLog(
            {
              userId,
              action: "REMAINING_PAYMENT_RECORDED",
              entityType: "APPOINTMENT",
              entityId: appointment.id,
              metadata: {
                paymentId: payment.id,
                previousPaymentStatus: PaymentStatus.PARTIALLY_PAID,
                newPaymentStatus: PaymentStatus.PAID,
                bookingMethod: appointment.bookingMethod,
                totalPrice: Number(totalPrice),
                depositAmount: Number(depositAmount),
                remainingAmount: Number(remainingAmount),
                paymentMethod: payload.paymentMethod,
                provider: PaymentProvider.SALON,
              },
            },
            tx,
          );

          // =====================================================
          // 13. RESPONSE
          // =====================================================

          return {
            appointmentId: updatedAppointment.id,
            bookingMethod: updatedAppointment.bookingMethod,
            appointmentStatus: updatedAppointment.appointmentStatus,
            paymentStatus: updatedAppointment.paymentStatus,
            price: Number(updatedAppointment.price),
            depositAmount: Number(updatedAppointment.depositAmount ?? 0),
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

  throw new AppError("Remaining payment transaction conflict", 409);
};

const completeEligibleAppointments = async (): Promise<{
  completedCount: number;
}> => {
  // =====================================================
  // 1. CONFIGURATION
  // =====================================================

  const batchSize = 100;

  let completedCount = 0;

  const runStartedAt = new Date();

  // =====================================================
  // 2. FIND CANDIDATE APPOINTMENTS
  // =====================================================

  // Only confirmed, fully paid and QR-verified
  // appointments can be automatically completed.
  //
  // Booking method is intentionally not filtered.
  // This supports:
  //
  // Normal PAY_NOW
  // Normal RESERVE_NOW
  // Normal DEPOSIT
  //
  // Group Purchase DIRECT_BOOK
  // Group Purchase BUY_NOW_BOOK_LATER redemption

  const where: Prisma.AppointmentWhereInput = {
    appointmentStatus: AppointmentStatus.CONFIRMED,

    paymentStatus: PaymentStatus.PAID,

    qrVerifiedAt: {
      not: null,
      lte: runStartedAt,
    },

    durationMinutes: {
      gt: 0,
    },
  };

  // =====================================================
  // 3. PAGINATE THROUGH CANDIDATES
  // =====================================================

  // Keyset pagination prevents the same first 100
  // records from blocking later eligible appointments.
  //
  // We use the appointment ID as the stable cursor.
  // The candidate set is bounded by runStartedAt.

  let cursorId: string | undefined;

  while (true) {
    const candidates = await prisma.appointment.findMany({
      where: {
        ...where,

        ...(cursorId
          ? {
              id: {
                gt: cursorId,
              },
            }
          : {}),
      },

      select: {
        id: true,
        qrVerifiedAt: true,
        durationMinutes: true,
      },

      orderBy: {
        id: "asc",
      },

      take: batchSize,
    });

    if (candidates.length === 0) {
      break;
    }

    // Advance the cursor independently of whether
    // individual appointments are completed.
    cursorId = candidates[candidates.length - 1].id;

    // ===================================================
    // 4. PROCESS EACH APPOINTMENT
    // ===================================================

    for (const candidate of candidates) {
      try {
        if (!candidate.qrVerifiedAt) {
          continue;
        }

        // ===============================================
        // 4.1 CALCULATE COMPLETION ELIGIBILITY
        // ===============================================

        const completionEligibleAt = new Date(
          candidate.qrVerifiedAt.getTime() + candidate.durationMinutes * 60_000,
        );

        if (
          Number.isNaN(completionEligibleAt.getTime()) ||
          runStartedAt < completionEligibleAt
        ) {
          continue;
        }

        // ===============================================
        // 4.2 TRANSACTIONAL COMPLETION
        // ===============================================

        const completed = await prisma.$transaction(
          async (tx) => {
            // -------------------------------------------
            // Recheck current appointment state
            // -------------------------------------------

            const current = await tx.appointment.findUnique({
              where: {
                id: candidate.id,
              },

              select: {
                id: true,
                customerId: true,

                bookingMethod: true,
                groupPurchaseId: true,

                appointmentStatus: true,
                paymentStatus: true,

                qrVerifiedAt: true,
                durationMinutes: true,
              },
            });

            if (!current) {
              return false;
            }

            // -------------------------------------------
            // Validate current appointment state
            // -------------------------------------------

            if (
              current.appointmentStatus !== AppointmentStatus.CONFIRMED ||
              current.paymentStatus !== PaymentStatus.PAID ||
              !current.qrVerifiedAt ||
              current.durationMinutes <= 0
            ) {
              return false;
            }

            // -------------------------------------------
            // Recalculate using current database values
            // -------------------------------------------

            const currentEligibleAt = new Date(
              current.qrVerifiedAt.getTime() + current.durationMinutes * 60_000,
            );

            const completedAt = new Date();

            if (
              Number.isNaN(currentEligibleAt.getTime()) ||
              completedAt < currentEligibleAt
            ) {
              return false;
            }

            // ===========================================
            // 5. ATOMIC COMPLETION
            // ===========================================

            // Conditional update prevents:
            //
            // - Duplicate completion
            // - Completion without QR verification
            // - Completion without full payment
            // - Completion after concurrent state changes

            const updateResult = await tx.appointment.updateMany({
              where: {
                id: current.id,

                appointmentStatus: AppointmentStatus.CONFIRMED,

                paymentStatus: PaymentStatus.PAID,

                qrVerifiedAt: current.qrVerifiedAt,

                durationMinutes: current.durationMinutes,
              },

              data: {
                appointmentStatus: AppointmentStatus.COMPLETED,

                completedAt,
              },
            });

            if (updateResult.count !== 1) {
              return false;
            }

            // ===========================================
            // 6. MULTILINGUAL CUSTOMER NOTIFICATION
            // ===========================================

            const translations = notificationTemplates.SERVICE_COMPLETED();

            await notificationService.createNotification(
              {
                appointmentId: current.id,

                userId: current.customerId,

                type: "SERVICE_COMPLETED",

                title: translations.en!.title!,

                message: translations.en!.message!,

                translations,
              },
              tx,
            );

            // ===========================================
            // 7. SYSTEM AUDIT LOG
            // ===========================================

            // Automatic completion has no logged-in
            // staff or manager.
            //
            // userId is intentionally omitted.
            // The AuditLog model permits null userId.

            await auditLogService.createAuditLog(
              {
                action: "APPOINTMENT_AUTO_COMPLETED",

                entityType: "APPOINTMENT",

                entityId: current.id,

                metadata: {
                  performedBy: "SYSTEM",

                  trigger: "APPOINTMENT_COMPLETION_CRON",

                  previousStatus: AppointmentStatus.CONFIRMED,

                  newStatus: AppointmentStatus.COMPLETED,

                  paymentStatus: PaymentStatus.PAID,

                  bookingMethod: current.bookingMethod,

                  groupPurchaseId: current.groupPurchaseId,

                  qrVerifiedAt: current.qrVerifiedAt.toISOString(),

                  durationMinutes: current.durationMinutes,

                  completionEligibleAt: currentEligibleAt.toISOString(),

                  completedAt: completedAt.toISOString(),
                },
              },
              tx,
            );

            return true;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );

        if (completed) {
          completedCount++;
        }
      } catch (error) {
        // ===============================================
        // 8. INDIVIDUAL APPOINTMENT ERROR HANDLING
        // ===============================================

        // A failed appointment must not stop the
        // remaining appointments from processing.
        //
        // The failed appointment remains eligible
        // for a later cron run.

        logUnexpectedError(error, {
          source: "appointment.service.ts:completeEligibleAppointments",
        });
      }
    }

    // No further candidate pages.
    if (candidates.length < batchSize) {
      break;
    }
  }

  // =====================================================
  // 9. FINAL RESPONSE
  // =====================================================

  return {
    completedCount,
  };
};

const recordGroupPurchaseRemainingPayment = async (
  purchaseId: string,
  payload: TRecordRemainingPayment,
  userId: string,
) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // =====================================================
          // 1. LOCK GROUP PURCHASE
          // =====================================================

          const locked = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT "id"
            FROM "GroupPurchase"
            WHERE "id" = ${purchaseId}
            FOR UPDATE
          `;

          if (locked.length !== 1) {
            throw new AppError("Group Purchase not found", 404);
          }

          // =====================================================
          // 2. FETCH GROUP PURCHASE
          // =====================================================

          const purchase = await tx.groupPurchase.findUniqueOrThrow({
            where: { id: purchaseId },
            include: {
              appointments: true,
              payments: true,
            },
          });

          // =====================================================
          // 3. VALIDATE PURCHASE FLOW
          // =====================================================

          if (
            purchase.purchaseFlow !== GroupPurchaseFlow.DIRECT_BOOK ||
            purchase.bookingMethod !== BookingMethod.DEPOSIT
          ) {
            throw new AppError(
              "Remaining payment is only available for Group Purchase DEPOSIT bookings",
              409,
            );
          }

          if (purchase.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
            throw new AppError(
              "Group Purchase does not have an outstanding remaining payment",
              409,
            );
          }

          // =====================================================
          // 4. VERIFY LINKED APPOINTMENT
          // =====================================================

          if (purchase.appointments.length !== 1) {
            throw new AppError("Invalid Group Purchase appointment state", 409);
          }

          const appointment = purchase.appointments[0];

          if (
            appointment.groupPurchaseId !== purchaseId ||
            appointment.customerId !== purchase.customerId ||
            appointment.bookingMethod !== BookingMethod.DEPOSIT ||
            appointment.appointmentStatus !== AppointmentStatus.CONFIRMED ||
            appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID ||
            !appointment.qrVerifiedAt
          ) {
            throw new AppError(
              "Group Purchase appointment must be QR verified and confirmed",
              409,
            );
          }

          // =====================================================
          // 5. CALCULATE PURCHASE-LEVEL REMAINING AMOUNT
          // =====================================================

          const totalAmount = purchase.amount;
          const depositAmount = purchase.depositAmount ?? new Prisma.Decimal(0);

          const remainingAmount = totalAmount.minus(depositAmount);

          if (
            !totalAmount.isFinite() ||
            !depositAmount.isFinite() ||
            depositAmount.lte(0) ||
            remainingAmount.lte(0)
          ) {
            throw new AppError("Invalid Group Purchase remaining amount", 409);
          }

          if (
            purchase.remainingAmount !== null &&
            purchase.remainingAmount !== undefined &&
            !purchase.remainingAmount.equals(remainingAmount)
          ) {
            throw new AppError("Group Purchase remaining amount mismatch", 409);
          }

          // =====================================================
          // 6. VERIFY INITIAL DEPOSIT PAYMENT
          // =====================================================

          const initialDepositPaid = purchase.payments.some(
            (payment) =>
              payment.id === purchase.settledPaymentId &&
              payment.purpose === PaymentPurpose.GROUP_PURCHASE &&
              payment.status === PaymentStatus.PAID &&
              payment.amount.equals(depositAmount),
          );

          if (!initialDepositPaid) {
            throw new AppError(
              "Initial Group Purchase deposit payment not found",
              409,
            );
          }

          // =====================================================
          // 7. CHECK EXISTING REMAINING PAYMENTS
          // =====================================================

          const existingRemainingPayments = purchase.payments.filter(
            (payment) =>
              payment.purpose === PaymentPurpose.GROUP_PURCHASE &&
              payment.id !== purchase.settledPaymentId &&
              payment.amount.equals(remainingAmount) &&
              (payment.status === PaymentStatus.PENDING ||
                payment.status === PaymentStatus.PAID ||
                payment.status === PaymentStatus.PARTIALLY_REFUNDED),
          );

          if (
            existingRemainingPayments.some(
              (payment) =>
                payment.status === PaymentStatus.PAID ||
                payment.status === PaymentStatus.PARTIALLY_REFUNDED,
            )
          ) {
            throw new AppError(
              "Group Purchase remaining payment already completed",
              409,
            );
          }

          if (
            existingRemainingPayments.some(
              (payment) =>
                payment.provider === PaymentProvider.STRIPE &&
                payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError(
              "STRIPE_GROUP_PURCHASE_REMAINING_PAYMENT_PENDING",
              409,
            );
          }

          if (
            existingRemainingPayments.some(
              (payment) => payment.status === PaymentStatus.PENDING,
            )
          ) {
            throw new AppError(
              "GROUP_PURCHASE_REMAINING_PAYMENT_ATTEMPT_PENDING",
              409,
            );
          }

          // =====================================================
          // 8. GUARDED GROUP PURCHASE UPDATE
          // =====================================================

          const updatedPurchase = await tx.groupPurchase.updateMany({
            where: {
              id: purchaseId,
              purchaseFlow: GroupPurchaseFlow.DIRECT_BOOK,
              bookingMethod: BookingMethod.DEPOSIT,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedPurchase.count !== 1) {
            throw new AppError(
              "Group Purchase remaining payment conflict",
              409,
            );
          }

          // =====================================================
          // 9. GUARDED APPOINTMENT UPDATE
          // =====================================================

          const updatedAppointment = await tx.appointment.updateMany({
            where: {
              id: appointment.id,
              groupPurchaseId: purchaseId,
              bookingMethod: BookingMethod.DEPOSIT,
              appointmentStatus: AppointmentStatus.CONFIRMED,
              paymentStatus: PaymentStatus.PARTIALLY_PAID,
              qrVerifiedAt: { not: null },
            },
            data: {
              paymentStatus: PaymentStatus.PAID,
            },
          });

          if (updatedAppointment.count !== 1) {
            throw new AppError(
              "Group Purchase appointment remaining payment conflict",
              409,
            );
          }

          // =====================================================
          // 10. CREATE SALON PAYMENT
          // =====================================================

          const payment = await tx.payment.create({
            data: {
              customerId: purchase.customerId,
              groupPurchaseId: purchaseId,
              appointmentId: appointment.id,
              purpose: PaymentPurpose.GROUP_PURCHASE,
              provider: PaymentProvider.SALON,
              salonPaymentMethod: payload.paymentMethod,
              amount: remainingAmount,
              currency: "HKD",
              status: PaymentStatus.PAID,
              paidAt: new Date(),
            },
          });

          // =====================================================
          // 11. MULTILINGUAL NOTIFICATION
          // =====================================================

          const translations = notificationTemplates.REMAINING_PAYMENT_RECEIVED(
            Number(remainingAmount),
            "HKD",
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

          // =====================================================
          // 12. AUDIT LOG
          // =====================================================

          await auditLogService.createAuditLog(
            {
              userId,
              action: "GROUP_PURCHASE_REMAINING_PAYMENT_RECORDED",
              entityType: "GROUP_PURCHASE",
              entityId: purchaseId,
              metadata: {
                paymentId: payment.id,
                appointmentId: appointment.id,
                provider: PaymentProvider.SALON,
                paymentMethod: payload.paymentMethod,
                totalAmount: Number(totalAmount),
                depositAmount: Number(depositAmount),
                remainingAmount: Number(remainingAmount),
                previousPaymentStatus: PaymentStatus.PARTIALLY_PAID,
                newPaymentStatus: PaymentStatus.PAID,
              },
            },
            tx,
          );

          // =====================================================
          // 13. RESPONSE
          // =====================================================

          return {
            purchaseId,
            appointmentId: appointment.id,
            bookingMethod: BookingMethod.DEPOSIT,
            appointmentStatus: AppointmentStatus.CONFIRMED,
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

  throw new AppError(
    "Group Purchase remaining payment transaction conflict",
    409,
  );
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
  completeEligibleAppointments,
  recordGroupPurchaseRemainingPayment,
};
