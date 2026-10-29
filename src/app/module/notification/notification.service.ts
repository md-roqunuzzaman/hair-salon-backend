import { Prisma, Role, type Notification } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import {
  ICreateNotificationPayload,
  IGetNotificationsQuery,
} from "./notification.interface.js";

const notifyAppointmentTeam = async (
  appointmentId: string,
  event: Pick<ICreateNotificationPayload, "type" | "title" | "translations">,
  tx: Prisma.TransactionClient,
  previousStaffId?: string,
) => {
  const appointment = await tx.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, customerId: true, branchId: true, staffId: true, appointmentStatus: true, itemName: true, itemNameTranslations: true, date: true, startTime: true },
  });
  if (!appointment) throw new AppError("Appointment not found", 404);
  // Pending bookings are visible to management; staff receive actionable bookings.
  const staffIds = (event.type === "BOOKING_CREATED" && appointment.appointmentStatus === "PENDING_PAYMENT") || event.type === "BOOKING_EXPIRED"
    ? []
    : [...new Set([appointment.staffId, previousStaffId].filter((id): id is string => Boolean(id)))];
  const users = await tx.user.findMany({
    where: {
      status: "ACTIVE",
      id: { not: appointment.customerId },
      OR: [
        { role: Role.BRAND_OWNER },
        { role: Role.BRANCH_MANAGER, managedBranches: { some: { branchId: appointment.branchId } } },
        { role: Role.STAFF, staffProfile: { is: { id: { in: staffIds }, status: "ACTIVE" } } },
      ],
    },
    select: { id: true },
  });
  const recipients = [...new Set(users.map(user => user.id))].filter(id => id !== appointment.customerId);
  if (!recipients.length) return;
  const date = appointment.date.toISOString().slice(0, 10);
  const translations = Object.fromEntries((["en", "zh-CN", "zh-HK"] as const).map(language => {
    const item = getLocalizedContent(appointment.itemNameTranslations, language, { name: appointment.itemName });
    const title = event.translations?.[language]?.title ?? (event.type === "BOOKING_CREATED"
      ? { en: "New booking", "zh-CN": "新预约", "zh-HK": "新預約" }[language] : event.title);
    const message = language === "en"
      ? `Appointment ${appointment.id}: ${item.name}, ${date} at ${appointment.startTime}.`
      : language === "zh-CN"
        ? `预约 ${appointment.id}：${item.name}，${date} ${appointment.startTime}。`
        : `預約 ${appointment.id}：${item.name}，${date} ${appointment.startTime}。`;
    return [language, { title, message }];
  }));
  await tx.notification.createMany({ data: recipients.map(userId => ({
    userId, type: event.type, title: translations.en.title, message: translations.en.message,
    translations: translations as Prisma.InputJsonObject,
  })) });
};

const createNotification = async (
  payload: ICreateNotificationPayload,
  tx?: Prisma.TransactionClient,
): Promise<Notification> => {
  if (payload.appointmentId && !tx) {
    return prisma.$transaction(client => createNotification(payload, client));
  }
  const client = tx ?? prisma;

  const notification = await client.notification.create({
    data: {
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,
      ...(payload.emailIntent ? { emailIntent: payload.emailIntent as Prisma.InputJsonObject } : {}),

      ...(payload.translations !== undefined && {
        translations: {
          ...payload.translations,
        } as Prisma.InputJsonObject,
      }),
    },
  });
  if (payload.appointmentId && tx) await notifyAppointmentTeam(payload.appointmentId, payload, tx, payload.previousStaffId);
  return notification;
};

const getNotifications = async (
  userId: string,
  query: IGetNotificationsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  const where = {
    userId,

    ...(query.unreadOnly === true && {
      isRead: false,
    }),
  };

  const [notifications, total] = await prisma.$transaction([
    prisma.notification.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        translations: true,
        isRead: true,
        createdAt: true,
      },
    }),

    prisma.notification.count({
      where,
    }),
  ]);

  // =====================================================
  // LOCALIZE NOTIFICATIONS
  // =====================================================

  const items = notifications.map((notification) => {
    const localized = getLocalizedContent(notification.translations, language, {
      title: notification.title,
      message: notification.message,
    });

    return {
      id: notification.id,
      type: notification.type,
      title: localized.title,
      message: localized.message,
      isRead: notification.isRead,
      createdAt: notification.createdAt,
    };
  });

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

const markAsRead = async (userId: string, notificationId: string) => {
  const notification = await prisma.notification.findUnique({
    where: {
      id: notificationId,
    },

    select: {
      id: true,
      userId: true,
      isRead: true,
    },
  });

  if (!notification) {
    throw new AppError("NOTIFICATION_NOT_FOUND", 404);
  }

  if (notification.userId !== userId) {
    throw new AppError("You are not allowed to access this notification", 403);
  }

  if (notification.isRead) {
    return {
      id: notification.id,
      isRead: true,
    };
  }

  const updatedNotification = await prisma.notification.update({
    where: {
      id: notificationId,
    },

    data: {
      isRead: true,
    },

    select: {
      id: true,
      isRead: true,
    },
  });

  return updatedNotification;
};

const markAllAsRead = async (userId: string) => {
  await prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },

    data: {
      isRead: true,
    },
  });

  return null;
};

export const notificationService = {
  getNotifications,
  createNotification,
  notifyAppointmentTeam,
  markAsRead,
  markAllAsRead,
};
