import { z } from 'zod';
const value = z.number().finite().nonnegative();
const deduction = z.object({ calculationType: z.enum(['PERCENTAGE', 'FIXED']), deductionValue: value }).strict().superRefine((t, c) => {
    if (t.calculationType === 'PERCENTAGE' && t.deductionValue > 100)
        c.addIssue({ code: 'custom', message: 'Deduction percentage cannot exceed 100' });
    if (t.calculationType === 'FIXED' && Math.abs(t.deductionValue * 100 - Math.round(t.deductionValue * 100)) > 1e-6)
        c.addIssue({ code: 'custom', message: 'Fixed deduction supports two decimal places' });
});
const tiers = (hourKey: string, minimum: (body: any) => number) => (body: any, ctx: z.RefinementCtx) => {
    const list = body.deductionTiers ?? body.refundTiers;
    if (!list?.length) {
        ctx.addIssue({ code: 'custom', message: 'At least one tier required' });
        return;
    }
    const hours = list.map((t: any) => t[hourKey]);
    if (new Set(hours).size !== hours.length || !hours.includes(minimum(body)) || hours.some((h: number) => h < minimum(body)))
        ctx.addIssue({ code: 'custom', message: 'Unique tiers must cover the minimum eligible time' });
};
const serviceTier = deduction.safeExtend({ minimumMinutesBeforeAppointment: z.number().int().nonnegative() });
const groupTier = deduction.safeExtend({ minimumMinutesAfterPurchase: z.number().int().nonnegative() });
export const servicePolicyBody = z.object({ isEnabled: z.boolean(), cancellationAllowed: z.boolean(), refundAllowed: z.boolean(), minimumCancellationMinutes: z.number().int().nonnegative(), nonRefundable: z.boolean(), deductionTiers: z.array(serviceTier).min(1), expectedVersion: z.number().int().nonnegative().optional() }).strict().superRefine(tiers('minimumMinutesBeforeAppointment', b => b.minimumCancellationMinutes));
export const groupRefundBody = z.object({ isEnabled: z.boolean(), refundAllowed: z.boolean(), allowPartiallyUsedRefund: z.boolean(), allowExpiredRefund: z.boolean(), requireNoActiveAppointments: z.boolean(), deductionTiers: z.array(groupTier).min(1).optional(), refundTiers: z.array(z.object({ minimumMinutesAfterPurchase: z.number().int().nonnegative(), refundPercentage: value.max(100) }).strict()).min(1).optional(), expectedVersion: z.number().int().nonnegative().optional() }).strict().superRefine((b, c) => { if (!!b.refundTiers === !!b.deductionTiers)
    c.addIssue({ code: 'custom', message: 'Provide exactly one of deductionTiers or refundTiers' }); tiers('minimumMinutesAfterPurchase', () => 0)(b, c); });
export const groupCancellationBody = z.object({ isEnabled: z.boolean(), cancellationAllowed: z.boolean(), minimumCancellationMinutes: z.number().int().nonnegative(), restorationMinimumMinutes: z.number().int().nonnegative(), lateCancellationOutcome: z.enum(['RESTORED', 'FORFEITED']), expectedVersion: z.number().int().nonnegative().optional() }).strict().refine(b => b.restorationMinimumMinutes >= b.minimumCancellationMinutes, 'Restoration threshold must cover minimum cancellation minutes');
export const confirmationBody = z.object({ reason: z.string().trim().min(2).max(500), idempotencyKey: z.string().trim().min(8).max(128), previewToken: z.string().min(16) }).strict();
