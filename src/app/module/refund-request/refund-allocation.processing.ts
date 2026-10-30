import { notificationTemplates } from "../notification/notification.templates.js";
import { Prisma } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { stripe } from '../../lib/stripe.js';
import Stripe from 'stripe';
import { AppError } from '../../utils/app-error.js';
import { cents, money } from '../cancellation-refund/policy.calculation.js';
import { finalizePolicyGroupRefund } from '../cancellation-refund/policy-refund.execution.js';
import { aggregateGroupRefundStatus, validateAllocationPlan } from './refund-allocation.plan.js';
import { walletPaymentFunding, walletRefundSplit } from '../wallet/wallet-payment-ledger.js';
import { notificationService } from '../notification/notification.service.js';
import { auditLogService } from '../auditLog/auditLog.service.js';
async function transaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            return await prisma.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
        }
        catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2)
                throw error;
        }
    }
    throw new AppError('REFUND_SERIALIZATION_CONFLICT', 409);
}
async function lock(tx: Prisma.TransactionClient, requestId: string) {
    const base = await tx.refundRequest.findUnique({ where: { id: requestId }, include: { payment: true } });
    if (!base?.payment.groupPurchaseId)
        throw new AppError('REFUND_GROUP_REQUIRED', 409);
    await tx.$queryRaw `SELECT "id" FROM "GroupPurchase" WHERE "id"=${base.payment.groupPurchaseId} FOR UPDATE`;
    await tx.$queryRaw `SELECT "id" FROM "RefundRequest" WHERE "id"=${requestId} FOR UPDATE`;
    const allocations = await tx.refundAllocation.findMany({ where: { refundRequestId: requestId }, orderBy: { paymentId: 'asc' } });
    for (const a of allocations)
        await tx.$queryRaw `SELECT "id" FROM "Payment" WHERE "id"=${a.paymentId} FOR UPDATE`;
    return base.payment.groupPurchaseId;
}
async function finish(tx: Prisma.TransactionClient, requestId: string, purchaseId: string) {
    const allocations = await tx.refundAllocation.findMany({ where: { refundRequestId: requestId } });
    if (!allocations.length || allocations.some(a => a.status !== 'SUCCEEDED'))
        return;
    const request = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId }, include: { payment: true } });
    const changed = await tx.refundRequest.updateMany({ where: { id: requestId, status: { in: ['PROCESSING', 'FAILED'] } }, data: { status: 'COMPLETED' } });
    if (!changed.count)
        return;
    await finalizePolicyGroupRefund(tx, request);
    await aggregateGroupRefundStatus(tx, purchaseId);
    await notificationService.createNotification({ userId: request.customerId, type: 'REFUND_COMPLETED', title: 'Refund completed', message: `Your group purchase refund of ${request.payment.currency} ${request.amount.toFixed(2)} has been completed.`, translations: notificationTemplates.POLICY_REFUND_COMPLETED(Number(request.amount), request.payment.currency, true), }, tx);
    await auditLogService.createAuditLog({ userId: null, action: 'GROUP_PURCHASE_REFUND_COMPLETED', entityType: 'REFUND_REQUEST', entityId: requestId, metadata: { allocationIds: allocations.map(a => a.id), amount: Number(request.amount) } }, tx);
}
async function recordPaymentRefund(tx: Prisma.TransactionClient, paymentId: string) {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { refunds: true } });
    const total = p.refunds.filter(r => r.status === 'SUCCEEDED').reduce((s, r) => s + cents(r.amount), 0);
    if (total > cents(p.amount))
        throw new AppError('REFUND_AMOUNT_EXCEEDS_AVAILABLE_BALANCE', 409);
    await tx.payment.update({ where: { id: p.id }, data: { status: total === cents(p.amount) ? 'REFUNDED' : 'PARTIALLY_REFUNDED', ...(total === cents(p.amount) ? { refundedAt: new Date() } : {}) } });
}
async function walletRefund(allocationId: string) {
    const reference = await prisma.refundAllocation.findUniqueOrThrow({ where: { id: allocationId } });
    await transaction(async (tx) => {
        const purchaseId = await lock(tx, reference.refundRequestId);
        const a = await tx.refundAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { payment: { include: { refunds: true } }, refund: true } });
        if (a.status === 'SUCCEEDED')
            return;
        if (a.status !== 'PROCESSING' || !a.refund || a.refund.status !== 'PENDING' || a.provider !== 'WALLET')
            throw new AppError('REFUND_ALLOCATION_STATE_INVALID', 409);
        const { wallet, paidCents } = await walletPaymentFunding(tx, a.payment);
        await tx.$queryRaw `SELECT "id" FROM "Wallet" WHERE "id"=${wallet.id} FOR UPDATE`;
        const before = a.payment.refunds.filter(r => r.status === 'SUCCEEDED').reduce((s, r) => s + cents(r.amount), 0);
        const split = walletRefundSplit(cents(a.payment.amount), paidCents, before, cents(a.amount));
        await tx.wallet.update({ where: { id: wallet.id }, data: { paidBalance: { increment: money(split.paidCents) }, bonusBalance: { increment: money(split.bonusCents) } } });
        for (const [balanceType, value] of [['PAID', split.paidCents], ['BONUS', split.bonusCents]] as const)
            if (value > 0)
                await tx.walletTransaction.create({ data: { walletId: wallet.id, paymentId: a.paymentId, ledgerKey: `refund:${a.refundId}:${balanceType}`, type: 'REFUND', balanceType, amount: money(value), referenceId: a.refundId } });
        await tx.refund.update({ where: { id: a.refundId! }, data: { status: 'SUCCEEDED', refundedAt: new Date() } });
        await tx.refundAllocation.update({ where: { id: a.id }, data: { status: 'SUCCEEDED', lastErrorCode: null } });
        await recordPaymentRefund(tx, a.paymentId);
        await aggregateGroupRefundStatus(tx, purchaseId);
        await finish(tx, a.refundRequestId, purchaseId);
    });
}
type StripeAllocation = Prisma.RefundAllocationGetPayload<{
    include: {
        payment: true;
        refund: true;
    };
}>;
function verify(a: StripeAllocation, r: Stripe.Refund) {
    const intent = typeof r.payment_intent === 'string' ? r.payment_intent : r.payment_intent?.id;
    if (!a.refund || !r.id || (a.refund.providerRefundId && a.refund.providerRefundId !== r.id) || intent !== a.payment.providerPaymentId || r.amount !== cents(a.amount) || r.currency?.toUpperCase() !== a.payment.currency || r.metadata?.refundAllocationId !== a.id || r.metadata?.refundId !== a.refundId || r.metadata?.refundRequestId !== a.refundRequestId || r.metadata?.paymentId !== a.paymentId)
        throw new AppError('REFUND_RECONCILIATION_MISMATCH', 409);
}
async function applyStripe(a: StripeAllocation, r: Stripe.Refund) {
    verify(a, r);
    await transaction(async (tx) => {
        const purchaseId = await lock(tx, a.refundRequestId);
        const current = await tx.refundAllocation.findUniqueOrThrow({ where: { id: a.id }, include: { payment: true, refund: true } });
        verify(current, r);
        if (current.status === 'SUCCEEDED')
            return;
        if (!['PROCESSING', 'FAILED'].includes(current.status))
            throw new AppError('REFUND_ALLOCATION_STATE_INVALID', 409);
        const status = r.status === 'succeeded' ? 'SUCCEEDED' : ['failed', 'canceled'].includes(r.status ?? '') ? 'FAILED' : 'PENDING';
        if (status === 'PENDING' && current.refund?.status === 'PENDING' && current.refund.providerRefundId === r.id && current.status === 'PROCESSING' && current.lastErrorCode === null)
            return;
        await tx.refund.update({ where: { id: current.refundId! }, data: { providerRefundId: r.id, status, ...(status === 'SUCCEEDED' ? { refundedAt: new Date() } : {}) } });
        await tx.refundAllocation.update({ where: { id: a.id }, data: { status: status === 'PENDING' ? 'PROCESSING' : status, lastErrorCode: status === 'FAILED' ? 'STRIPE_REFUND_FAILED' : null } });
        if (status === 'SUCCEEDED') {
            await recordPaymentRefund(tx, a.paymentId);
            await aggregateGroupRefundStatus(tx, purchaseId);
            await finish(tx, a.refundRequestId, purchaseId);
        }
    });
}
export async function reconcileRefundAllocation(allocationId: string) {
    const a = await prisma.refundAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { payment: true, refund: true } });
    if (a.provider !== 'STRIPE' || !a.refund || !a.payment.providerPaymentId)
        throw new AppError('REFUND_ALLOCATION_STATE_INVALID', 409);
    let provider: Stripe.Refund | undefined;
    if (a.refund.providerRefundId)
        provider = await stripe.refunds.retrieve(a.refund.providerRefundId);
    else {
        const matches: Stripe.Refund[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 3; page++) {
            const list = await stripe.refunds.list({ payment_intent: a.payment.providerPaymentId, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
            matches.push(...list.data.filter(r => r.metadata?.refundAllocationId === a.id));
            if (!list.has_more)
                break;
            if (page === 2 || !list.data.length)
                throw new AppError('REFUND_MANUAL_RECONCILIATION_REQUIRED', 503);
            cursor = list.data[list.data.length - 1].id;
        }
        if (matches.length !== 1)
            throw new AppError('REFUND_MANUAL_RECONCILIATION_REQUIRED', 503);
        provider = matches[0];
    }
    await applyStripe(a, provider);
}
async function stripeRefund(allocationId: string) {
    const a = await prisma.refundAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { payment: true, refund: true } });
    if (a.status === 'SUCCEEDED')
        return;
    if (a.submittedAt || a.refund?.providerRefundId) {
        await reconcileRefundAllocation(a.id);
        return;
    }
    if (a.status !== 'PROCESSING' || !a.refund || !a.payment.providerPaymentId)
        throw new AppError('REFUND_ALLOCATION_STATE_INVALID', 409);
    const claimed = await transaction(async (tx) => {
        const changed = await tx.refundAllocation.updateMany({ where: { id: a.id, status: 'PROCESSING', submittedAt: null }, data: { submittedAt: new Date() } });
        if (changed.count)
            await tx.refund.update({ where: { id: a.refundId! }, data: { refundAttemptedAt: new Date() } });
        return changed.count === 1;
    });
    if (!claimed)
        return;
    let provider: Stripe.Refund;
    try {
        provider = await stripe.refunds.create({ payment_intent: a.payment.providerPaymentId, amount: cents(a.amount), metadata: { refundAllocationId: a.id, refundRequestId: a.refundRequestId, refundId: a.refundId!, paymentId: a.paymentId } }, { idempotencyKey: a.idempotencyKey, maxNetworkRetries: 0, timeout: 15000 });
    }
    catch {
        await prisma.refundAllocation.updateMany({ where: { id: a.id, status: 'PROCESSING' }, data: { lastErrorCode: 'STRIPE_REFUND_OUTCOME_UNCERTAIN' } });
        return;
    }
    // DB failures after provider acceptance must leave a recoverable intent,
    // never mark FAILED and never issue another create with a new identity.
    await applyStripe(a, provider);
}
export async function allocationResult(requestId: string) {
    const r = await prisma.refundRequest.findUniqueOrThrow({ where: { id: requestId }, include: { payment: true, allocations: { include: { refund: true }, orderBy: { id: 'asc' } } } });
    return { refundRequestId: r.id, paymentId: r.paymentId, refundId: r.refundId, amount: Number(r.amount), currency: r.payment.currency, status: r.status, refundStatus: r.status === 'COMPLETED' ? 'SUCCEEDED' : 'PENDING', allocations: r.allocations.map(a => ({ id: a.id, paymentId: a.paymentId, provider: a.provider, amount: Number(a.amount), status: a.status, refundId: a.refundId, providerRefundId: a.refund?.providerRefundId ?? null, errorCode: a.lastErrorCode })) };
}
export async function processAllocatedRefund(requestId: string) {
    await transaction(async (tx) => {
        await lock(tx, requestId);
        const r = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId }, include: { allocations: true } });
        if (r.status === 'COMPLETED' || r.status === 'PROCESSING')
            return;
        if (r.status !== 'APPROVED' || !r.reviewedBy || !r.reviewedAt)
            throw new AppError('REFUND_APPROVAL_REQUIRED', 409);
        await validateAllocationPlan(tx, r.id);
        const claimed = await tx.refundRequest.updateMany({ where: { id: r.id, status: 'APPROVED', refundId: null }, data: { status: 'PROCESSING' } });
        if (!claimed.count)
            throw new AppError('REFUND_ALREADY_PROCESSING', 409);
        let first: string | undefined;
        for (const a of r.allocations) {
            if (a.status !== 'RESERVED' || a.refundId)
                throw new AppError('REFUND_ALLOCATION_STATE_INVALID', 409);
            const refund = await tx.refund.create({ data: { paymentId: a.paymentId, amount: a.amount, reason: r.reason, idempotencyKey: a.idempotencyKey, status: 'PENDING' } });
            await tx.refundAllocation.update({ where: { id: a.id }, data: { refundId: refund.id, status: 'PROCESSING' } });
            if (a.paymentId === r.paymentId)
                first = refund.id;
        }
        if (!first)
            throw new AppError('REFUND_ANCHOR_PAYMENT_MISMATCH', 409);
        await tx.refundRequest.update({ where: { id: r.id }, data: { refundId: first } });
    });
    const rows = await prisma.refundAllocation.findMany({ where: { refundRequestId: requestId, status: { in: ['PROCESSING', 'FAILED'] } }, orderBy: { createdAt: 'asc' } });
    for (const a of rows) {
        try {
            if (a.provider === 'WALLET' && a.status === 'PROCESSING')
                await walletRefund(a.id);
            else if (a.provider === 'STRIPE')
                await stripeRefund(a.id);
        }
        catch (error) {
            const code = error instanceof AppError ? error.message : 'REFUND_ALLOCATION_RECONCILIATION_REQUIRED';
            await prisma.refundAllocation.updateMany({ where: { id: a.id, status: { not: 'SUCCEEDED' } }, data: { lastErrorCode: /^[A-Z_]+$/.test(code) ? code : 'REFUND_ALLOCATION_RECONCILIATION_REQUIRED' } });
        }
    }
    return allocationResult(requestId);
}
