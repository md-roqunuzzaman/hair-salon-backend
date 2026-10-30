import { Prisma } from '../../../../generated/prisma/client.js';
import { AppError } from '../../utils/app-error.js';
import { policyTimeMinutes } from './policy-time.js';
export type PolicyModule = 'SERVICE' | 'GROUP_REFUND' | 'GROUP_CANCEL';
export interface PolicySnapshot {
    engineVersion: 1;
    module: PolicyModule;
    branchId: string;
    version: number;
    config: Record<string, any>;
    legacy?: boolean;
    packageValidDays?: number | null;
}
export const isSnapshot = (value: unknown): value is PolicySnapshot => !!value && typeof value === 'object' && (value as PolicySnapshot).engineVersion === 1;
export const cents = (value: Prisma.Decimal | number | string) => {
    const amount = new Prisma.Decimal(value);
    if (!amount.isFinite() || amount.lt(0) || !amount.mul(100).isInteger() || !Number.isSafeInteger(amount.mul(100).toNumber()))
        throw new AppError('INVALID_POLICY_AMOUNT', 409);
    return amount.mul(100).toNumber();
};
export const money = (value: number) => new Prisma.Decimal(value).div(100).toNumber();
export const appointmentTime = (date: Date, time: string) => new Date(`${date.toISOString().slice(0, 10)}T${time}:00+08:00`);
const rounded = (value: Prisma.Decimal) => value.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).toNumber();
export function evaluatePolicy(snapshot: PolicySnapshot, eligibleCents: number, elapsedMs: number) {
    const p = policyTimeMinutes(snapshot.config);
    if (!Number.isSafeInteger(eligibleCents) || eligibleCents < 0 || !Number.isFinite(elapsedMs))
        throw new AppError('INVALID_POLICY_CALCULATION', 409);
    let allowed = true, reason: string | null = null, tier: any = null;
    if (snapshot.module !== 'GROUP_REFUND') {
        const cutoff = p.minimumCancellationMinutes * 60000;
        if (!p.cancellationAllowed) {
            allowed = false;
            reason = 'CANCELLATION_DISABLED';
        }
        else if (elapsedMs < cutoff || (snapshot.legacy && elapsedMs === cutoff)) {
            allowed = false;
            reason = 'CANCELLATION_DEADLINE_PASSED';
        }
    }
    else if (!p.refundAllowed) {
        allowed = false;
        reason = 'REFUNDS_DISABLED';
    }
    if (snapshot.module === 'GROUP_CANCEL') {
        return { allowed, reason, entitlementOutcome: elapsedMs >= p.restorationMinimumMinutes * 60000 ? 'RESTORED' as const : p.lateCancellationOutcome as 'RESTORED' | 'FORFEITED', deductionCents: 0, refundCents: 0, tier: null };
    }
    if (!allowed)
        return { allowed, reason, tier: null, deductionCents: 0, refundCents: 0, entitlementOutcome: null };
    const tiers = [...(p.refundTiers ?? [])].sort((a, b) => (b.minimumMinutesAfterPurchase ?? b.minimumMinutesBeforeAppointment ?? b.minimumMinutesBefore) - (a.minimumMinutesAfterPurchase ?? a.minimumMinutesBeforeAppointment ?? a.minimumMinutesBefore));
    if (snapshot.module === 'GROUP_REFUND')
        tier = tiers.find(t => t.minimumMinutesAfterPurchase === 0 || (p.boundaryMode === 'UPPER_INCLUSIVE' ? elapsedMs > t.minimumMinutesAfterPurchase * 60000 : elapsedMs >= t.minimumMinutesAfterPurchase * 60000));
    else
        tier = tiers.find(t => elapsedMs >= (t.minimumMinutesBeforeAppointment ?? t.minimumMinutesBefore) * 60000);
    if (!tier)
        throw new AppError('POLICY_TIER_GAP', 409);
    const isDeduction = p.policyFormat === 'DEDUCTION_V2';
    const value = tier.deductionValue ?? tier.value ?? tier.refundPercentage;
    if (!Number.isFinite(value) || value < 0 || !['PERCENTAGE', 'FIXED'].includes(tier.calculationType ?? 'PERCENTAGE'))
        throw new AppError('INVALID_POLICY_TIER', 409);
    if ((tier.calculationType ?? 'PERCENTAGE') === 'PERCENTAGE' && value > 100)
        throw new AppError('INVALID_POLICY_TIER', 409);
    const calculated = (tier.calculationType ?? 'PERCENTAGE') === 'FIXED' ? cents(value) : rounded(new Prisma.Decimal(eligibleCents).mul(value).div(100));
    let deductionCents = isDeduction ? Math.min(eligibleCents, calculated) : eligibleCents - Math.min(eligibleCents, calculated);
    if (p.refundAllowed === false || p.nonRefundable)
        deductionCents = eligibleCents;
    return { allowed, reason, tier, deductionCents, refundCents: allowed ? eligibleCents - deductionCents : 0, entitlementOutcome: null };
}
