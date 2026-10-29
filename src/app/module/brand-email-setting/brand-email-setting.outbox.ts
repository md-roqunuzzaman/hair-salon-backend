import type { Prisma } from "../../../../generated/prisma/client.js";
import type { BusinessEmailEvent } from './brand-email-setting.templates.js';

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
  validationData?: Prisma.InputJsonValue;
};

// Retired at the storage boundary too: no insert/upsert/history, even when the
// environment flag is accidentally true. Preserve the public helper signature.
export const enqueueBusinessEmail = async (
  _payload: TEnqueueBusinessEmail,
  _tx?: Prisma.TransactionClient,
) => null;
