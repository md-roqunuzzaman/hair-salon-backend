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
  ICreatePayNowAppointmentPayload,
  ICreateReserveAppointmentPayload,
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
} from "./appointment.interface.js";

const PAY_NOW_HOLD_MINUTES = 2;
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

    if (current.paymentStatus === PaymentStatus.PAID) {
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

          const updatedAppointment = await tx.appointment.update({
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

    return tx.appointment.update({
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

export const appointmentService = {
  createPayNowAppointment,
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
};
