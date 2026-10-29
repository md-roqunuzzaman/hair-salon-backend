import type { EmailOutbox, Prisma } from '../../../../generated/prisma/client.js';
import { BUSINESS_EMAIL_RETIREMENT_REASON } from './brand-email-setting.retirement.js';

// Inspection reports product retirement, never eligibility for automatic send.
export async function assessOutboxDelivery(_db: Prisma.TransactionClient, _job: EmailOutbox, _now = new Date()) { return BUSINESS_EMAIL_RETIREMENT_REASON; }
