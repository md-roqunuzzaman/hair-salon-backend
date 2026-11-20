import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import { orderSQL, type Dialect } from './admin-order.query.js';
import type { OrderActor, OrderQuery, OrderType } from './admin-order.validation.js';

const customer = { id: true, name: true, email: true, phone: true } as const;
const branch = { id: true, name: true, brandId: true } as const;
const appointmentSelect = {
  id: true, orderNumber: true, customerId: true, branchId: true, groupPurchaseId: true,
  bookingMethod: true, appointmentStatus: true, paymentStatus: true, date: true,
  startTime: true, endTime: true, timezone: true, durationMinutes: true,
  price: true, currency: true, itemName: true, itemNameTranslations: true,
  depositPercentage: true, depositAmount: true, remainingAmount: true,
  qrVerifiedAt: true, qrVerifiedBy: true, cancelledAt: true, cancellationReason: true,
  completedAt: true, noShowAt: true, noShowReason: true, holdExpiresAt: true,
  entitlementCancellationOutcome: true, createdAt: true, updatedAt: true,
  customer: { select: customer }, branch: { select: branch },
  staff: { select: { id: true, name: true } },
  service: { select: { id: true, name: true, translations: true } },
  package: { select: { id: true, name: true, translations: true } },
} as const satisfies Prisma.AppointmentSelect;
const paymentSelect = {
  id: true, customerId: true, appointmentId: true, groupPurchaseId: true, walletTopupId: true,
  purpose: true, provider: true, salonPaymentMethod: true, amount: true, currency: true,
  status: true, paidAt: true, failedAt: true, refundedAt: true, createdAt: true,
  appointment: { select: { groupPurchaseId: true } }, settledGroupPurchase: { select: { id: true } },
  refunds: { select: { id: true, amount: true, reason: true, status: true, refundedAt: true, createdAt: true } },
  refundRequests: { select: {
    id: true, amount: true, reason: true, status: true, requestType: true, refundId: true,
    reviewedAt: true, createdAt: true, isCancellationOnly: true,
    allocations: { select: { id: true, paymentId: true, amount: true, provider: true, status: true, refundId: true } },
  } },
} as const satisfies Prisma.PaymentSelect;

type Payment = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;
type Appointment = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;
const money = (value: Prisma.Decimal | null) => value === null ? null : value.toFixed(2);
const mapAppointment = (a: Appointment) => ({
  ...a, amount: money(a.price), price: undefined, depositPercentage: money(a.depositPercentage),
  depositAmount: money(a.depositAmount), remainingAmount: money(a.remainingAmount),
  qrVerified: a.qrVerifiedAt !== null,
});

function mapPayment(p: Payment) {
  return {
    id: p.id, appointmentId: p.appointmentId, groupPurchaseId: p.groupPurchaseId,
    purpose: p.purpose, provider: p.provider, salonPaymentMethod: p.salonPaymentMethod,
    method: p.provider === 'SALON' ? p.salonPaymentMethod : p.provider,
    amount: money(p.amount), currency: p.currency, status: p.status,
    paidAt: p.paidAt, failedAt: p.failedAt, refundedAt: p.refundedAt, createdAt: p.createdAt,
    refunds: p.refunds.map(r => ({ ...r, amount: money(r.amount) })),
    refundRequests: p.refundRequests.map(r => ({ ...r, amount: money(r.amount),
      allocations: r.allocations.map(a => ({ ...a, amount: money(a.amount) })) })),
  };
}

type PaymentStage = 'DEPOSIT' | 'REMAINING' | 'FULL' | 'UNCLASSIFIED';
const purposeStage = (p: Payment): PaymentStage => p.purpose === 'APPOINTMENT_DEPOSIT' ? 'DEPOSIT'
  : p.purpose === 'APPOINTMENT_REMAINING' ? 'REMAINING' : p.purpose === 'APPOINTMENT' ? 'FULL' : 'UNCLASSIFIED';
function finance(payments: Payment[], stage: (p: Payment) => PaymentStage = purposeStage) {
  const succeededRefunds = new Map<string, Prisma.Decimal>();
  const seen = new Set<string>();
  for (const p of payments) for (const r of p.refunds) {
    if (r.status !== 'SUCCEEDED' || seen.has(r.id)) continue;
    seen.add(r.id);
    succeededRefunds.set(p.currency, (succeededRefunds.get(p.currency) ?? new Prisma.Decimal(0)).plus(r.amount));
  }
  const authorizedPaymentIds = new Set(payments.map(p => p.id));
  return { payments: payments.map(p => {
    const mapped = mapPayment(p);
    return { ...mapped, stage: stage(p), refundRequests: mapped.refundRequests.map(r => ({
      ...r, allocations: r.allocations.filter(a => authorizedPaymentIds.has(a.paymentId)),
    })) };
  }), refundedAmounts: [...succeededRefunds].map(([currency, amount]) => ({ currency, amount: money(amount) })) };
}

// Reject contradictory parent links, wallet funding and foreign-customer financial records.
function belongs(p: Payment, type: OrderType, id: string, customerId: string, settledPaymentId?: string | null) {
  if (p.walletTopupId || p.customerId !== customerId) return false;
  if (type === 'APPOINTMENT') return p.appointmentId === id && !p.groupPurchaseId && !p.settledGroupPurchase;
  if (p.groupPurchaseId && p.groupPurchaseId !== id || p.settledGroupPurchase && p.settledGroupPurchase.id !== id) return false;
  if (p.appointmentId && p.appointment?.groupPurchaseId !== id) return false;
  return p.groupPurchaseId === id || p.appointment?.groupPurchaseId === id || p.id === settledPaymentId;
}

export function createAdminOrderService(db: Prisma.TransactionClient, dialect: Dialect) {
  const read = async (actor: OrderActor, q: OrderQuery, detail?: { type: OrderType; id: string }) => {
    const sql = orderSQL(actor, q, dialect, detail);
    const counts = await db.$queryRaw<{ total: bigint | number }[]>(sql.count);
    const keys = await db.$queryRaw<{ orderType: OrderType; id: string; brandId: string | null }[]>(sql.page);
    const brands = new Map(keys.map(key => [key.orderType + ':' + key.id, key.brandId]));
    const appointmentIds = keys.filter(k => k.orderType === 'APPOINTMENT').map(k => k.id);
    const purchaseIds = keys.filter(k => k.orderType === 'GROUP_PURCHASE').map(k => k.id);
    const permittedBranch = actor.role === 'BRAND_OWNER'
      ? { brand: { ownerId: actor.userId } }
      : { managers: { some: { userId: actor.userId } } };
    const appointments = appointmentIds.length ? await db.appointment.findMany({
      where: { id: { in: appointmentIds }, branch: permittedBranch }, select: appointmentSelect,
    }) : [];
    const groups = purchaseIds.length ? await db.groupPurchase.findMany({
      where: { id: { in: purchaseIds } }, select: {
        id: true, orderNumber: true, customerId: true, purchaseBranchId: true,
        purchaseFlow: true, bookingMethod: true, paymentStatus: true, amount: true, unitPrice: true,
        currency: true, quantity: true, forfeitedQuantity: true, refundedQuantity: true,
        depositPercentage: true, depositAmount: true, remainingAmount: true, validDaysSnapshot: true,
        purchasedAt: true, reservationExpiresAt: true, settledPaymentId: true, createdAt: true, updatedAt: true,
        customer: { select: customer }, purchaseBranch: { select: branch },
        package: { select: { id: true, name: true, translations: true } },
        appointments: { where: { branch: permittedBranch }, select: appointmentSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
      },
    }) : [];
    const payments = keys.length ? await db.payment.findMany({
      where: { AND: [{ OR: [
        { appointmentId: { in: appointmentIds } }, { groupPurchaseId: { in: purchaseIds } },
        { appointment: { groupPurchaseId: { in: purchaseIds } } },
        { id: { in: groups.flatMap(g => g.settledPaymentId ? [g.settledPaymentId] : []) } },
      ] }, { OR: [{ appointmentId: null }, { appointment: { branch: permittedBranch } }] }] },
      select: paymentSelect, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }) : [];
    const result = new Map<string, unknown>();
    for (const a of appointments) result.set('APPOINTMENT:' + a.id, {
      orderType: 'APPOINTMENT', brandId: brands.get('APPOINTMENT:' + a.id), ...mapAppointment(a),
      ...finance(payments.filter(p => belongs(p, 'APPOINTMENT', a.id, a.customerId))),
    });
    for (const g of groups) {
      const { purchaseBranch, appointments: related, settledPaymentId, ...record } = g;
      const groupPayments = payments.filter(p => belongs(p, 'GROUP_PURCHASE', g.id, g.customerId, settledPaymentId));
      const initial = groupPayments.find(p => p.id === settledPaymentId && p.currency === g.currency
        && g.depositAmount !== null && p.amount.equals(g.depositAmount));
      const stage = (p: Payment): PaymentStage => {
        if (p.purpose !== 'GROUP_PURCHASE') return purposeStage(p);
        if (g.bookingMethod !== 'DEPOSIT') return g.bookingMethod === 'PAY_NOW' || g.bookingMethod === 'RESERVE_NOW' ? 'FULL' : 'UNCLASSIFIED';
        if (!initial || p.currency !== g.currency) return 'UNCLASSIFIED';
        if (p.id === initial.id) return 'DEPOSIT';
        return p.amount.equals(g.amount.minus(g.depositAmount!)) ? 'REMAINING' : 'UNCLASSIFIED';
      };
      result.set('GROUP_PURCHASE:' + g.id, {
        ...record, orderType: 'GROUP_PURCHASE', brandId: brands.get('GROUP_PURCHASE:' + g.id), branch: purchaseBranch,
        ownershipEvidence: g.purchaseBranchId ? 'PURCHASE_BRANCH' : 'PURCHASE_POLICY_SNAPSHOT',
        amount: money(g.amount), unitPrice: money(g.unitPrice), depositPercentage: money(g.depositPercentage),
        depositAmount: money(g.depositAmount), remainingAmount: money(g.remainingAmount),
        expiresAt: g.purchasedAt && g.validDaysSnapshot !== null
          ? new Date(g.purchasedAt.getTime() + g.validDaysSnapshot * 86400000) : null,
        relatedAppointments: related.map(mapAppointment),
        relatedAppointmentScope: 'AUTHORIZED_BRANCHES_ONLY',
        relatedPaymentScope: 'PARENT_ORDER_AND_AUTHORIZED_APPOINTMENTS_ONLY',
        ...finance(groupPayments, stage),
      });
    }
    const total = Number(counts[0]?.total ?? 0);
    return { items: keys.map(k => result.get(k.orderType + ':' + k.id)).filter(x => x !== undefined),
      pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) },
      coverage: { walletTopups: 'EXCLUDED_FUNDING_TRANSACTIONS',
        unverifiedOwnership: 'EXCLUDED; see admin-order-management.md for exact ownership rules' } };
  };
  return {
    list: (actor: OrderActor, query: OrderQuery) => read(actor, query),
    detail: async (actor: OrderActor, query: OrderQuery, type: OrderType, id: string) => {
      const result = await read(actor, query, { type, id });
      if (!result.items.length) throw new AppError('Order not found', 404);
      return result.items[0];
    },
  };
}
