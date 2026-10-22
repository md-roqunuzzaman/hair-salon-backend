import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import { cents, appointmentTime, evaluatePolicy } from './policy.calculation.js';
import { executionSnapshot } from './cancellation-refund.interface.js';
import { notificationService } from '../notification/notification.service.js';
import { auditLogService } from '../auditLog/auditLog.service.js';
// Call only inside the transaction that first completes the request.
export async function recordPolicyRefundCompletion(tx: Prisma.TransactionClient, request: {
    id: string;
    customerId: string;
    paymentId: string;
    amount: Prisma.Decimal;
    policySnapshot: Prisma.JsonValue | null;
}, refundId: string, currency: string) {
    const saved = executionSnapshot(request.policySnapshot);
    if (!saved)
        return;
    await notificationService.createNotification({ userId: request.customerId, type: 'REFUND_COMPLETED', title: 'Refund completed', message: `Your refund of ${currency} ${request.amount.toFixed(2)} has been completed.` }, tx);
    await auditLogService.createAuditLog({ userId: null, action: 'POLICY_REFUND_COMPLETED', entityType: 'REFUND_REQUEST', entityId: request.id, metadata: { paymentId: request.paymentId, refundId, resourceId: saved.resourceId, amount: Number(request.amount) } }, tx);
}
export async function validatePolicyRefund(tx: Prisma.TransactionClient, request: {
    id: string;
    paymentId: string;
    amount: Prisma.Decimal;
    policySnapshot: Prisma.JsonValue | null;
    policyEvaluatedAt: Date | null;
    refundId?: string | null;
}) {
    const saved = executionSnapshot(request.policySnapshot);
    if (!saved)
        return false;
    const payment = await tx.payment.findUnique({ where: { id: request.paymentId }, include: { refunds: true } });
    if (!payment || !['STRIPE', 'WALLET'].includes(payment.provider) || payment.currency !== 'HKD' || !request.policyEvaluatedAt)
        throw new AppError('POLICY_REFUND_PAYMENT_MISMATCH', 409);
    const already = payment.refunds.filter(r => r.status === 'SUCCEEDED').reduce((s, r) => s + cents(r.amount), 0);
    if (payment.refunds.some(r => r.status === 'PENDING' && r.id !== request.refundId) || cents(request.amount) > cents(payment.amount) - already || cents(request.amount) !== saved.calculation.refundCents)
        throw new AppError('POLICY_REFUND_AMOUNT_CHANGED', 409);
    let elapsedMs: number;
    if (saved.resourceType === 'SERVICE') {
        const appointment = await tx.appointment.findUnique({ where: { id: saved.resourceId } });
        if (!appointment || payment.appointmentId !== appointment.id || appointment.groupPurchaseId || appointment.appointmentStatus !== 'CANCELLED' || !appointment.cancellationResult || saved.policy.branchId !== appointment.branchId)
            throw new AppError('POLICY_REFUND_APPOINTMENT_CHANGED', 409);
        elapsedMs = appointmentTime(appointment.date, appointment.startTime).getTime() - request.policyEvaluatedAt.getTime();
        if (saved.calculation.eligibleCents > cents(payment.amount) - already)
            throw new AppError('POLICY_REFUND_AMOUNT_CHANGED', 409);
    }
    else {
        await tx.$queryRaw `SELECT "id" FROM "GroupPurchase" WHERE "id"=${saved.resourceId} FOR UPDATE`;
        const purchase = await tx.groupPurchase.findUnique({ where: { id: saved.resourceId }, include: { appointments: true } });
        if (!purchase || payment.groupPurchaseId !== purchase.id || purchase.purchaseBranchId !== saved.policy.branchId || !purchase.purchasedAt || !['PAID', 'PARTIALLY_REFUNDED'].includes(purchase.paymentStatus))
            throw new AppError('POLICY_REFUND_PURCHASE_CHANGED', 409);
        if (purchase.appointments.some(a => ['RESERVED', 'CONFIRMED', 'PENDING_PAYMENT'].includes(a.appointmentStatus)))
            throw new AppError('ACTIVE_APPOINTMENT_RESOLUTION_REQUIRED', 409);
        const allocated = purchase.appointments.filter(a => a.appointmentStatus !== 'CANCELLED').length;
        const available = purchase.quantity - allocated - purchase.refundedQuantity - purchase.forfeitedQuantity;
        if (!Number.isSafeInteger(saved.refundableQuantity) || saved.refundableQuantity < 1 || saved.refundableQuantity > available)
            throw new AppError('POLICY_REFUND_QUANTITY_CHANGED', 409);
        const eligible = Math.min(cents(payment.amount) - already, new Prisma.Decimal(cents(payment.amount)).mul(saved.refundableQuantity).div(purchase.quantity).toDecimalPlaces(0, Prisma.Decimal.ROUND_DOWN).toNumber());
        if (eligible !== saved.calculation.eligibleCents)
            throw new AppError('POLICY_REFUND_AMOUNT_CHANGED', 409);
        elapsedMs = request.policyEvaluatedAt.getTime() - purchase.purchasedAt.getTime();
    }
    const calculation = evaluatePolicy(saved.policy, saved.calculation.eligibleCents, elapsedMs);
    if (!calculation.allowed || calculation.refundCents !== cents(request.amount) || calculation.deductionCents !== saved.calculation.deductionCents)
        throw new AppError('POLICY_REFUND_CALCULATION_MISMATCH', 409);
    return true;
}
export async function finalizePolicyGroupRefund(tx: Prisma.TransactionClient, request: {
    policySnapshot: Prisma.JsonValue | null;
}) {
    const saved = executionSnapshot(request.policySnapshot);
    if (saved?.resourceType !== 'GROUP_REFUND')
        return;
    await tx.$queryRaw `SELECT "id" FROM "GroupPurchase" WHERE "id"=${saved.resourceId} FOR UPDATE`;
    const purchase = await tx.groupPurchase.findUniqueOrThrow({ where: { id: saved.resourceId } });
    if (purchase.refundedQuantity + saved.refundableQuantity > purchase.quantity)
        throw new AppError('REFUND_QUANTITY_RECONCILIATION_REQUIRED', 409);
    await tx.groupPurchase.update({ where: { id: purchase.id }, data: { refundedQuantity: { increment: saved.refundableQuantity }, paymentStatus: 'REFUNDED' } });
}
