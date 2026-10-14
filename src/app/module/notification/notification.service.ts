import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import {
  ICreateNotificationPayload,
  IGetNotificationsQuery,
} from "./notification.interface.js";

const createNotification = async (
  payload: ICreateNotificationPayload,
  tx?: Prisma.TransactionClient,
) => {
  const client = tx ?? prisma;

  return client.notification.create({
    data: {
      userId: payload.userId,
      type: payload.type,
      title: payload.title,
      message: payload.message,

      ...(payload.translations !== undefined && {
        translations: {
          ...payload.translations,
        } as Prisma.InputJsonObject,
      }),
    },
  });
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
  markAsRead,
  markAllAsRead,
};
