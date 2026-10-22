import { Prisma, Role } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/app-error.js';
import { auditLogService } from '../auditLog/auditLog.service.js';
import { servicePolicyBody, groupRefundBody, groupCancellationBody } from './cancellation-refund.validation.js';
import { PolicyModule } from './policy.calculation.js';
export async function policyAccess(tx: Prisma.TransactionClient, branchId: string, userId: string, role: string) {
    if (![Role.BRAND_OWNER, Role.BRANCH_MANAGER].some(r => r === role))
        throw new AppError('POLICY_ACCESS_DENIED', 403);
    if (!await tx.branch.findUnique({ where: { id: branchId }, select: { id: true } }))
        throw new AppError('Branch not found', 404);
    if (role === Role.BRANCH_MANAGER && !await tx.branchManagerBranch.findUnique({ where: { userId_branchId: { userId, branchId } } }))
        throw new AppError('POLICY_ACCESS_DENIED', 403);
}
export async function getPolicy(branchId: string, module: PolicyModule, userId?: string, role?: string) {
    if (userId)
        await policyAccess(prisma, branchId, userId, role!);
    const policy = module === 'SERVICE' ? await prisma.branchCancellationPolicy.findUnique({ where: { branchId } }) : module === 'GROUP_REFUND' ? await prisma.groupPurchaseRefundPolicy.findUnique({ where: { branchId } }) : await prisma.groupPurchaseCancellationPolicy.findUnique({ where: { branchId } });
    if (!policy)
        throw new AppError('POLICY_NOT_CONFIGURED', 404);
    if (userId)
        return policy;
    const { id, createdAt, updatedAt, ...terms } = policy;
    return { ...terms, module, approvalRequired: true, currency: 'HKD' };
}
export async function savePolicy(branchId: string, module: PolicyModule, body: unknown, userId: string, role: string) {
    const schema = module === 'SERVICE' ? servicePolicyBody : module === 'GROUP_REFUND' ? groupRefundBody : groupCancellationBody;
    const payload = schema.parse(body);
    return prisma.$transaction(async (tx) => {
        await policyAccess(tx, branchId, userId, role);
        await tx.$queryRaw `SELECT "id" FROM "Branch" WHERE "id"=${branchId} FOR UPDATE`;
        const { expectedVersion, ...input } = payload;
        let result;
        const check = (old: {
            version: number;
        } | null) => { if (old && (expectedVersion === undefined || expectedVersion !== old.version) || !old && expectedVersion !== undefined && expectedVersion !== 0)
            throw new AppError('POLICY_VERSION_CONFLICT', 409); };
        if (module === 'SERVICE') {
            const p = servicePolicyBody.parse(body), old = await tx.branchCancellationPolicy.findUnique({ where: { branchId } });
            check(old);
            const data = { isEnabled: p.isEnabled, cancellationAllowed: p.cancellationAllowed, refundAllowed: p.refundAllowed, minimumCancellationHours: p.minimumCancellationHours, nonRefundable: p.nonRefundable, policyFormat: 'DEDUCTION_V2', refundTiers: p.deductionTiers as Prisma.InputJsonArray };
            result = old ? await tx.branchCancellationPolicy.update({ where: { branchId }, data: { ...data, version: { increment: 1 } } }) : await tx.branchCancellationPolicy.create({ data: { branchId, ...data } });
        }
        else if (module === 'GROUP_REFUND') {
            const p = groupRefundBody.parse(body), old = await tx.groupPurchaseRefundPolicy.findUnique({ where: { branchId } });
            check(old);
            const data = { isEnabled: p.isEnabled, refundAllowed: p.refundAllowed, allowPartiallyUsedRefund: p.allowPartiallyUsedRefund, allowExpiredRefund: p.allowExpiredRefund, requireNoActiveAppointments: p.requireNoActiveAppointments, policyFormat: p.deductionTiers ? 'DEDUCTION_V2' : 'REFUND_TIERS_V1', boundaryMode: 'UPPER_INCLUSIVE', refundTiers: (p.deductionTiers ?? p.refundTiers!.map(t => ({ minimumHoursAfterPurchase: t.minimumHoursAfterPurchase, calculationType: 'PERCENTAGE', value: t.refundPercentage }))) as Prisma.InputJsonArray };
            result = old ? await tx.groupPurchaseRefundPolicy.update({ where: { branchId }, data: { ...data, version: { increment: 1 } } }) : await tx.groupPurchaseRefundPolicy.create({ data: { branchId, ...data } });
        }
        else {
            const p = groupCancellationBody.parse(body), old = await tx.groupPurchaseCancellationPolicy.findUnique({ where: { branchId } });
            check(old);
            const { expectedVersion, ...data } = p;
            result = old ? await tx.groupPurchaseCancellationPolicy.update({ where: { branchId }, data: { ...data, version: { increment: 1 } } }) : await tx.groupPurchaseCancellationPolicy.create({ data: { branchId, ...data } });
        }
        await auditLogService.createAuditLog({ userId, action: 'MERCHANT_POLICY_UPDATED', entityType: 'BRANCH', entityId: branchId, metadata: { module, version: result.version } }, tx);
        return result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
