import { z } from 'zod';
import { AppointmentStatus, BookingMethod, PaymentProvider, PaymentStatus, SalonPaymentMethod } from '../../../../generated/prisma/enums.js';

const date = z.string().datetime({ offset: true }).transform(value => new Date(value));
export const orderType = z.enum(['APPOINTMENT', 'GROUP_PURCHASE']);
export const orderQuery = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  branchId: z.string().uuid().optional(), customerId: z.string().uuid().optional(),
  orderType: orderType.optional(), bookingMethod: z.enum(BookingMethod).optional(),
  paymentStatus: z.enum(PaymentStatus).optional(), paymentProvider: z.enum(PaymentProvider).optional(),
  salonPaymentMethod: z.enum(SalonPaymentMethod).optional(),
  appointmentStatus: z.enum(AppointmentStatus).optional(),
  startDate: date.optional(), endDate: date.optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'amount', 'orderNumber']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict().refine(q => !q.startDate || !q.endDate || q.startDate < q.endDate,
  { message: 'endDate must be after startDate', path: ['endDate'] });
export const orderParams = z.object({ orderType, orderId: z.string().uuid() });
export type OrderQuery = z.infer<typeof orderQuery>;
export type OrderType = z.infer<typeof orderType>;
export type OrderActor = { userId: string; role: string };
