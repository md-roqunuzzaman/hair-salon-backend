import type { Prisma } from '../../../../generated/prisma/client.js';

// Retained signatures for compatibility. Customer operations no longer call these
// helpers, and accidental callers cannot recreate retired business email jobs.
export async function enqueueAppointmentEmail(_tx: Prisma.TransactionClient, _id: string, _event: 'PAY_NOW_CONFIRMED'|'RESERVE_NOW_RESERVED'|'DEPOSIT_RECEIVED'|'BOOKING_CANCELLED'|'BOOKING_RESCHEDULED', _previous?: { date: Date; startTime: string; endTime: string; staffId: string }) { return null; }
export async function enqueueGroupPurchaseEmail(_tx: Prisma.TransactionClient, _id: string) { return null; }
export async function enqueueRefundEmail(_tx: Prisma.TransactionClient, _id: string) { return null; }
