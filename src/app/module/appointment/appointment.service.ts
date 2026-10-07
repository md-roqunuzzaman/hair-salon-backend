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

const PAY_NOW_HOLD_MINUTES = 2;
const MAX_TRANSACTION_RETRIES = 3;

// =====================================================
// EXPIRED PAYMENT HOLD LIFECYCLE
// =====================================================

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

const timeToMinutes = (time: string) => {
  const [hour, minute] = time.split(":").map(Number);

  return hour * 60 + minute;
};

const minutesToTime = (minutes: number) => {
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

const assertStaffSlotAvailable = async (
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

const assertBranchHourlyCapacityAvailable = async (
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
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  // =====================================================
  // 1. FIRST HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,

    ...(serviceId
      ? {
          serviceId,
        }
      : {}),

    ...(packageId
      ? {
          packageId,
        }
      : {}),

    ...(staffId
      ? {
          staffId,
        }
      : {}),

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

  // =====================================================
  // 2. RESOLVE STAFF
  //
  // Specific staff:
  // → use customer-selected staff
  //
  // Any Staff:
  // → use candidate returned by availability engine
  // =====================================================

  const resolvedStaffId = staffId ?? requestedSlot.staffId;

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 4. BOOKING TARGET SNAPSHOT
          // =============================================

          let itemName: string;
          let durationMinutes: number;
          let price: Prisma.Decimal;

          if (serviceId) {
            const service = await tx.service.findUnique({
              where: {
                id: serviceId,
              },

              select: {
                id: true,
                name: true,
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

            durationMinutes = service.durationMinutes;

            price = service.price;
          } else {
            const packageData = await tx.package.findUnique({
              where: {
                id: packageId!,
              },

              select: {
                id: true,
                name: true,
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

            durationMinutes = packageData.durationMinutes;

            price = packageData.packagePrice;
          }

          // =============================================
          // 5. REQUESTED TIME RANGE
          // =============================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =============================================
          // 6. FINAL STAFF AVAILABILITY RECHECK
          // =============================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          // =============================================
          // 7. FINAL BRANCH CAPACITY RECHECK
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

          // =============================================
          // 8. TEMPORARY PAY-NOW HOLD
          // =============================================

          const holdExpiresAt = new Date(
            now.getTime() + PAY_NOW_HOLD_MINUTES * 60 * 1000,
          );

          // =============================================
          // 9. CREATE APPOINTMENT
          // =============================================

          const appointment = await tx.appointment.create({
            data: {
              customerId,

              branchId,

              // Specific staff OR
              // backend-resolved Any Staff
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
              durationMinutes,
              price,

              currency: "HKD",

              holdExpiresAt,

              // PAY_NOW has no reservation QR
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
            },
          });

          if (!appointment.holdExpiresAt) {
            throw new AppError("Appointment hold could not be created", 500);
          }

          return appointment;
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // ===================================================
      // 10. RESPONSE
      // ===================================================

      return {
        appointmentId: result.id,

        bookingMethod: "PAY_NOW",

        appointmentStatus: "PENDING_PAYMENT",

        paymentStatus: "PENDING",

        holdExpiresAt: result.holdExpiresAt!,

        qrAvailable: false,
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

const createDepositAppointment = async (
  customerId: string,
  payload: ICreateDepositAppointmentPayload,
): Promise<IDepositAppointmentResponse> => {
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  // =====================================================
  // 1. FIRST HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,

    ...(serviceId
      ? {
          serviceId,
        }
      : {}),

    ...(packageId
      ? {
          packageId,
        }
      : {}),

    ...(staffId
      ? {
          staffId,
        }
      : {}),

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

  // =====================================================
  // 2. RESOLVE STAFF
  // =====================================================

  const resolvedStaffId = staffId ?? requestedSlot.staffId;

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
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

          // =================================================
          // 5. BOOKING TARGET SNAPSHOT
          // =================================================

          let itemName: string;
          let durationMinutes: number;
          let price: Prisma.Decimal;

          if (serviceId) {
            const service = await tx.service.findUnique({
              where: {
                id: serviceId,
              },

              select: {
                id: true,
                name: true,
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
            durationMinutes = service.durationMinutes;
            price = service.price;
          } else {
            const packageData = await tx.package.findUnique({
              where: {
                id: packageId!,
              },

              select: {
                id: true,
                name: true,
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

            durationMinutes = packageData.durationMinutes;

            price = packageData.packagePrice;
          }

          // =================================================
          // 6. DEPOSIT CALCULATION
          // =================================================

          const depositAmount = price
            .mul(depositPercentage)
            .div(100)
            .toDecimalPlaces(2);

          const remainingAmount = price.sub(depositAmount).toDecimalPlaces(2);

          // =================================================
          // 7. REQUESTED TIME RANGE
          // =================================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

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
              customerId,

              branchId,

              // Specific staff OR
              // auto-selected staff
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
              durationMinutes,

              price,
              currency: "HKD",

              depositPercentage,
              depositAmount,
              remainingAmount,

              // Temporary payment hold
              holdExpiresAt,

              // QR generated after
              // successful deposit payment verification
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
            },
          });

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
      // 12. RESPONSE
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
const createReserveAppointment = async (
  customerId: string,
  payload: ICreateReserveAppointmentPayload,
): Promise<IReserveAppointmentResponse> => {
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  // =====================================================
  // 1. FIRST HYBRID AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,

    ...(serviceId
      ? {
          serviceId,
        }
      : {}),

    ...(packageId
      ? {
          packageId,
        }
      : {}),

    ...(staffId
      ? {
          staffId,
        }
      : {}),

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

  // =====================================================
  // 2. RESOLVE STAFF
  // =====================================================

  const resolvedStaffId = staffId ?? requestedSlot.staffId;

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 3. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // =============================================
          // 4. BOOKING TARGET SNAPSHOT
          // =============================================

          let itemName: string;
          let durationMinutes: number;
          let price: Prisma.Decimal;

          if (serviceId) {
            const service = await tx.service.findUnique({
              where: {
                id: serviceId,
              },

              select: {
                id: true,
                name: true,
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
            durationMinutes = service.durationMinutes;
            price = service.price;
          } else {
            const packageData = await tx.package.findUnique({
              where: {
                id: packageId!,
              },

              select: {
                id: true,
                name: true,
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
            durationMinutes = packageData.durationMinutes;
            price = packageData.packagePrice;
          }

          // =============================================
          // 5. REQUESTED TIME RANGE
          // =============================================

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // =============================================
          // 6. FINAL STAFF AVAILABILITY RECHECK
          // =============================================

          await assertStaffSlotAvailable(
            tx,
            resolvedStaffId,
            dateOnly,
            requestedStart,
            requestedEnd,
            now,
          );

          // =============================================
          // 7. FINAL BRANCH CAPACITY RECHECK
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

          // =============================================
          // 8. SECURE QR TOKEN
          // =============================================

          const qrToken = crypto.randomBytes(32).toString("hex");

          // =============================================
          // 9. CREATE RESERVED APPOINTMENT
          // =============================================

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

              itemName,
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
            },
          });

          if (!appointment.qrToken) {
            throw new AppError("Reservation QR could not be created", 500);
          }

          return appointment;
        },

        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );

      // ===================================================
      // 10. RESPONSE
      // ===================================================

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

const getMyAppointments = async (
  customerId: string,
  query: IMyAppointmentsQuery,
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

  if (page < 1) {
    throw new AppError("page must be at least 1", 400);
  }

  if (limit < 1 || limit > 100) {
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
  // 3. FETCH OWN APPOINTMENTS ONLY
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
          ? [
              {
                date: "asc",
              },
              {
                startTime: "asc",
              },
            ]
          : [
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
          },
        },

        service: {
          select: {
            id: true,
            name: true,
          },
        },

        staff: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. RESPONSE DTO
  // =====================================================

  const items = appointments.map((appointment) => {
    const qrAvailable =
      (appointment.bookingMethod === BookingMethod.RESERVE_NOW ||
        appointment.bookingMethod === BookingMethod.DEPOSIT) &&
      appointment.appointmentStatus === AppointmentStatus.RESERVED &&
      Boolean(appointment.qrToken) &&
      !appointment.qrVerifiedAt;

    const price = Number(appointment.price);

    const depositPercentage = Number(appointment.depositPercentage ?? 0);

    const depositAmount = Number(appointment.depositAmount ?? 0);

    const remainingAmount = Number(appointment.remainingAmount ?? price);

    let amountPaid = 0;
    let amountDue = price;

    if (appointment.paymentStatus === PaymentStatus.PAID) {
      amountPaid = price;
      amountDue = 0;
    } else if (appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID) {
      amountPaid = depositAmount;
      amountDue = remainingAmount;
    } else if (appointment.paymentStatus === PaymentStatus.REFUNDED) {
      amountPaid = 0;
      amountDue = 0;
    } else if (appointment.paymentStatus === PaymentStatus.FAILED) {
      amountPaid = 0;
      amountDue = price;
    }

    return {
      id: appointment.id,

      bookingMethod: appointment.bookingMethod,

      appointmentStatus: appointment.appointmentStatus,

      paymentStatus: appointment.paymentStatus,

      branch: {
        id: appointment.branch.id,
        name: appointment.branch.name,
      },

      service: appointment.service
        ? {
            id: appointment.service.id,
            name: appointment.service.name,
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
        },
      },

      staff: {
        select: {
          id: true,
          name: true,
          userId: true,
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

  // BRAND_OWNER can access any appointment.

  // =====================================================
  // 3. QR STATE
  // =====================================================

  const qrAvailable =
    (appointment.bookingMethod === BookingMethod.RESERVE_NOW ||
      appointment.bookingMethod === BookingMethod.DEPOSIT) &&
    appointment.appointmentStatus === AppointmentStatus.RESERVED &&
    Boolean(appointment.qrToken) &&
    !appointment.qrVerifiedAt;

  const qrVerified = Boolean(appointment.qrVerifiedAt);

  // =====================================================
  // 4. REVIEW STATE
  // =====================================================

  const reviewAllowed =
    appointment.appointmentStatus === AppointmentStatus.COMPLETED;

  // =====================================================
  // 5. FINANCIAL STATE
  // =====================================================

  const price = Number(appointment.price);

  const depositPercentage = Number(appointment.depositPercentage ?? 0);

  const depositAmount = Number(appointment.depositAmount ?? 0);

  const remainingAmount = Number(appointment.remainingAmount ?? price);

  let amountPaid = 0;
  let amountDue = price;

  if (appointment.paymentStatus === PaymentStatus.PAID) {
    amountPaid = price;
    amountDue = 0;
  } else if (appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID) {
    amountPaid = depositAmount;
    amountDue = remainingAmount;
  } else if (appointment.paymentStatus === PaymentStatus.REFUNDED) {
    amountPaid = 0;
    amountDue = 0;
  } else if (appointment.paymentStatus === PaymentStatus.FAILED) {
    amountPaid = 0;
    amountDue = price;
  }

  // =====================================================
  // 6. RESPONSE DTO
  // =====================================================
  // IMPORTANT:
  // Use booking-time snapshot values.
  // Do NOT read current service/package name or duration.
  // =====================================================

  return {
    id: appointment.id,

    bookingMethod: appointment.bookingMethod,

    appointmentStatus: appointment.appointmentStatus,

    paymentStatus: appointment.paymentStatus,

    branch: {
      id: appointment.branch.id,
      name: appointment.branch.name,
    },

    service: appointment.serviceId
      ? {
          id: appointment.serviceId,
          name: appointment.itemName,
          durationMinutes: appointment.durationMinutes,
        }
      : null,

    package: appointment.packageId
      ? {
          id: appointment.packageId,
          name: appointment.itemName,
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

    qr: {
      available: qrAvailable,
      verified: qrVerified,
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
  // 1. RESOURCE SCOPE / RBAC
  // =====================================================

  if (role === Role.CUSTOMER) {
    if (appointment.customerId !== userId) {
      throw new AppError("You are not allowed to cancel this appointment", 403);
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
      throw new AppError("You are not allowed to cancel this appointment", 403);
    }
  }

  // Contract does not allow STAFF to cancel.
  if (role === Role.STAFF) {
    throw new AppError("You are not allowed to cancel this appointment", 403);
  }

  // BRAND_OWNER may cancel any appointment.

  // =====================================================
  // 2. VALID STATUS TRANSITION
  // =====================================================

  const cancellableStatuses: AppointmentStatus[] = [
    AppointmentStatus.RESERVED,
    AppointmentStatus.CONFIRMED,
  ];

  if (!cancellableStatuses.includes(appointment.appointmentStatus)) {
    throw new AppError(
      "Appointment cannot be cancelled in its current status",
      409,
    );
  }

  // =====================================================
  // 3. CUSTOMER CANCELLATION POLICY
  // =====================================================

  if (role === Role.CUSTOMER) {
    if (!appointment.branch.bookingPolicy) {
      throw new AppError("Branch booking policy not found", 404);
    }

    const appointmentDateTime = createHongKongDateTime(
      appointment.date,
      appointment.startTime,
    );

    const cancellationCutoffMs =
      appointment.branch.bookingPolicy.cancellationCutoffHours * 60 * 60 * 1000;

    const latestAllowedCancellationTime = new Date(
      appointmentDateTime.getTime() - cancellationCutoffMs,
    );

    const now = new Date();

    if (now >= latestAllowedCancellationTime) {
      throw new AppError(
        "Cancellation is no longer allowed for this appointment",
        422,
      );
    }
  }

  // =====================================================
  // 4. PAID APPOINTMENT / REFUND DEPENDENCY
  // =====================================================
  // Do NOT fake Stripe refund.
  // Payment/refund module is not implemented yet.
  // =====================================================

  if (
    appointment.paymentStatus === PaymentStatus.PAID ||
    appointment.paymentStatus === PaymentStatus.PARTIALLY_PAID
  ) {
    throw new AppError(
      "Paid appointment cancellation requires refund processing",
      422,
    );
  }

  // =====================================================
  // 5. CANCEL TRANSACTIONALLY
  // =====================================================

  const cancelledAppointment = await prisma.$transaction(async (tx) => {
    // Re-read inside transaction so stale state is not used.
    const current = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },

      select: {
        id: true,
        customerId: true,
        appointmentStatus: true,
        paymentStatus: true,
      },
    });

    if (!current) {
      throw new AppError("Appointment not found", 404);
    }

    if (!cancellableStatuses.includes(current.appointmentStatus)) {
      throw new AppError(
        "Appointment cannot be cancelled in its current status",
        409,
      );
    }

    if (
      current.paymentStatus === PaymentStatus.PAID ||
      current.paymentStatus === PaymentStatus.PARTIALLY_PAID
    ) {
      throw new AppError(
        "Paid appointment cancellation requires refund processing",
        422,
      );
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },

      data: {
        appointmentStatus: AppointmentStatus.CANCELLED,

        cancelledAt: new Date(),

        cancellationReason: payload.reason.trim(),
      },

      select: {
        id: true,
        appointmentStatus: true,
      },
    });

    await notificationService.createNotification(
      {
        userId: current.customerId,
        type: "BOOKING_CANCELLED",
        title: "Booking cancelled",
        message: "Your appointment has been cancelled.",
      },
      tx,
    );

    return updatedAppointment;
  });

  return {
    appointmentId: cancelledAppointment.id,
    appointmentStatus: "CANCELLED",
    refundStatus: "NOT_REQUIRED",
  };
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

          await notificationService.createNotification(
            {
              userId: current.customerId,
              type: "BOOKING_RESCHEDULED",
              title: "Booking rescheduled",
              message: `Your appointment has been rescheduled to ${date} at ${startTime}.`,
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
  // GET /appointments/:id/qr returns:
  // reservation:<token>
  //
  // Contract request uses raw qrToken.
  // For operational robustness, backend accepts either.
  const qrToken = payload.qrToken.startsWith("reservation:")
    ? payload.qrToken.slice("reservation:".length)
    : payload.qrToken;

  if (!qrToken) {
    throw new AppError("Invalid QR", 400);
  }

  // =====================================================
  // 1. FIND APPOINTMENT BY QR TOKEN
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
  // 2. PAY NOW MUST NEVER USE RESERVATION QR
  // =====================================================

  if (appointment.bookingMethod === BookingMethod.PAY_NOW) {
    throw new AppError("QR is not allowed for Pay Now appointments", 409);
  }

  // =====================================================
  // 3. BRANCH MUST MATCH
  // =====================================================

  if (appointment.branchId !== payload.branchId) {
    throw new AppError("QR does not belong to this branch", 403);
  }

  // =====================================================
  // 4. AUTHORIZATION / BRANCH SCOPE
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
    // Authorized STAFF = assigned staff for appointment.
    if (appointment.staff.userId !== userId) {
      throw new AppError(
        "You are not allowed to verify this appointment QR",
        403,
      );
    }
  }

  // BRAND_OWNER = brand-wide access.

  // =====================================================
  // 5. ALREADY USED
  // =====================================================

  if (appointment.qrVerifiedAt) {
    throw new AppError("QR has already been used", 409);
  }

  // =====================================================
  // 6. VALID APPOINTMENT STATUS
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.RESERVED) {
    throw new AppError("QR cannot be verified for this appointment", 409);
  }

  // =====================================================
  // 7. QR EXPIRY
  // =====================================================
  // Current booking policy:
  // reserveExpiryRule = APPOINTMENT_TIME
  //
  // So reservation QR is valid only before appointment start.
  // =====================================================

  const appointmentDate = appointment.date.toISOString().slice(0, 10);

  const appointmentDateTime = new Date(
    `${appointmentDate}T${appointment.startTime}:00+08:00`,
  );

  if (new Date() >= appointmentDateTime) {
    throw new AppError("QR has expired", 410);
  }

  // =====================================================
  // 8. VERIFIED-BY USER
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
  // 9. ATOMIC SINGLE-USE QR VERIFICATION
  // =====================================================

  const qrVerifiedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: {
        id: appointment.id,
      },

      select: {
        id: true,
        customerId: true,
        bookingMethod: true,
        appointmentStatus: true,
        qrVerifiedAt: true,
        qrToken: true,
        branchId: true,
      },
    });

    if (!current || current.qrToken !== qrToken) {
      throw new AppError("Invalid QR", 404);
    }

    if (current.bookingMethod === BookingMethod.PAY_NOW) {
      throw new AppError("QR is not allowed for Pay Now appointments", 409);
    }

    if (current.branchId !== payload.branchId) {
      throw new AppError("QR does not belong to this branch", 403);
    }

    if (current.qrVerifiedAt) {
      throw new AppError("QR has already been used", 409);
    }

    if (current.appointmentStatus !== AppointmentStatus.RESERVED) {
      throw new AppError("QR cannot be verified for this appointment", 409);
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: current.id,
      },

      data: {
        appointmentStatus: AppointmentStatus.CONFIRMED,

        qrVerifiedAt,

        qrVerifiedBy: userId,
      },

      select: {
        id: true,
        appointmentStatus: true,
        qrVerifiedAt: true,
      },
    });

    await notificationService.createNotification(
      {
        userId: current.customerId,
        type: "BOOKING_CONFIRMED",
        title: "Booking confirmed",
        message: "Your reservation has been confirmed.",
      },
      tx,
    );

    // =====================================================
    // AUDIT LOG
    // =====================================================

    await auditLogService.createAuditLog(
      {
        userId,

        action: "QR_VERIFIED",

        entityType: "APPOINTMENT",

        entityId: current.id,

        metadata: {
          previousStatus: current.appointmentStatus,
          newStatus: AppointmentStatus.CONFIRMED,
          branchId: current.branchId,
          bookingMethod: current.bookingMethod,
          qrVerifiedAt: qrVerifiedAt.toISOString(),
          performedByRole: role,
        },
      },

      tx,
    );

    return updatedAppointment;
  });

  if (!result.qrVerifiedAt) {
    throw new AppError("QR verification failed", 500);
  }

  return {
    appointmentId: result.id,
    appointmentStatus: "CONFIRMED",
    qrVerifiedAt: result.qrVerifiedAt,

    verifiedBy: {
      id: verifiedByUser.id,
      name: verifiedByUser.name,
    },
  };
};

const completeAppointment = async (
  appointmentId: string,
  userId: string,
  role: Role,
  payload: ICompleteAppointmentPayload,
): Promise<ICompleteAppointmentResponse> => {
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
  // 1. ROLE / RESOURCE SCOPE
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
  // 2. VALID STATUS
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
    throw new AppError(
      "Appointment cannot be completed in its current status",
      409,
    );
  }

  // =====================================================
  // 3. COMPLETE TRANSACTIONALLY
  // =====================================================

  const completedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
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

    if (current.appointmentStatus !== AppointmentStatus.CONFIRMED) {
      throw new AppError(
        "Appointment cannot be completed in its current status",
        409,
      );
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },

      data: {
        appointmentStatus: AppointmentStatus.COMPLETED,

        completedAt,

        completionNotes: payload.notes?.trim() || null,
      },

      select: {
        id: true,
        appointmentStatus: true,
        completedAt: true,
      },
    });

    await notificationService.createNotification(
      {
        userId: current.customerId,
        type: "SERVICE_COMPLETED",
        title: "Service completed",
        message: "Your appointment is complete. You can now leave a review.",
      },
      tx,
    );

    // =====================================================
    // AUDIT LOG
    // =====================================================

    await auditLogService.createAuditLog(
      {
        userId,

        action: "APPOINTMENT_COMPLETED",

        entityType: "APPOINTMENT",

        entityId: current.id,

        metadata: {
          previousStatus: current.appointmentStatus,
          newStatus: AppointmentStatus.COMPLETED,
          completedAt: completedAt.toISOString(),
          notes: payload.notes?.trim() || null,
          performedByRole: role,
        },
      },
      tx,
    );

    return updatedAppointment;
  });

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
  // 1. BRANCH MANAGER SCOPE
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

  // =====================================================
  // 2. VALID STATUS TRANSITION
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
  // 3. UPDATE TRANSACTIONALLY
  // =====================================================

  const noShowAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },

      select: {
        id: true,
        appointmentStatus: true,
      },
    });

    if (!current) {
      throw new AppError("Appointment not found", 404);
    }

    if (!noShowAllowedStatuses.includes(current.appointmentStatus)) {
      throw new AppError(
        "Appointment cannot be marked as no-show in its current status",
        409,
      );
    }

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },

      data: {
        appointmentStatus: AppointmentStatus.NO_SHOW,

        noShowAt,

        noShowReason: payload.reason.trim(),
      },

      select: {
        id: true,
        appointmentStatus: true,
      },
    });

    // =====================================================
    // AUDIT LOG
    // =====================================================

    await auditLogService.createAuditLog(
      {
        userId,

        action: "APPOINTMENT_NO_SHOW",

        entityType: "APPOINTMENT",

        entityId: current.id,

        metadata: {
          previousStatus: current.appointmentStatus,
          newStatus: AppointmentStatus.NO_SHOW,
          reason: payload.reason.trim(),
          noShowAt: noShowAt.toISOString(),
          performedByRole: role,
        },
      },

      tx,
    );

    return updatedAppointment;
  });

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
) => {
  // =====================================================
  // 0. EXPIRE OLD PAYMENT HOLDS
  // =====================================================

  await expirePendingAppointments();

  // =====================================================
  // 1. BRANCH EXISTS
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
    },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  // =====================================================
  // 2. ROLE / BRANCH SCOPE
  // =====================================================

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

  // BRAND_OWNER = any branch.

  // =====================================================
  // 3. PAGINATION
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
  // 4. FILTERS
  // =====================================================

  const where: Prisma.AppointmentWhereInput = {
    branchId,
  };

  if (query.date) {
    where.date = new Date(`${query.date}T00:00:00.000Z`);
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

  // STAFF may only see own assigned appointments.
  if (role === Role.STAFF) {
    where.staffId = staffProfileId!;
  } else if (query.staffId) {
    where.staffId = query.staffId;
  }

  // =====================================================
  // 5. FETCH
  // =====================================================

  const [appointments, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,

      skip,
      take: limit,

      orderBy: [
        {
          date: "asc",
        },
        {
          startTime: "asc",
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
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 6. DTO
  // =====================================================

  const items = appointments.map((appointment) => ({
    id: appointment.id,

    bookingMethod: appointment.bookingMethod,

    appointmentStatus: appointment.appointmentStatus,

    paymentStatus: appointment.paymentStatus,

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
          name: appointment.itemName,
        }
      : null,

    package: appointment.packageId
      ? {
          id: appointment.packageId,
          name: appointment.itemName,
        }
      : null,

    date: appointment.date.toISOString().slice(0, 10),

    startTime: appointment.startTime,
    endTime: appointment.endTime,

    durationMinutes: appointment.durationMinutes,

    price: Number(appointment.price),
    currency: appointment.currency,
  }));

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

const getAllAppointments = async (query: IAllAppointmentsQuery) => {
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
      },
    }),

    prisma.appointment.count({
      where,
    }),
  ]);

  // =====================================================
  // 4. RESPONSE DTO
  // =====================================================

  const items = appointments.map((appointment) => ({
    id: appointment.id,

    bookingMethod: appointment.bookingMethod,

    appointmentStatus: appointment.appointmentStatus,

    paymentStatus: appointment.paymentStatus,

    branch: {
      id: appointment.branch.id,
      name: appointment.branch.name,
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

          // Booking-time snapshot
          name: appointment.itemName,
        }
      : null,

    package: appointment.packageId
      ? {
          id: appointment.packageId,

          // Booking-time snapshot
          name: appointment.itemName,
        }
      : null,

    date: appointment.date.toISOString().slice(0, 10),

    startTime: appointment.startTime,
    endTime: appointment.endTime,

    durationMinutes: appointment.durationMinutes,

    price: Number(appointment.price),
    currency: appointment.currency,
  }));

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

  if (appointment.bookingMethod !== BookingMethod.DEPOSIT) {
    throw new AppError(
      "Remaining payment is only available for deposit appointments",
      httpStatus.BAD_REQUEST,
    );
  }

  if (appointment.paymentStatus !== PaymentStatus.PARTIALLY_PAID) {
    throw new AppError(
      "Appointment does not have an outstanding remaining payment",
      httpStatus.BAD_REQUEST,
    );
  }

  if (appointment.appointmentStatus !== AppointmentStatus.CONFIRMED) {
    throw new AppError(
      "Appointment must be confirmed before recording remaining payment",
      httpStatus.BAD_REQUEST,
    );
  }

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

  const totalPrice = Number(appointment.price);

  const depositAmount = Number(appointment.depositAmount ?? 0);

  const remainingAmount = Number((totalPrice - depositAmount).toFixed(2));

  if (remainingAmount <= 0) {
    throw new AppError("No remaining payment is due", httpStatus.BAD_REQUEST);
  }

  const result = await prisma.$transaction(async (tx) => {
    // =================================================
    // 1. CREATE SALON REMAINING PAYMENT
    // =================================================

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

    // =================================================
    // 2. APPOINTMENT -> FULLY PAID
    // =================================================

    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointment.id,
      },

      data: {
        paymentStatus: PaymentStatus.PAID,
      },
    });

    // =================================================
    // 3. AUDIT LOG
    // =================================================

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

    // =================================================
    // 4. RESPONSE
    // =================================================

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
