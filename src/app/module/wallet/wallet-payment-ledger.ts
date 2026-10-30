import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import { cents } from '../cancellation-refund/policy.calculation.js';
export async function walletPaymentFunding(tx: Prisma.TransactionClient, payment: {
    id: string;
    customerId: string;
    groupPurchaseId: string | null;
    appointmentId: string | null;
    amount: Prisma.Decimal;
    currency: string;
}) {
    if (!payment.groupPurchaseId && !payment.appointmentId)
        throw new AppError('WALLET_PAYMENT_REFERENCE_MISSING', 409);
    const wallet = await tx.wallet.findUnique({ where: { customerId: payment.customerId } });
    if (!wallet || wallet.currency !== payment.currency)
        throw new AppError('WALLET_CURRENCY_MISMATCH', 409);
    const type = payment.groupPurchaseId ? 'GROUP_PURCHASE_PAYMENT' : 'APPOINTMENT_PAYMENT';
    let rows = await tx.walletTransaction.findMany({ where: { walletId: wallet.id, type, amount: { lt: 0 }, OR: [{ paymentId: payment.id }, { referenceId: payment.id }] } });
    if (!rows.length) {
        const resource = payment.groupPurchaseId ? { groupPurchaseId: payment.groupPurchaseId } : { appointmentId: payment.appointmentId };
        const payments = await tx.payment.findMany({ where: { ...resource, provider: 'WALLET', status: { in: ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'] } } });
        // Legacy business-reference rows are attributable only when there is one
        // original wallet payment. Never guess a split among historical payments.
        if (payments.length !== 1 || payments[0].id !== payment.id)
            throw new AppError('WALLET_LEDGER_MANUAL_RECONCILIATION_REQUIRED', 409);
        rows = await tx.walletTransaction.findMany({ where: { walletId: wallet.id, type, referenceId: payment.groupPurchaseId ?? payment.appointmentId, paymentId: null, amount: { lt: 0 } } });
    }
    const sum = (balanceType: string) => rows.filter(r => r.balanceType === balanceType).reduce((s, r) => s + cents(r.amount.negated()), 0);
    const paidCents = sum('PAID'), bonusCents = sum('BONUS');
    if (paidCents + bonusCents !== cents(payment.amount) || rows.some(r => !['PAID', 'BONUS'].includes(r.balanceType) || (r.paymentId !== null && r.paymentId !== payment.id)))
        throw new AppError('WALLET_PAYMENT_LEDGER_MISMATCH', 409);
    return { wallet, paidCents, bonusCents };
}
export function walletRefundSplit(total: number, paid: number, before: number, amount: number) {
    if (![total, paid, before, amount].every(Number.isSafeInteger) || total <= 0 || paid < 0 || paid > total || before < 0 || amount <= 0 || before + amount > total)
        throw new AppError('WALLET_REFUND_ALLOCATION_INVALID', 409);
    const cumulative = (value: number) => Number((BigInt(value) * BigInt(paid) * 2n + BigInt(total)) / (BigInt(total) * 2n));
    const paidCents = cumulative(before + amount) - cumulative(before), bonusCents = amount - paidCents;
    if (paidCents < 0 || bonusCents < 0 || cumulative(before + amount) > paid || before + amount - cumulative(before + amount) > total - paid)
        throw new AppError('WALLET_REFUND_ALLOCATION_INVALID', 409);
    return { paidCents, bonusCents };
}
