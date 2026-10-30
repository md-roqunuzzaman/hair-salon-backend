import { Prisma } from '../../../../generated/prisma/client.js';
import { PolicySnapshot } from './policy.calculation.js';
export interface Confirmation {
    reason: string;
    idempotencyKey: string;
    previewToken: string;
}
export interface ExecutionSnapshot {
    engine: 'MERCHANT_V1';
    resourceType: 'SERVICE' | 'GROUP_REFUND';
    resourceId: string;
    policy: PolicySnapshot;
    evaluatedAt: string;
    refundableQuantity: number;
    funding?: { paymentId: string; provider: string; paidCents: number; remainingCents: number; amountCents: number }[];
    calculation: {
        eligibleCents: number;
        deductionCents: number;
        refundCents: number;
    };
}
export const executionSnapshot = (value: Prisma.JsonValue | null | undefined): ExecutionSnapshot | null => value && typeof value === 'object' && !Array.isArray(value) && (value as unknown as ExecutionSnapshot).engine === 'MERCHANT_V1' ? value as unknown as ExecutionSnapshot : null;
