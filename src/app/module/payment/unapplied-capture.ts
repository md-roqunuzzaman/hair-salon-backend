import { Prisma } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/app-error.js';
import { getOrCreateLateGroupPurchaseRefund, ensureLateGroupPurchaseRefund } from './late-group-refund.js';
import { notificationService } from '../notification/notification.service.js';
import { notificationTemplates } from '../notification/notification.templates.js';
import { auditLogService } from '../auditLog/auditLog.service.js';
// Only for verified captured funds which could not be applied. This is the
// existing late/duplicate-payment policy, never a customer refund-approval path.
export async function reconcileUnappliedCapture(paymentId: string, event: {
    id: string;
    type: string;
}) {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const intent = await getOrCreateLateGroupPurchaseRefund(payment.id, payment.amount);
    let provider: Awaited<ReturnType<typeof ensureLateGroupPurchaseRefund>>;
    try {
        provider = await ensureLateGroupPurchaseRefund(intent.id);
    }
    catch (error) {
        if (error instanceof AppError)
            throw error;
        throw new AppError('CAPTURE_REFUND_OUTCOME_UNCERTAIN', 503);
    }
    if (provider.status !== 'SUCCEEDED' || !provider.providerRefundId || provider.requiresInvestigation)
        throw new AppError('CAPTURE_REFUND_RECONCILIATION_REQUIRED', 503);
    for (let attempt = 0; attempt < 3; attempt++)
        try {
            await prisma.$transaction(async (tx) => {
                if (payment.groupPurchaseId)
                    await tx.$queryRaw `SELECT "id" FROM "GroupPurchase" WHERE "id"=${payment.groupPurchaseId} FOR UPDATE`;
                else if (payment.appointmentId)
                    await tx.$queryRaw `SELECT "id" FROM "Appointment" WHERE "id"=${payment.appointmentId} FOR UPDATE`;
                await tx.$queryRaw `SELECT "id" FROM "Payment" WHERE "id"=${paymentId} FOR UPDATE`;
                const current = await tx.refund.findUniqueOrThrow({ where: { id: intent.id } });
                if (current.providerRefundId && current.providerRefundId !== provider.providerRefundId)
                    throw new AppError('REFUND_RECONCILIATION_MISMATCH', 409);
                if (current.status !== 'SUCCEEDED') {
                    const now = new Date();
                    await tx.refund.update({ where: { id: intent.id }, data: { status: 'SUCCEEDED', providerRefundId: provider.providerRefundId, refundedAt: now } });
                    await tx.payment.update({ where: { id: paymentId }, data: { status: 'REFUNDED', refundedAt: now } });
                    // A losing capture must never alter an already funded appointment.
                    if (payment.appointmentId && !payment.groupPurchaseId) {
                        const other = await tx.payment.findFirst({ where: { appointmentId: payment.appointmentId, id: { not: paymentId }, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } } });
                        if (!other)
                            await tx.appointment.update({ where: { id: payment.appointmentId }, data: { paymentStatus: 'REFUNDED', holdExpiresAt: null } });
                    }
                    const translations = payment.groupPurchaseId ? notificationTemplates.LATE_GROUP_REFUND(Number(payment.amount), payment.currency) : notificationTemplates.LATE_APPOINTMENT_REFUND(Number(payment.amount), payment.currency);
                    await notificationService.createNotification({ appointmentId: payment.appointmentId ?? undefined, userId: payment.customerId, type: 'REFUND_COMPLETED', title: translations.en!.title!, message: translations.en!.message!, translations }, tx);
                    await auditLogService.createAuditLog({ userId: null, action: 'UNAPPLIED_CAPTURE_REFUNDED', entityType: 'PAYMENT', entityId: paymentId, metadata: { refundId: intent.id, providerRefundId: provider.providerRefundId } }, tx);
                }
                await tx.stripeWebhookEvent.upsert({ where: { id: event.id }, create: { id: event.id, type: event.type }, update: {} });
            }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
            return { received: true as const };
        }
        catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2)
                throw error;
        }
    throw new AppError('CAPTURE_REFUND_RECONCILIATION_REQUIRED', 503);
}
