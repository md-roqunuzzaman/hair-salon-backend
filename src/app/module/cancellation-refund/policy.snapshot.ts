import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import { PolicyModule, PolicySnapshot, isSnapshot } from './policy.calculation.js';
export async function capturePolicy(tx: Prisma.TransactionClient, branchId: string, module: PolicyModule): Promise<PolicySnapshot> {
    const policy = module === 'SERVICE' ? await tx.branchCancellationPolicy.findUnique({ where: { branchId } }) : module === 'GROUP_REFUND' ? await tx.groupPurchaseRefundPolicy.findUnique({ where: { branchId } }) : await tx.groupPurchaseCancellationPolicy.findUnique({ where: { branchId } });
    if (policy?.isEnabled)
        return JSON.parse(JSON.stringify({ engineVersion: 1, module, branchId, version: policy.version, config: policy }));
    const booking = await tx.branchBookingPolicy.findUnique({ where: { branchId } });
    if (!booking)
        throw new AppError('BRANCH_BOOKING_POLICY_NOT_FOUND', 404);
    return { engineVersion: 1, module, branchId, version: 0, legacy: true, config: { isEnabled: true, cancellationAllowed: true, refundAllowed: true, minimumCancellationHours: booking.cancellationCutoffHours, restorationMinimumHours: booking.cancellationCutoffHours, lateCancellationOutcome: 'RESTORED', policyFormat: 'REFUND_TIERS_V1', boundaryMode: 'MINIMUM_INCLUSIVE', refundTiers: module === 'GROUP_REFUND' ? [{ minimumHoursAfterPurchase: 0, calculationType: 'PERCENTAGE', value: 100 }] : [{ minimumHoursBefore: booking.cancellationCutoffHours, calculationType: 'PERCENTAGE', value: 100 }], allowPartiallyUsedRefund: false, allowExpiredRefund: false, requireNoActiveAppointments: true } };
}
export const snapshotData = async (tx: Prisma.TransactionClient, branchId: string, module: 'SERVICE' | 'GROUP_CANCEL') => {
    const snapshot = await capturePolicy(tx, branchId, module);
    return { cancellationPolicySnapshot: snapshot as unknown as Prisma.InputJsonObject, cancellationPolicyVersion: snapshot.version };
};
export function purchaseExpired(purchase: {
    purchasedAt: Date | null;
    refundPolicySnapshot: Prisma.JsonValue | null;
}, now = new Date()) {
    const snapshot = purchase.refundPolicySnapshot;
    return isSnapshot(snapshot) && snapshot.packageValidDays != null && purchase.purchasedAt !== null && now.getTime() >= purchase.purchasedAt.getTime() + snapshot.packageValidDays * 86400000;
}
