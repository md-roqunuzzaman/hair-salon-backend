import {
  AppointmentStatus,
  BookingMethod,
  PackageStatus,
  PaymentStatus,
  Prisma,
  Role,
  ServiceStatus,
} from "../../../../generated/prisma/client.js";
import crypto from "node:crypto";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { AvailabilityService } from "../availability/availability.service.js";

import {
  IAppointmentDetails,
  IAppointmentQrResponse,
  ICancelAppointmentPayload,
  ICancelAppointmentResponse,
  ICreatePayNowAppointmentPayload,
  ICreateReserveAppointmentPayload,
  IMyAppointmentsQuery,
  IMyAppointmentsResult,
  IPayNowAppointmentResponse,
  IRescheduleAppointmentPayload,
  IRescheduleAppointmentResponse,
  IReserveAppointmentResponse,
} from "./appointment.interface.js";

const PAY_NOW_HOLD_MINUTES = 5;
const MAX_TRANSACTION_RETRIES = 3;

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

const createPayNowAppointment = async (
  customerId: string,
  payload: ICreatePayNowAppointmentPayload,
): Promise<IPayNowAppointmentResponse> => {
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  // =====================================================
  // 1. FIRST AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,
    ...(serviceId ? { serviceId } : {}),
    ...(packageId ? { packageId } : {}),
    staffId,
    date,
  });

  const requestedSlot = availability.slots.find(
    (slot) =>
      slot.staffId === staffId &&
      slot.startTime === startTime &&
      slot.available,
  );

  if (!requestedSlot) {
    throw new AppError("The selected time slot is no longer available", 409);
  }

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 2. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // ---------------------------------------------
          // Booking target snapshot
          // ---------------------------------------------

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

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // ---------------------------------------------
          // Atomic booking/hold conflict recheck
          // ---------------------------------------------

          const blockingAppointments = await tx.appointment.findMany({
            where: {
              staffId,
              date: dateOnly,

              OR: [
                {
                  appointmentStatus: {
                    in: [
                      AppointmentStatus.RESERVED,
                      AppointmentStatus.CONFIRMED,
                    ],
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
              "The selected time slot is no longer available",
              409,
            );
          }

          const holdExpiresAt = new Date(
            now.getTime() + PAY_NOW_HOLD_MINUTES * 60 * 1000,
          );

          // ---------------------------------------------
          // Create temporary booking hold
          // ---------------------------------------------

          const appointment = await tx.appointment.create({
            data: {
              customerId,
              branchId,
              staffId,

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

              // Pay Now has no reservation QR
              qrToken: null,
              qrVerifiedAt: null,
              qrVerifiedBy: null,
            },

            select: {
              id: true,
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

const createReserveAppointment = async (
  customerId: string,
  payload: ICreateReserveAppointmentPayload,
): Promise<IReserveAppointmentResponse> => {
  const { branchId, serviceId, packageId, staffId, date, startTime } = payload;

  // =====================================================
  // 1. FIRST AVAILABILITY CHECK
  // =====================================================

  const availability = await AvailabilityService.getAvailableSlots({
    branchId,
    ...(serviceId ? { serviceId } : {}),
    ...(packageId ? { packageId } : {}),
    staffId,
    date,
  });

  const requestedSlot = availability.slots.find(
    (slot) =>
      slot.staffId === staffId &&
      slot.startTime === startTime &&
      slot.available,
  );

  if (!requestedSlot) {
    throw new AppError("The selected time slot is no longer available", 409);
  }

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  // =====================================================
  // 2. SERIALIZABLE TRANSACTION WITH RETRY
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // ---------------------------------------------
          // Booking target snapshot
          // ---------------------------------------------

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

          const requestedStart = timeToMinutes(startTime);

          const requestedEnd = requestedStart + durationMinutes;

          const endTime = minutesToTime(requestedEnd);

          const now = new Date();

          // ---------------------------------------------
          // 3. FINAL CONFLICT RECHECK
          // ---------------------------------------------
          // Staff may work across branches.
          // Therefore conflict check is intentionally
          // staff + date, NOT branch + staff + date.
          // ---------------------------------------------

          const blockingAppointments = await tx.appointment.findMany({
            where: {
              staffId,
              date: dateOnly,

              OR: [
                {
                  appointmentStatus: {
                    in: [
                      AppointmentStatus.RESERVED,
                      AppointmentStatus.CONFIRMED,
                    ],
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
              "The selected time slot is no longer available",
              409,
            );
          }

          // ---------------------------------------------
          // 4. SECURE SINGLE-USE RESERVATION QR TOKEN
          // ---------------------------------------------

          const qrToken = crypto.randomBytes(32).toString("hex");

          // ---------------------------------------------
          // 5. CREATE RESERVED APPOINTMENT
          // ---------------------------------------------

          const appointment = await tx.appointment.create({
            data: {
              customerId,
              branchId,
              staffId,

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

              // Reserve Now is not a temporary
              // payment hold.
              holdExpiresAt: null,

              qrToken,
              qrVerifiedAt: null,
              qrVerifiedBy: null,
            },

            select: {
              id: true,
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
  // 1. APPOINTMENT TYPE FILTER
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
  // 2. FETCH OWN APPOINTMENTS ONLY
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
  // 3. RESPONSE DTO
  // =====================================================

  const items = appointments.map((appointment) => {
    const qrAvailable =
      appointment.bookingMethod === BookingMethod.RESERVE_NOW &&
      appointment.appointmentStatus === AppointmentStatus.RESERVED &&
      Boolean(appointment.qrToken) &&
      !appointment.qrVerifiedAt;

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

      price: Number(appointment.price),

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
  // RBAC / RESOURCE SCOPE
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
  // QR STATE
  // =====================================================

  const qrAvailable =
    appointment.bookingMethod === BookingMethod.RESERVE_NOW &&
    appointment.appointmentStatus === AppointmentStatus.RESERVED &&
    Boolean(appointment.qrToken) &&
    !appointment.qrVerifiedAt;

  const qrVerified = Boolean(appointment.qrVerifiedAt);

  // =====================================================
  // REVIEW STATE
  // =====================================================

  const reviewAllowed =
    appointment.appointmentStatus === AppointmentStatus.COMPLETED;

  // =====================================================
  // RESPONSE DTO
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

    price: Number(appointment.price),
    currency: appointment.currency,

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

  if (appointment.paymentStatus === PaymentStatus.PAID) {
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

    if (current.paymentStatus === PaymentStatus.PAID) {
      throw new AppError(
        "Paid appointment cancellation requires refund processing",
        422,
      );
    }

    return tx.appointment.update({
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

  // Reserve Now QR already verified means customer has
  // already arrived/checked in.
  if (
    appointment.bookingMethod === BookingMethod.RESERVE_NOW &&
    appointment.qrVerifiedAt
  ) {
    throw new AppError("Appointment can no longer be rescheduled", 422);
  }

  if (!appointment.branch.bookingPolicy) {
    throw new AppError("Branch booking policy not found", 404);
  }

  // =====================================================
  // 4. RESCHEDULE CUTOFF POLICY
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
  // 5. CHECK NEW SLOT USING EXISTING AVAILABILITY ENGINE
  // =====================================================
  // Booking target does NOT change during reschedule.
  // Only date/time/staff may change.
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

    staffId,
    date,
  });

  const selectedSlot = availability.slots.find(
    (slot) =>
      slot.staffId === staffId &&
      slot.startTime === startTime &&
      slot.available,
  );

  if (!selectedSlot) {
    throw new AppError("The selected time slot is no longer available", 409);
  }

  const newDateOnly = new Date(`${date}T00:00:00.000Z`);

  const requestedStart = timeToMinutes(startTime);

  const requestedEnd = requestedStart + appointment.durationMinutes;

  const endTime = minutesToTime(requestedEnd);

  // =====================================================
  // 6. TRANSACTION + FINAL CONFLICT RECHECK
  // =====================================================

  for (let attempt = 1; attempt <= MAX_TRANSACTION_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Re-read current appointment so stale
          // status cannot be updated.
          const current = await tx.appointment.findUnique({
            where: {
              id: appointmentId,
            },

            select: {
              id: true,
              customerId: true,
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
            current.bookingMethod === BookingMethod.RESERVE_NOW &&
            current.qrVerifiedAt
          ) {
            throw new AppError("Appointment can no longer be rescheduled", 422);
          }

          const now = new Date();

          // ---------------------------------------------
          // FINAL BOOKING CONFLICT CHECK
          // Exclude current appointment itself.
          // ---------------------------------------------

          const blockingAppointments = await tx.appointment.findMany({
            where: {
              id: {
                not: appointmentId,
              },

              staffId,
              date: newDateOnly,

              OR: [
                {
                  appointmentStatus: {
                    in: [
                      AppointmentStatus.RESERVED,
                      AppointmentStatus.CONFIRMED,
                    ],
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

          const hasConflict = blockingAppointments.some((existing) => {
            const existingStart = timeToMinutes(existing.startTime);

            const existingEnd = timeToMinutes(existing.endTime);

            return intervalsOverlap(
              requestedStart,
              requestedEnd,
              existingStart,
              existingEnd,
            );
          });

          if (hasConflict) {
            throw new AppError(
              "The selected time slot is no longer available",
              409,
            );
          }

          // ---------------------------------------------
          // UPDATE SAME APPOINTMENT
          // ---------------------------------------------

          return tx.appointment.update({
            where: {
              id: appointmentId,
            },

            data: {
              staffId,
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
    appointment.bookingMethod === BookingMethod.RESERVE_NOW &&
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

export const appointmentService = {
  createPayNowAppointment,
  createReserveAppointment,
  getMyAppointments,
  getAppointmentById,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentQr,
};
