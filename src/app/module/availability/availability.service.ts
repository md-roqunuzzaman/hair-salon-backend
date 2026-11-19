import {
  AppointmentStatus,
  BranchStatus,
  DayOfWeek,
  PackageStatus,
  ServiceStatus,
  StaffStatus,
} from "../../../../generated/prisma/enums.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { isFeatureAvailable } from "../../utils/featureLicense.js";

import {
  createDateTimeInTimezone,
  assertTimezoneDuration,
  getDateInTimezone,
} from "../../utils/brand-timezone.utils.js";

import {
  IAvailabilityQuery,
  IAvailabilityResult,
  IAvailabilitySlot,
} from "./availability.interface.js";

// =====================================================
// TIME HELPERS
// =====================================================

const parseTimeToMinutes = (time: string): number => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

const minutesToTime = (minutes: number): string => {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const intervalsOverlap = (
  startA: number,
  endA: number,
  startB: number,
  endB: number,
): boolean => {
  return startA < endB && endA > startB;
};

// =====================================================
// DATE HELPERS
// =====================================================

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
// GET AVAILABLE SLOTS
// =====================================================

const getAvailableSlots = async (
  query: IAvailabilityQuery,
  options: { durationMinutes?: number } = {},
): Promise<IAvailabilityResult> => {
  const {
    branchId,
    serviceId,
    packageId,
    staffId,
    staffPreference,
    date,
    excludeAppointmentId,
  } = query;

  // =====================================================
  // 0. HAIRSTYLIST FEATURE LICENSE
  // =====================================================

  const hairstylistEnabled = isFeatureAvailable("HAIRSTYLIST");

  if (!hairstylistEnabled && (staffId || staffPreference === "SELECT_STAFF")) {
    throw new AppError(
      "Hairstylist selection is unavailable because the feature is disabled or expired.",
      403,
    );
  }

  // =====================================================
  // 1. VALIDATE BOOKING REQUEST
  // =====================================================

  if (Boolean(serviceId) === Boolean(packageId)) {
    throw new AppError("Provide exactly one serviceId or packageId", 400);
  }

  if (staffPreference === "SELECT_STAFF" && !staffId) {
    throw new AppError("staffId is required for SELECT_STAFF", 400);
  }

  if (staffPreference === "AUTO_ASSIGN" && staffId) {
    throw new AppError("staffId cannot be used with AUTO_ASSIGN", 400);
  }

  if (staffPreference === "NO_STAFF" && staffId) {
    throw new AppError("staffId cannot be used with NO_STAFF", 400);
  }

  // =====================================================
  // 2. BRANCH + BOOKING POLICY
  // =====================================================

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    include: { bookingPolicy: true },
  });

  if (!branch) {
    throw new AppError("Branch not found", 404);
  }

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is inactive", 400);
  }

  if (!branch.bookingPolicy) {
    throw new AppError("Branch booking policy not found", 404);
  }

  const bookingPolicy = branch.bookingPolicy;

  if (bookingPolicy.slotIntervalMinutes <= 0) {
    throw new AppError("Invalid booking slot interval", 400);
  }

  // =====================================================
  // 3. BRAND TIMEZONE
  // =====================================================

  const brand = await prisma.brand.findFirst({
    select: { timezone: true },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const brandTimezone = brand.timezone;

  // =====================================================
  // 4. STAFF MODE — INITIAL RESOLUTION
  // =====================================================

  let staffSelectionMode: "SELECTED" | "AUTO" | "NO_STAFF" = staffId
    ? "SELECTED"
    : staffPreference === "NO_STAFF"
      ? "NO_STAFF"
      : "AUTO";

  const emptyResult = (
    reason: NonNullable<IAvailabilityResult["unavailableReason"]>,
  ): IAvailabilityResult => ({
    date,
    staffSelectionMode,
    slots: [],
    unavailableReason: reason,
  });

  // =====================================================
  // 5. DATE POLICY
  // =====================================================

  const currentBrandDate = getDateInTimezone(brandTimezone);

  const currentDateOnly = new Date(`${currentBrandDate}T00:00:00.000Z`);

  const requestedDateOnly = new Date(`${date}T00:00:00.000Z`);

  if (
    Number.isNaN(requestedDateOnly.getTime()) ||
    requestedDateOnly.toISOString().slice(0, 10) !== date
  ) {
    throw new AppError("Invalid booking date", 400);
  }

  const dayDifference = Math.floor(
    (requestedDateOnly.getTime() - currentDateOnly.getTime()) / 86400000,
  );

  if (dayDifference < 0) {
    return emptyResult("DATE_IN_PAST");
  }

  if (dayDifference > bookingPolicy.maximumAdvanceBookingDays) {
    return emptyResult("BOOKING_WINDOW_EXCEEDED");
  }

  const day = getDayOfWeek(date);
  const dateOnly = requestedDateOnly;

  // =====================================================
  // 6. SERVICE / PACKAGE
  // =====================================================

  let durationMinutes: number;
  let serviceBookingHoursEnabled = false;

  let serviceBookingWindows: Array<{
    start: number;
    end: number;
  }> = [];

  let requiredPackageServiceIds: string[] = [];

  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: { id: serviceId },

      include: {
        branches: {
          where: { branchId },

          select: {
            branchId: true,
            bookingHoursEnabled: true,

            bookingWindows: {
              where: { day },

              select: {
                startTime: true,
                endTime: true,
              },

              orderBy: {
                startTime: "asc",
              },
            },
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
      throw new AppError("Service is not available at this branch", 400);
    }

    durationMinutes = service.durationMinutes;

    const serviceBranch = service.branches[0];

    serviceBookingHoursEnabled = serviceBranch.bookingHoursEnabled;

    if (serviceBookingHoursEnabled) {
      serviceBookingWindows = serviceBranch.bookingWindows.map((window) => ({
        start: parseTimeToMinutes(window.startTime),
        end: parseTimeToMinutes(window.endTime),
      }));
    }
  } else {
    const packageData = await prisma.package.findUnique({
      where: { id: packageId! },

      include: {
        services: {
          select: { serviceId: true },
        },

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
      throw new AppError("Package is not available at this branch", 400);
    }

    durationMinutes = packageData.durationMinutes;

    requiredPackageServiceIds = packageData.services.map(
      (item) => item.serviceId,
    );
  }

  // Preserve immutable booked duration for rescheduling.
  if (options.durationMinutes !== undefined) {
    if (
      !Number.isSafeInteger(options.durationMinutes) ||
      options.durationMinutes <= 0
    ) {
      throw new AppError("Invalid appointment duration", 400);
    }

    durationMinutes = options.durationMinutes;
  }

  if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
    throw new AppError("Invalid service/package duration", 400);
  }

  // =====================================================
  // 7. BRANCH BUSINESS HOURS + BREAKS
  // =====================================================

  const businessHour = await prisma.branchBusinessHour.findFirst({
    where: { branchId, day },

    include: {
      breaks: {
        select: {
          startTime: true,
          endTime: true,
        },

        orderBy: { startTime: "asc" },
      },
    },
  });

  if (
    !businessHour ||
    businessHour.isClosed ||
    !businessHour.openTime ||
    !businessHour.closeTime
  ) {
    return emptyResult("BRANCH_CLOSED");
  }

  const branchOpenMinutes = parseTimeToMinutes(businessHour.openTime);

  const branchCloseMinutes = parseTimeToMinutes(businessHour.closeTime);

  const branchBreakIntervals = businessHour.breaks.map((item) => ({
    start: parseTimeToMinutes(item.startTime),
    end: parseTimeToMinutes(item.endTime),
  }));

  // =====================================================
  // 8. BRANCH HOURLY CAPACITY
  // =====================================================

  const hourlyCapacity = await prisma.branchHourlyCapacity.findUnique({
    where: {
      branchId_day: { branchId, day },
    },
  });

  if (!hourlyCapacity) {
    return emptyResult("CAPACITY_NOT_CONFIGURED");
  }

  const maxBookingsPerHour = hourlyCapacity.maxBookingsPerHour;

  if (maxBookingsPerHour <= 0) {
    return emptyResult("NO_AVAILABLE_SLOTS");
  }

  // =====================================================
  // 9. RESOLVE CONFIGURED STAFF
  // =====================================================

  // Staff-free booking is allowed only when no staff is
  // configured for the service/package at this branch.
  //
  // A staff member who is inactive, on leave, has no
  // schedule, or is temporarily unavailable must NOT
  // automatically enable staff-free booking.

  const effectiveBranchEligibility = {
    OR: [
      {
        scheduleOverrides: {
          some: {
            branchId,
            date: dateOnly,
          },
        },
      },
      {
        branches: {
          some: { branchId },
        },
      },
    ],
  };

  const configuredStaff = await prisma.staff.findMany({
    where: {
      ...effectiveBranchEligibility,

      ...(serviceId
        ? {
            services: {
              some: { serviceId },
            },
          }
        : {
            packages: {
              some: { packageId: packageId! },
            },
          }),
    },

    select: {
      id: true,
      status: true,
      services: { select: { serviceId: true } },
    },

    orderBy: {
      id: "asc",
    },
  });

  const hasConfiguredStaff = configuredStaff.length > 0;

  // =====================================================
  // 10. AUTOMATIC STAFF-FREE FALLBACK
  // =====================================================

  if (!hasConfiguredStaff) {
    if (staffId) {
      throw new AppError(
        "No staff is configured for this service or package",
        400,
      );
    }

    staffSelectionMode = "NO_STAFF";
  } else if (staffPreference === "NO_STAFF") {
    throw new AppError(
      "Staff-free booking is not available because staff is configured",
      400,
    );
  }

  if (serviceBookingHoursEnabled && serviceBookingWindows.length === 0) {
    return emptyResult("NO_AVAILABLE_SLOTS");
  }

  // =====================================================
  // 11. RESOLVE ELIGIBLE STAFF
  // =====================================================

  let staffIds: string[] = [];

  if (staffSelectionMode !== "NO_STAFF") {
    if (staffId) {
      const staffMember = await prisma.staff.findUnique({
        where: { id: staffId },

        include: {
          branches: {
            where: { branchId },
            select: { branchId: true },
          },

          scheduleOverrides: {
            where: { date: dateOnly },
            select: { branchId: true },
          },

          services: serviceId
            ? {
                where: { serviceId },
                select: { serviceId: true },
              }
            : packageId
              ? {
                  select: { serviceId: true },
                }
              : false,

          packages: packageId
            ? {
                where: { packageId },
                select: { packageId: true },
              }
            : false,
        },
      });

      if (!staffMember) {
        throw new AppError("Staff not found", 404);
      }

      if (staffMember.status !== StaffStatus.ACTIVE) {
        throw new AppError("Staff is not eligible", 400);
      }

      const override = staffMember.scheduleOverrides[0];

      const eligibleForBranch = override
        ? override.branchId === branchId
        : staffMember.branches.length > 0;

      if (!eligibleForBranch) {
        throw new AppError(
          "Staff is not eligible for this branch on the selected date",
          400,
        );
      }

      if (
        serviceId &&
        (!staffMember.services || staffMember.services.length === 0)
      ) {
        throw new AppError("Staff is not eligible for this service", 400);
      }

      if (
        packageId &&
        (!staffMember.packages || staffMember.packages.length === 0)
      ) {
        throw new AppError("Staff is not eligible for this package", 400);
      }

      if (packageId) {
        const assigned = new Set(
          staffMember.services?.map((item) => item.serviceId),
        );

        if (requiredPackageServiceIds.some((id) => !assigned.has(id))) {
          throw new AppError("Staff is not eligible for this package", 400);
        }
      }

      staffIds = [staffMember.id];
    } else {
      staffIds = configuredStaff
        .filter(
          (staff) =>
            staff.status === StaffStatus.ACTIVE &&
            requiredPackageServiceIds.every((id) =>
              staff.services.some((item) => item.serviceId === id),
            ),
        )
        .map((staff) => staff.id);

      if (staffIds.length === 0) {
        return emptyResult("NO_ELIGIBLE_STAFF");
      }
    }
  }

  // =====================================================
  // 12. STAFF SCHEDULES
  // =====================================================

  type EffectiveSchedule = {
    staffId: string | null;
    startTime: string;
    endTime: string;
  };

  let schedules: EffectiveSchedule[] = [];

  if (staffSelectionMode === "NO_STAFF") {
    schedules = [
      {
        staffId: null,
        startTime: businessHour.openTime,
        endTime: businessHour.closeTime,
      },
    ];
  } else {
    const overrides = await prisma.staffScheduleOverride.findMany({
      where: {
        staffId: { in: staffIds },
        date: dateOnly,
      },

      select: {
        staffId: true,
        branchId: true,
        startTime: true,
        endTime: true,
      },
    });

    const overriddenStaffIds = new Set(overrides.map((item) => item.staffId));

    const regularSchedules = await prisma.staffSchedule.findMany({
      where: {
        staffId: {
          in: staffIds.filter((id) => !overriddenStaffIds.has(id)),
        },
        branchId,
        day,
      },

      select: {
        staffId: true,
        branchId: true,
        startTime: true,
        endTime: true,
      },

      orderBy: [{ startTime: "asc" }, { staffId: "asc" }],
    });

    const branchOverrides = overrides.filter(
      (item) => item.branchId === branchId,
    );

    schedules = [...regularSchedules, ...branchOverrides].sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) ||
        a.staffId.localeCompare(b.staffId),
    );

    if (schedules.length === 0) {
      return emptyResult("NO_STAFF_SCHEDULE");
    }
  }

  // =====================================================
  // 13. STAFF UNAVAILABILITY
  // =====================================================

  const unavailability =
    staffSelectionMode === "NO_STAFF"
      ? []
      : await prisma.staffUnavailability.findMany({
          where: {
            staffId: { in: staffIds },
            date: dateOnly,
          },
        });

  // =====================================================
  // 14. BLOCKING APPOINTMENTS
  // =====================================================

  const now = new Date();

  const blockingStatusFilter = {
    OR: [
      {
        appointmentStatus: {
          in: [AppointmentStatus.RESERVED, AppointmentStatus.CONFIRMED],
        },
      },
      {
        appointmentStatus: AppointmentStatus.PENDING_PAYMENT,

        holdExpiresAt: { gt: now },
      },
    ],
  };

  const staffBlockingAppointments =
    staffSelectionMode === "NO_STAFF"
      ? []
      : await prisma.appointment.findMany({
          where: {
            ...(excludeAppointmentId
              ? {
                  id: {
                    not: excludeAppointmentId,
                  },
                }
              : {}),

            staffId: { in: staffIds },
            date: dateOnly,
            ...blockingStatusFilter,
          },

          select: {
            staffId: true,
            startTime: true,
            endTime: true,
          },
        });

  const branchBlockingAppointments = await prisma.appointment.findMany({
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
      ...blockingStatusFilter,
    },

    select: {
      id: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 15. BRANCH CAPACITY HELPER
  // =====================================================

  const getCapacityUsageForSlot = (slotStart: number, slotEnd: number) => {
    let maxUsed = 0;

    let hourStart = Math.floor(slotStart / 60) * 60;

    while (hourStart < slotEnd) {
      const hourEnd = hourStart + 60;

      if (hourEnd > branchOpenMinutes && hourStart < branchCloseMinutes) {
        const used = branchBlockingAppointments.filter((appointment) => {
          const appointmentStart = parseTimeToMinutes(appointment.startTime);

          const appointmentEnd = parseTimeToMinutes(appointment.endTime);

          return intervalsOverlap(
            appointmentStart,
            appointmentEnd,
            hourStart,
            hourEnd,
          );
        }).length;

        maxUsed = Math.max(maxUsed, used);

        if (used >= maxBookingsPerHour) {
          return {
            available: false,
            used,
            remaining: 0,
          };
        }
      }

      hourStart += 60;
    }

    return {
      available: true,
      used: maxUsed,
      remaining: Math.max(maxBookingsPerHour - maxUsed, 0),
    };
  };

  // =====================================================
  // 16. GENERATE CANDIDATE SLOTS
  // =====================================================

  const candidateSlots: IAvailabilitySlot[] = [];

  const minimumAllowedTime = new Date(
    now.getTime() + bookingPolicy.minimumBookingNoticeMinutes * 60000,
  );

  for (const schedule of schedules) {
    const scheduleStart = parseTimeToMinutes(schedule.startTime);

    const scheduleEnd = parseTimeToMinutes(schedule.endTime);

    const allowedWindows = serviceBookingHoursEnabled
      ? serviceBookingWindows
      : [
          {
            start: branchOpenMinutes,
            end: branchCloseMinutes,
          },
        ];

    for (const allowedWindow of allowedWindows) {
      const effectiveStart = Math.max(
        branchOpenMinutes,
        scheduleStart,
        allowedWindow.start,
      );

      const effectiveEnd = Math.min(
        branchCloseMinutes,
        scheduleEnd,
        allowedWindow.end,
      );

      if (effectiveStart >= effectiveEnd) {
        continue;
      }

      for (
        let start = effectiveStart;
        start + durationMinutes <= effectiveEnd;
        start += bookingPolicy.slotIntervalMinutes
      ) {
        const end = start + durationMinutes;

        const hasBranchBreakConflict = branchBreakIntervals.some(
          (businessBreak) =>
            intervalsOverlap(
              start,
              end,
              businessBreak.start,
              businessBreak.end,
            ),
        );

        if (hasBranchBreakConflict) {
          continue;
        }

        const startTime = minutesToTime(start);
        const endTime = minutesToTime(end);

        let slotDateTime: Date;

        try {
          slotDateTime = createDateTimeInTimezone(
            date,
            startTime,
            brandTimezone,
          );

          assertTimezoneDuration(
            date,
            startTime,
            endTime,
            durationMinutes,
            brandTimezone,
          );
        } catch (error) {
          if (
            error instanceof AppError &&
            [
              "Selected local time does not exist in this timezone",
              "Selected local time is ambiguous in this timezone",
              "Selected interval crosses a timezone transition",
            ].includes(error.message)
          ) {
            continue;
          }

          throw error;
        }

        if (slotDateTime < minimumAllowedTime) {
          continue;
        }

        if (schedule.staffId !== null) {
          const hasUnavailabilityConflict = unavailability.some((item) => {
            if (item.staffId !== schedule.staffId) {
              return false;
            }

            return intervalsOverlap(
              start,
              end,
              parseTimeToMinutes(item.startTime),
              parseTimeToMinutes(item.endTime),
            );
          });

          if (hasUnavailabilityConflict) {
            continue;
          }

          const hasAppointmentConflict = staffBlockingAppointments.some(
            (appointment) => {
              if (appointment.staffId !== schedule.staffId) {
                return false;
              }

              return intervalsOverlap(
                start,
                end,
                parseTimeToMinutes(appointment.startTime),
                parseTimeToMinutes(appointment.endTime),
              );
            },
          );

          if (hasAppointmentConflict) {
            continue;
          }
        }

        const capacity = getCapacityUsageForSlot(start, end);

        if (!capacity.available) {
          continue;
        }

        candidateSlots.push({
          startTime,
          endTime,

          staffId: schedule.staffId,

          available: true,

          capacity: {
            maxBookingsPerHour,
            used: capacity.used,
            remaining: capacity.remaining,
          },

          staffSelectionMode,
        });
      }
    }
  }

  // =====================================================
  // 17. AUTO / NO-STAFF / SELECTED RESULT
  // =====================================================

  let slots: IAvailabilitySlot[];

  if (staffSelectionMode === "AUTO") {
    const uniqueSlots = new Map<string, IAvailabilitySlot>();

    for (const slot of candidateSlots) {
      const key = `${slot.startTime}-${slot.endTime}`;

      if (!uniqueSlots.has(key)) {
        uniqueSlots.set(key, slot);
      }
    }

    slots = [...uniqueSlots.values()].map((slot) =>
      hairstylistEnabled
        ? slot
        : {
            ...slot,
            staffId: null,
          },
    );
  } else {
    slots = candidateSlots;
  }

  // =====================================================
  // 18. SORT
  // =====================================================

  slots.sort((a, b) => {
    const timeCompare = a.startTime.localeCompare(b.startTime);

    if (timeCompare !== 0) {
      return timeCompare;
    }

    return (a.staffId ?? "").localeCompare(b.staffId ?? "");
  });

  // =====================================================
  // 19. FINAL RESPONSE
  // =====================================================

  return {
    date,
    staffSelectionMode,
    slots,

    ...(slots.length === 0
      ? {
          unavailableReason: "NO_AVAILABLE_SLOTS" as const,
        }
      : {}),
  };
};

export const AvailabilityService = {
  getAvailableSlots,
};
