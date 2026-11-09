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
): Promise<IAvailabilityResult> => {
  const {
    branchId,
    serviceId,
    packageId,
    staffId,
    date,
    excludeAppointmentId,
  } = query;

  // =====================================================
  // AUTO STAFF MODE
  // =====================================================

  const isAutoStaff = !staffId;
  const staffSelectionMode = isAutoStaff ? "AUTO" : "SELECTED";

  // =====================================================
  // 1. BRANCH + BOOKING POLICY
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

  // =====================================================
  // 2. BRAND TIMEZONE
  // =====================================================

  const brand = await prisma.brand.findFirst({
    select: { timezone: true },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const brandTimezone = brand.timezone;

  // =====================================================
  // 3. BOOKING DATE POLICY
  // =====================================================

  const currentBrandDate = getDateInTimezone(brandTimezone);

  const currentDateOnly = new Date(`${currentBrandDate}T00:00:00.000Z`);

  const requestedDateOnly = new Date(`${date}T00:00:00.000Z`);

  const dayDifference = Math.floor(
    (requestedDateOnly.getTime() - currentDateOnly.getTime()) /
      (1000 * 60 * 60 * 24),
  );

  if (dayDifference < 0) {
    return {
      date,
      staffSelectionMode,
      slots: [],
      unavailableReason: "DATE_IN_PAST",
    };
  }

  if (dayDifference > bookingPolicy.maximumAdvanceBookingDays) {
    return {
      date,
      staffSelectionMode,
      slots: [],
      unavailableReason: "BOOKING_WINDOW_EXCEEDED",
    };
  }

  // =====================================================
  // 4. SERVICE / PACKAGE + CUSTOM BOOKING WINDOWS
  // =====================================================

  let durationMinutes: number;

  let serviceBookingHoursEnabled = false;

  let serviceBookingWindows: Array<{
    start: number;
    end: number;
  }> = [];

  const day = getDayOfWeek(date);

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

      // Enabled but no windows for the selected day:
      // service cannot be booked on this day.
      if (serviceBookingWindows.length === 0) {
        return {
          date,
          staffSelectionMode,
          slots: [],
          unavailableReason: "NO_AVAILABLE_SLOTS",
        };
      }
    }
  } else {
    // ===================================================
    // PACKAGE — PRESERVE EXISTING BEHAVIOR
    // ===================================================

    const packageData = await prisma.package.findUnique({
      where: { id: packageId! },

      include: {
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
  }

  // =====================================================
  // 5. BRANCH BUSINESS HOURS + BREAKS
  // =====================================================

  const businessHour = await prisma.branchBusinessHour.findFirst({
    where: {
      branchId,
      day,
    },

    include: {
      breaks: {
        select: {
          startTime: true,
          endTime: true,
        },

        orderBy: {
          startTime: "asc",
        },
      },
    },
  });

  if (
    !businessHour ||
    businessHour.isClosed ||
    !businessHour.openTime ||
    !businessHour.closeTime
  ) {
    return {
      date,
      staffSelectionMode,
      slots: [],
      unavailableReason: "BRANCH_CLOSED",
    };
  }

  const branchOpenMinutes = parseTimeToMinutes(businessHour.openTime);

  const branchCloseMinutes = parseTimeToMinutes(businessHour.closeTime);

  const branchBreakIntervals = businessHour.breaks.map((businessBreak) => ({
    start: parseTimeToMinutes(businessBreak.startTime),
    end: parseTimeToMinutes(businessBreak.endTime),
  }));

  // =====================================================
  // 6. HOURLY CAPACITY
  // =====================================================

  const hourlyCapacity = await prisma.branchHourlyCapacity.findUnique({
    where: {
      branchId_day: {
        branchId,
        day,
      },
    },
  });

  if (!hourlyCapacity) {
    return {
      date,
      staffSelectionMode,
      slots: [],
      unavailableReason: "CAPACITY_NOT_CONFIGURED",
    };
  }

  const maxBookingsPerHour = hourlyCapacity.maxBookingsPerHour;

  // =====================================================
  // 7. RESOLVE ELIGIBLE STAFF
  // =====================================================

  let staffIds: string[] = [];

  if (staffId) {
    const staffMember = await prisma.staff.findUnique({
      where: { id: staffId },

      include: {
        branches: {
          where: { branchId },
          select: { branchId: true },
        },

        services: serviceId
          ? {
              where: { serviceId },
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

    if (staffMember.branches.length === 0) {
      throw new AppError("Staff is not eligible for this branch", 400);
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

    staffIds = [staffMember.id];
  } else {
    const eligibleStaff = await prisma.staff.findMany({
      where: {
        status: StaffStatus.ACTIVE,

        branches: {
          some: { branchId },
        },

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

      select: { id: true },

      orderBy: { id: "asc" },
    });

    staffIds = eligibleStaff.map((staff) => staff.id);

    if (staffIds.length === 0) {
      return {
        date,
        staffSelectionMode: "AUTO",
        slots: [],
        unavailableReason: "NO_ELIGIBLE_STAFF",
      };
    }
  }

  // =====================================================
  // 8. STAFF SCHEDULES
  // =====================================================

  const schedules = await prisma.staffSchedule.findMany({
    where: {
      staffId: { in: staffIds },
      branchId,
      day,
    },

    orderBy: [{ startTime: "asc" }, { staffId: "asc" }],
  });

  if (schedules.length === 0) {
    return {
      date,
      staffSelectionMode,
      slots: [],
      unavailableReason: "NO_STAFF_SCHEDULE",
    };
  }

  // =====================================================
  // 9. STAFF UNAVAILABILITY
  // =====================================================

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  const unavailability = await prisma.staffUnavailability.findMany({
    where: {
      staffId: { in: staffIds },
      date: dateOnly,
    },
  });

  // =====================================================
  // 10. STAFF-BLOCKING APPOINTMENTS
  // =====================================================

  const now = new Date();

  const staffBlockingAppointments = await prisma.appointment.findMany({
    where: {
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),

      staffId: { in: staffIds },
      date: dateOnly,

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
    },

    select: {
      staffId: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 11. BRANCH-BLOCKING APPOINTMENTS
  // =====================================================

  const branchBlockingAppointments = await prisma.appointment.findMany({
    where: {
      ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),

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

          holdExpiresAt: { gt: now },
        },
      ],
    },

    select: {
      id: true,
      startTime: true,
      endTime: true,
    },
  });

  // =====================================================
  // 12. BRANCH CAPACITY HELPER
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
  // 13. GENERATE STAFF-CANDIDATE SLOTS
  // =====================================================

  const candidateSlots: IAvailabilitySlot[] = [];

  const minimumAllowedTime = new Date(
    now.getTime() + bookingPolicy.minimumBookingNoticeMinutes * 60 * 1000,
  );

  for (const schedule of schedules) {
    const scheduleStart = parseTimeToMinutes(schedule.startTime);

    const scheduleEnd = parseTimeToMinutes(schedule.endTime);

    // ===================================================
    // SERVICE WINDOWS OR NORMAL STAFF SCHEDULE
    // ===================================================

    const allowedWindows = serviceBookingHoursEnabled
      ? serviceBookingWindows
      : [
          {
            start: branchOpenMinutes,
            end: branchCloseMinutes,
          },
        ];

    for (const allowedWindow of allowedWindows) {
      // ===============================================
      // INTERSECTION:
      // BRANCH + STAFF + SERVICE WINDOW
      // ===============================================

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

      // ===============================================
      // GENERATE BOOKING SLOTS
      // ===============================================

      for (
        let start = effectiveStart;
        start + durationMinutes <= effectiveEnd;
        start += bookingPolicy.slotIntervalMinutes
      ) {
        const end = start + durationMinutes;

        // =============================================
        // BRANCH BREAK CHECK
        // =============================================

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

        // =============================================
        // MINIMUM BOOKING NOTICE + TIMEZONE
        // =============================================

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

        // =============================================
        // STAFF UNAVAILABILITY
        // =============================================

        const hasUnavailabilityConflict = unavailability.some((item) => {
          if (item.staffId !== schedule.staffId) {
            return false;
          }

          const unavailableStart = parseTimeToMinutes(item.startTime);

          const unavailableEnd = parseTimeToMinutes(item.endTime);

          return intervalsOverlap(start, end, unavailableStart, unavailableEnd);
        });

        if (hasUnavailabilityConflict) {
          continue;
        }

        // =============================================
        // STAFF APPOINTMENT CONFLICT
        // =============================================

        const hasAppointmentConflict = staffBlockingAppointments.some(
          (appointment) => {
            if (appointment.staffId !== schedule.staffId) {
              return false;
            }

            const appointmentStart = parseTimeToMinutes(appointment.startTime);

            const appointmentEnd = parseTimeToMinutes(appointment.endTime);

            return intervalsOverlap(
              start,
              end,
              appointmentStart,
              appointmentEnd,
            );
          },
        );

        if (hasAppointmentConflict) {
          continue;
        }

        // =============================================
        // BRANCH HOURLY CAPACITY
        // =============================================

        const capacity = getCapacityUsageForSlot(start, end);

        if (!capacity.available) {
          continue;
        }

        // =============================================
        // VALID CANDIDATE SLOT
        // =============================================

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
  // 14. AUTO / ANY STAFF MODE
  // =====================================================

  let slots: IAvailabilitySlot[];

  if (isAutoStaff) {
    const uniqueSlots = new Map<string, IAvailabilitySlot>();

    for (const slot of candidateSlots) {
      const key = `${slot.startTime}-${slot.endTime}`;

      if (!uniqueSlots.has(key)) {
        uniqueSlots.set(key, slot);
      }
    }

    slots = [...uniqueSlots.values()];
  } else {
    slots = candidateSlots;
  }

  // =====================================================
  // 15. SORT RESULT
  // =====================================================

  slots.sort((a, b) => {
    const timeCompare = a.startTime.localeCompare(b.startTime);

    if (timeCompare !== 0) {
      return timeCompare;
    }

    return a.staffId.localeCompare(b.staffId);
  });

  // =====================================================
  // 16. FINAL RESPONSE
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
