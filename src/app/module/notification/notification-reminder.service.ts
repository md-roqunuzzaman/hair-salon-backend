import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { Prisma } from "../../../../generated/prisma/client.js";

// Stored date-only values represent Hong Kong calendar dates, like the booking engine.
export const sendAppointmentReminders = async (now = new Date()) => {
  const until = new Date(now.getTime() + 60 * 60 * 1000);
  const localDate = (value: Date) => new Date(value.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return prisma.$transaction(async tx => {
    const appointments = await tx.appointment.findMany({
      where: {
        appointmentStatus: { in: ["RESERVED", "CONFIRMED"] },
        date: {
          gte: new Date(`${localDate(now)}T00:00:00Z`),
          lte: new Date(`${localDate(until)}T00:00:00Z`),
        },
      },
      select: { id: true, customerId: true, date: true, startTime: true, itemName: true },
    });
    let reminderCount = 0;
    for (const appointment of appointments) {
      const date = appointment.date.toISOString().slice(0, 10);
      const start = new Date(`${date}T${appointment.startTime}:00+08:00`).getTime();
      if (!(start > now.getTime() && start <= until.getTime())) continue;
      // Stable per slot: retries and repeated cron ticks cannot duplicate a reminder.
      // A rescheduled slot gets its own reminder; mark-as-read does not reset it.
      const id = createHash("sha256").update(`reminder:${appointment.id}:${date}:${appointment.startTime}`).digest("hex");
      if (await tx.notification.findUnique({ where: { id }, select: { id: true } })) continue;
      await tx.notification.create({ data: {
        id, userId: appointment.customerId, type: "APPOINTMENT_REMINDER", title: "Upcoming appointment",
        message: `Reminder: ${appointment.itemName} on ${date} at ${appointment.startTime} (Hong Kong time).`,
        translations: {
          "zh-CN": { title: "预约提醒", message: `您的预约将于 ${date} ${appointment.startTime} (Hong Kong time) 开始。` },
          "zh-HK": { title: "預約提醒", message: `您的預約將於 ${date} ${appointment.startTime} (Hong Kong time) 開始。` },
        },
      } });
      reminderCount++;
    }
    return { reminderCount };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};
