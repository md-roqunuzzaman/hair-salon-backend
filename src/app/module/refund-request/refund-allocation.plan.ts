import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import { cents, evaluatePolicy } from '../cancellation-refund/policy.calculation.js';
import { executionSnapshot } from '../cancellation-refund/cancellation-refund.interface.js';
import { walletPaymentFunding } from '../wallet/wallet-payment-ledger.js';
export async function lockRefundResource(tx: Prisma.TransactionClient, requestId: string) {
    const r = await tx.refundRequest.findUnique({ where: { id: requestId }, select: { payment: { select: { groupPurchaseId: true, appointmentId: true } } } });
    if (r?.payment.groupPurchaseId)
        await tx.$queryRaw `SELECT "id" FROM "GroupPurchase" WHERE "id"=${r.payment.groupPurchaseId} FOR UPDATE`;
    else if (r?.payment.appointmentId)
        await tx.$queryRaw `SELECT "id" FROM "Appointment" WHERE "id"=${r.payment.appointmentId} FOR UPDATE`;
}
export async function groupRefundFunding(tx: Prisma.TransactionClient, purchaseId: string, customerId: string) {
    const payments = (await tx.payment.findMany({ where: { groupPurchaseId: purchaseId, purpose: 'GROUP_PURCHASE', provider: { in: ['STRIPE', 'WALLET'] }, status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, include: { refunds: true }, orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] })).filter(p => !p.refunds.some(r => r.idempotencyKey === `late-group-purchase-refund-${p.id}`));
    for (const p of payments) {
        if (p.customerId !== customerId || p.currency !== 'HKD' || (p.provider === 'STRIPE' && !p.providerPaymentId))
            throw new AppError('REFUND_RECONCILIATION_REQUIRED', 409);
        if (p.refunds.some(r => r.status === 'PENDING'))
            throw new AppError('REFUND_RECONCILIATION_REQUIRED', 409);
        if (p.provider === 'WALLET')
            await walletPaymentFunding(tx, p);
    }
    const pending = payments.length ? await tx.refundRequest.findFirst({ where: { paymentId: { in: payments.map(p => p.id) }, status: { in: ['PENDING', 'APPROVED', 'PROCESSING'] } } }) : null;
    const funds = [];
    for (const p of payments) {
        const reserved = await tx.refundAllocation.findMany({ where: { paymentId: p.id, status: { in: ['RESERVED', 'PROCESSING'] } } });
        const remaining = cents(p.amount) - p.refunds.filter(r => r.status === 'SUCCEEDED').reduce((sum, r) => sum + cents(r.amount), 0) - reserved.reduce((sum, a) => sum + cents(a.amount), 0);
        if (remaining < 0)
            throw new AppError('REFUND_RECONCILIATION_REQUIRED', 409);
        funds.push({ paymentId: p.id, provider: p.provider, paidCents: cents(p.amount), remainingCents: remaining });
    }
    return { payments, funds, pending };
}
export function allocateRefund(funds: {
    paymentId: string;
    provider: string;
    remainingCents: number;
}[], amount: number) {
    if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new AppError('REFUND_AMOUNT_INVALID', 409);
    let remaining = amount;
    const plan = [];
    for (const fund of funds) {
        const amountCents = Math.min(remaining, fund.remainingCents);
        if (amountCents > 0) {
            plan.push({ ...fund, amountCents });
            remaining -= amountCents;
        }
    }
    if (remaining !== 0)
        throw new AppError('REFUND_AMOUNT_EXCEEDS_AVAILABLE_BALANCE', 409);
    return plan;
}
// Revalidate the durable approval plan, never recalculate/reallocate it.
export async function validateAllocationPlan(tx: Prisma.TransactionClient, requestId: string) {
    const request = await tx.refundRequest.findUnique({ where: { id: requestId }, include: { allocations: { include: { payment: { include: { refunds: true } } } } } });
    if (!request || !request.allocations.length)
        throw new AppError('REFUND_ALLOCATION_PLAN_MISSING', 409);
    const saved = executionSnapshot(request.policySnapshot);
    if (!saved || saved.resourceType !== 'GROUP_REFUND' || !request.policyEvaluatedAt)
        throw new AppError('REFUND_POLICY_SNAPSHOT_REQUIRED', 409);
    const purchase = await tx.groupPurchase.findUnique({ where: { id: saved.resourceId }, include: { appointments: true } });
    if (!purchase || purchase.customerId !== request.customerId || purchase.purchaseBranchId !== saved.policy.branchId || !purchase.purchasedAt || !['PAID', 'PARTIALLY_REFUNDED'].includes(purchase.paymentStatus))
        throw new AppError('POLICY_REFUND_PURCHASE_CHANGED', 409);
    const available = purchase.quantity - purchase.appointments.filter(a => a.appointmentStatus !== 'CANCELLED').length - purchase.refundedQuantity - purchase.forfeitedQuantity;
    if (saved.refundableQuantity < 1 || saved.refundableQuantity > available || purchase.appointments.some(a => ['RESERVED', 'CONFIRMED', 'PENDING_PAYMENT'].includes(a.appointmentStatus)))
        throw new AppError('ACTIVE_APPOINTMENT_RESOLUTION_REQUIRED', 409);
    const calculation = evaluatePolicy(saved.policy, saved.calculation.eligibleCents, request.policyEvaluatedAt.getTime() - purchase.purchasedAt.getTime());
    if (!calculation.allowed || calculation.refundCents !== cents(request.amount) || calculation.refundCents !== saved.calculation.refundCents || calculation.deductionCents !== saved.calculation.deductionCents || request.allocations.reduce((s, a) => s + cents(a.amount), 0) !== cents(request.amount))
        throw new AppError('POLICY_REFUND_CALCULATION_MISMATCH', 409);
    for (const allocation of request.allocations) {
        const p = allocation.payment;
        const savedFunding = saved.funding?.find(f => f.paymentId === p.id);
        if (!savedFunding || savedFunding.provider !== allocation.provider || savedFunding.amountCents !== cents(allocation.amount) || savedFunding.paidCents !== cents(p.amount) || allocation.idempotencyKey !== `refund-allocation-${allocation.id}`)
            throw new AppError('REFUND_ALLOCATION_PLAN_CHANGED', 409);
        if (p.customerId !== request.customerId || p.groupPurchaseId !== purchase.id || p.purpose !== 'GROUP_PURCHASE' || p.currency !== 'HKD' || p.provider !== allocation.provider || !['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status) || !['STRIPE', 'WALLET'].includes(p.provider))
            throw new AppError('REFUND_ALLOCATION_PAYMENT_MISMATCH', 409);
        const committed = p.refunds.filter(r => r.status === 'SUCCEEDED' || r.status === 'PENDING').reduce((s, r) => s + cents(r.amount), 0);
        const reserved = await tx.refundAllocation.findMany({ where: { paymentId: p.id, status: { in: ['RESERVED', 'PROCESSING'] }, refundId: null } });
        if (committed + reserved.reduce((s, a) => s + cents(a.amount), 0) > cents(p.amount))
            throw new AppError('REFUND_AMOUNT_EXCEEDS_AVAILABLE_BALANCE', 409);
        if (p.provider === 'WALLET')
            await walletPaymentFunding(tx, p);
    }
    return request;
}
export async function aggregateGroupRefundStatus(tx: Prisma.TransactionClient, purchaseId: string) {
    const payments = await tx.payment.findMany({ where: { groupPurchaseId: purchaseId, purpose: 'GROUP_PURCHASE', status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } }, include: { refunds: true } });
    const settled = payments.reduce((s, p) => s + cents(p.amount), 0), refunded = payments.reduce((s, p) => s + p.refunds.filter(r => r.status === 'SUCCEEDED').reduce((n, r) => n + cents(r.amount), 0), 0);
    if (refunded > settled)
        throw new AppError('REFUND_AGGREGATE_MISMATCH', 409);
    const status = settled > 0 && refunded === settled ? 'REFUNDED' : refunded > 0 ? 'PARTIALLY_REFUNDED' : 'PAID';
    await tx.groupPurchase.update({ where: { id: purchaseId }, data: { paymentStatus: status } });
    return status;
}
