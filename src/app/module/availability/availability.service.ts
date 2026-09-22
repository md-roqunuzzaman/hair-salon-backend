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
  IAvailabilityQuery,
  IAvailabilityResult,
  IAvailabilitySlot,
} from "./availability.interface.js";

const HK_TIMEZONE = "Asia/Hong_Kong";

const parseTimeToMinutes = (time: string) => {
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

const getHongKongDateString = () => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HK_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
};

const createHongKongDateTime = (date: string, time: string) => {
  return new Date(`${date}T${time}:00+08:00`);
};

const getAvailableSlots = async (
  query: IAvailabilityQuery,
): Promise<IAvailabilityResult> => {
  const { branchId, serviceId, packageId, staffId, staff, date } = query;

  // =====================================================
  // 1. BRANCH + BOOKING POLICY
  // =====================================================

  const branch = await prisma.branch.findUnique({
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

  if (branch.status !== BranchStatus.ACTIVE) {
    throw new AppError("Branch is inactive", 400);
  }

  if (!branch.bookingPolicy) {
    throw new AppError("Branch booking policy not found", 404);
  }

  const bookingPolicy = branch.bookingPolicy;

  // =====================================================
  // 2. BOOKING DATE POLICY
  // =====================================================

  const currentHKDate = getHongKongDateString();

  const currentDateOnly = new Date(`${currentHKDate}T00:00:00.000Z`);

  const requestedDateOnly = new Date(`${date}T00:00:00.000Z`);

  const dayDifference = Math.floor(
    (requestedDateOnly.getTime() - currentDateOnly.getTime()) /
      (1000 * 60 * 60 * 24),
  );

  // Past date
  if (dayDifference < 0) {
    return {
      date,
      slots: [],
    };
  }

  // Too far in advance
  if (dayDifference > bookingPolicy.maximumAdvanceBookingDays) {
    return {
      date,
      slots: [],
    };
  }

  // =====================================================
  // 3. SERVICE / PACKAGE
  // =====================================================

  let durationMinutes: number;

  if (serviceId) {
    const service = await prisma.service.findUnique({
      where: {
        id: serviceId,
      },
      include: {
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
      throw new AppError("Service is not available at this branch", 400);
    }

    durationMinutes = service.durationMinutes;
  } else {
    const packageData = await prisma.package.findUnique({
      where: {
        id: packageId!,
      },
      include: {
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
      throw new AppError("Package is not available at this branch", 400);
    }

    durationMinutes = packageData.durationMinutes;
  }

  // =====================================================
  // 4. RESOLVE STAFF
  // =====================================================

  let staffIds: string[] = [];

  if (staffId) {
    const staffMember = await prisma.staff.findUnique({
      where: {
        id: staffId,
      },
      include: {
        branches: {
          where: {
            branchId,
          },
          select: {
            branchId: true,
          },
        },

        services: serviceId
          ? {
              where: {
                serviceId,
              },
              select: {
                serviceId: true,
              },
            }
          : false,

        packages: packageId
          ? {
              where: {
                packageId,
              },
              select: {
                packageId: true,
              },
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
  }

  // =====================================================
  // 5. ANY STAFF
  // =====================================================

  if (staff === "ANY") {
    const eligibleStaff = await prisma.staff.findMany({
      where: {
        status: StaffStatus.ACTIVE,

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
    });

    staffIds = eligibleStaff.map((staffMember) => staffMember.id);

    if (staffIds.length === 0) {
      return {
        date,
        slots: [],
      };
    }
  }

  // =====================================================
  // 6. BRANCH BUSINESS HOURS
  // =====================================================

  const day = getDayOfWeek(date);

  const businessHour = await prisma.branchBusinessHour.findFirst({
    where: {
      branchId,
      day,
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
      slots: [],
    };
  }

  const branchOpenMinutes = parseTimeToMinutes(businessHour.openTime);

  const branchCloseMinutes = parseTimeToMinutes(businessHour.closeTime);

  // =====================================================
  // 7. STAFF SCHEDULES
  // =====================================================

  const schedules = await prisma.staffSchedule.findMany({
    where: {
      staffId: {
        in: staffIds,
      },
      branchId,
      day,
    },
  });

  if (schedules.length === 0) {
    return {
      date,
      slots: [],
    };
  }

  // =====================================================
  // 8. STAFF UNAVAILABILITY
  // =====================================================

  const dateOnly = new Date(`${date}T00:00:00.000Z`);

  const unavailability = await prisma.staffUnavailability.findMany({
    where: {
      staffId: {
        in: staffIds,
      },
      date: dateOnly,
    },
  });

  // =====================================================
  // 9. BLOCKING APPOINTMENTS / ACTIVE HOLDS
  // =====================================================

  const now = new Date();

  const blockingAppointments = await prisma.appointment.findMany({
    where: {
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
  // 10. GENERATE AVAILABLE SLOTS
  // =====================================================

  const slots: IAvailabilitySlot[] = [];

  const minimumAllowedTime = new Date(
    now.getTime() + bookingPolicy.minimumBookingNoticeMinutes * 60 * 1000,
  );

  for (const schedule of schedules) {
    const scheduleStart = parseTimeToMinutes(schedule.startTime);

    const scheduleEnd = parseTimeToMinutes(schedule.endTime);

    const effectiveStart = Math.max(branchOpenMinutes, scheduleStart);

    const effectiveEnd = Math.min(branchCloseMinutes, scheduleEnd);

    if (effectiveStart >= effectiveEnd) {
      continue;
    }

    for (
      let start = effectiveStart;
      start + durationMinutes <= effectiveEnd;
      start += bookingPolicy.slotIntervalMinutes
    ) {
      const end = start + durationMinutes;

      const startTime = minutesToTime(start);
      const endTime = minutesToTime(end);

      // ---------------------------------------------
      // Minimum booking notice
      // ---------------------------------------------

      const slotDateTime = createHongKongDateTime(date, startTime);

      if (slotDateTime < minimumAllowedTime) {
        continue;
      }

      // ---------------------------------------------
      // Staff unavailability
      // ---------------------------------------------

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

      // ---------------------------------------------
      // Appointment / hold conflicts
      // ---------------------------------------------

      const hasAppointmentConflict = blockingAppointments.some(
        (appointment) => {
          if (appointment.staffId !== schedule.staffId) {
            return false;
          }

          const appointmentStart = parseTimeToMinutes(appointment.startTime);

          const appointmentEnd = parseTimeToMinutes(appointment.endTime);

          return intervalsOverlap(start, end, appointmentStart, appointmentEnd);
        },
      );

      if (hasAppointmentConflict) {
        continue;
      }

      slots.push({
        startTime,
        endTime,
        staffId: schedule.staffId,
        available: true,
      });
    }
  }

  // =====================================================
  // 11. SORT RESULT
  // =====================================================

  slots.sort((a, b) => {
    const timeCompare = a.startTime.localeCompare(b.startTime);

    if (timeCompare !== 0) {
      return timeCompare;
    }

    return a.staffId.localeCompare(b.staffId);
  });

  return {
    date,
    slots,
  };
};

export const AvailabilityService = {
  getAvailableSlots,
};
