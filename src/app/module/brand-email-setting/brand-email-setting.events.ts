import { prisma } from "../../lib/prisma.js";
import { enqueueAppointmentEmail, enqueueGroupPurchaseEmail, enqueueRefundEmail } from "./brand-email-setting.payload.js";
export { enqueueAppointmentEmail, enqueueGroupPurchaseEmail, enqueueRefundEmail };

// Email storage failures roll back only this independent reconciliation transaction.
// Repeated bounded cycles catch transactions committed after an earlier scan passed
// their timestamp; stable keys suppress duplicates without a clock-skew assumption.
export async function collectBusinessEmailEvents(limit = 10) {
  let collected = 0;
  const definitions = [
    [
      "RESERVATIONS",
      "appointment",
      "createdAt",
      { bookingMethod: "RESERVE_NOW" },
    ],
    ["APPOINTMENT_PAYMENTS", "appointment", "emailPaymentConfirmedAt", {}],
    ["GROUP_PAYMENTS", "groupPurchase", "emailPurchaseConfirmedAt", {}],
    [
      "CANCELLATIONS",
      "appointment",
      "cancelledAt",
      { appointmentStatus: "CANCELLED" },
    ],
    [
      "RESCHEDULES",
      "notification",
      "createdAt",
      { type: "BOOKING_RESCHEDULED" },
    ],
    ["REFUNDS", "refund", "refundedAt", { status: "SUCCEEDED" }],
  ] as const;
  for (const [stream, model, time, filter] of definitions) {
    try {
      await prisma.$transaction(async (tx) => {
        const cursor = await tx.emailEventCursor.findUnique({
          where: { id: stream },
        });
        if (!cursor) throw new Error("EMAIL_COLLECTION_MIGRATION_REQUIRED");
        const rows: any[] = await (tx[model] as any).findMany({
          where: {
            ...filter,
            [time]: { gte: cursor.startedAt },
            ...(cursor.afterAt
              ? {
                  OR: [
                    { [time]: { gt: cursor.afterAt } },
                    { [time]: cursor.afterAt, id: { gt: cursor.afterId! } },
                  ],
                }
              : {}),
          },
          orderBy: [{ [time]: "asc" }, { id: "asc" }],
          take: Math.max(1, Math.min(limit, 25)),
        });
        for (const row of rows) {
          if (stream === "RESERVATIONS")
            await enqueueAppointmentEmail(tx, row.id, "RESERVE_NOW_RESERVED");
          if (stream === "APPOINTMENT_PAYMENTS")
            await enqueueAppointmentEmail(
              tx,
              row.id,
              row.bookingMethod === "DEPOSIT"
                ? "DEPOSIT_RECEIVED"
                : "PAY_NOW_CONFIRMED",
            );
          if (stream === "GROUP_PAYMENTS")
            await enqueueGroupPurchaseEmail(tx, row.id);
          if (stream === "CANCELLATIONS")
            await enqueueAppointmentEmail(tx, row.id, "BOOKING_CANCELLED");
          if (stream === "REFUNDS") await enqueueRefundEmail(tx, row.id);
          if (stream === "RESCHEDULES") {
            const intent = row.emailIntent as any;
            // Only new explicit snapshots are eligible; never infer old reschedules.
            if (
              intent?.appointmentId &&
              intent?.previous?.date &&
              intent?.target?.date
            ) {
              const a = await tx.appointment.findUnique({
                where: { id: intent.appointmentId },
              });
              if (a && a.customerId === row.userId)
                await enqueueAppointmentEmail(
                  tx,
                  a.id,
                  "BOOKING_RESCHEDULED",
                  { ...intent.previous, date: new Date(intent.previous.date) },
                  row.id,
                  intent.target,
                );
            }
          }
          collected++;
        }
        const last = rows.at(-1);
        await tx.emailEventCursor.update({
          where: { id: stream },
          data: last
            ? { afterAt: last[time], afterId: last.id }
            : { afterAt: null, afterId: null },
        });
      });
    } catch {
      console.error("[Email Collection]", {
        code: "EMAIL_COLLECTION_STORAGE_FAILED",
        stream,
      });
    }
  }
  return { collected };
}
