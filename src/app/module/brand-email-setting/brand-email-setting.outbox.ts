import { Prisma } from "../../../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { EMAIL_EVENTS, type BusinessEmailEvent } from './brand-email-setting.templates.js';
import { z } from 'zod';

type TEnqueueBusinessEmail = {
  brandId: string;
  userId?: string;
  appointmentId?: string;
  eventType: BusinessEmailEvent;
  idempotencyKey: string;
  recipientEmail: string;
  subject: string;
  html: string;
  text?: string;
};

export const enqueueBusinessEmail = async (
  payload: TEnqueueBusinessEmail,
  tx: Prisma.TransactionClient = prisma,
) => {
  const {
    brandId,
    userId,
    appointmentId,
    eventType,
    idempotencyKey,
    recipientEmail,
    subject,
    html,
    text,
  } = payload;

  const email = recipientEmail.trim().toLowerCase();

  if (!z.email().safeParse(email).success || !EMAIL_EVENTS.includes(eventType)) {
    return null;
  }

  if (!idempotencyKey.trim()) {
    throw new Error("Email idempotency key is required");
  }

  const outbox = await tx.emailOutbox.upsert({
    where: {
      idempotencyKey,
    },
    update: {},
    create: {
      brandId,
      userId: userId ?? null,
      appointmentId: appointmentId ?? null,
      eventType,
      idempotencyKey,
      recipientEmail: email,
      subject,
      html,
      text,
      status: "PENDING",
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
    },
  });

  return outbox;
};
