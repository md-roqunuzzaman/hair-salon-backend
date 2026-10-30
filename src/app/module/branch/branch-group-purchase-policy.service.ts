import { Prisma, Role } from '../../../../generated/prisma/client.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../utils/app-error.js';
import { auditLogService } from '../auditLog/auditLog.service.js';
import type { IUpdateGroupPurchaseCancellationPolicyPayload } from './branch-group-purchase-policy.interface.js';

const assertBranchPolicyAccess = async (branchId: string, userId: string, role: Role) => {
  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) throw new AppError('You are not allowed to manage group purchase policies', 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)) throw new AppError('Invalid branch ID', 400);
  if (!await prisma.branch.findUnique({where:{id:branchId},select:{id:true}})) throw new AppError('Branch not found',404);
  if (role === Role.BRANCH_MANAGER && !await prisma.branchManagerBranch.findUnique({where:{userId_branchId:{userId,branchId}},select:{userId:true}})) throw new AppError('You are not allowed to access policies for this branch',403);
};
type GroupPurchaseRefundTier = {
  minimumMinutesAfterPurchase: number;
  calculationType: "PERCENTAGE" | "FIXED";
  value: number;
};

type UpdateGroupPurchaseRefundPolicyPayload = {
  isEnabled: boolean;
  refundAllowed: boolean;
  refundTiers: GroupPurchaseRefundTier[];
  allowPartiallyUsedRefund: boolean;
  allowExpiredRefund: boolean;
  requireNoActiveAppointments: boolean;
};

const updateGroupPurchaseRefundPolicy = async (
  branchId: string,
  payload: UpdateGroupPurchaseRefundPolicyPayload,
  userId: string,
  role: Role,
) => {
  await assertBranchPolicyAccess(branchId, userId, role);
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================



  // =====================================================
  // 2. VALIDATE BRANCH ID
  // =====================================================

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(branchId)) {
    throw new AppError("Invalid branch ID", 400);
  }

  // =====================================================
  // 3. CHECK BRANCH
  // =====================================================

  const branchData = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
    select: {
      id: true,
    },
  });

  if (!branchData) {
    throw new AppError("Branch not found", 404);
  }



  // =====================================================
  // 4. VALIDATE POLICY
  // =====================================================

  if (
    typeof payload.isEnabled !== "boolean" ||
    typeof payload.refundAllowed !== "boolean" ||
    typeof payload.allowPartiallyUsedRefund !== "boolean" ||
    typeof payload.allowExpiredRefund !== "boolean" ||
    typeof payload.requireNoActiveAppointments !== "boolean"
  ) {
    throw new AppError("Invalid refund policy configuration", 400);
  }

  if (!Array.isArray(payload.refundTiers) || payload.refundTiers.length === 0) {
    throw new AppError("At least one refund tier is required", 400);
  }

  const seenHours = new Set<number>();

  for (const tier of payload.refundTiers) {
    if (
      !Number.isInteger(tier.minimumMinutesAfterPurchase) ||
      tier.minimumMinutesAfterPurchase < 0
    ) {
      throw new AppError(
        "Refund tier minutes must be non-negative integers",
        400,
      );
    }

    if (seenHours.has(tier.minimumMinutesAfterPurchase)) {
      throw new AppError("Duplicate refund tier minutes", 400);
    }

    seenHours.add(tier.minimumMinutesAfterPurchase);

    if (
      tier.calculationType !== "PERCENTAGE" &&
      tier.calculationType !== "FIXED"
    ) {
      throw new AppError("Invalid refund calculation type", 400);
    }

    if (!Number.isFinite(tier.value) || tier.value < 0) {
      throw new AppError("Invalid refund tier value", 400);
    }

    if (tier.calculationType === "PERCENTAGE" && tier.value > 100) {
      throw new AppError("Refund percentage cannot exceed 100", 400);
    }

    if (
      tier.calculationType === "FIXED" &&
      !Number.isInteger(Math.round(tier.value * 100))
    ) {
      throw new AppError("Invalid fixed refund amount", 400);
    }

    if (
      tier.calculationType === "FIXED" &&
      Math.abs(tier.value * 100 - Math.round(tier.value * 100)) > 0.000001
    ) {
      throw new AppError(
        "Fixed refund amount supports at most two decimal places",
        400,
      );
    }
  }

  // A tier beginning at zero ensures the policy covers
  // the entire period after purchase.
  if (!seenHours.has(0)) {
    throw new AppError(
      "Refund tiers must include a tier starting at 0 minutes",
      400,
    );
  }

  // =====================================================
  // 5. NORMALIZE REFUND TIERS
  // =====================================================

  const refundTiers = [...payload.refundTiers].sort(
    (a, b) => b.minimumMinutesAfterPurchase - a.minimumMinutesAfterPurchase,
  );

  // =====================================================
  // 6. CREATE OR UPDATE WITH VERSION CONTROL
  // =====================================================

  return prisma.$transaction(async (tx) => {
    const existing = await tx.groupPurchaseRefundPolicy.findUnique({
      where: {
        branchId,
      },
    });

    const policyData = {
      policyFormat: 'REFUND_TIERS_V1',
      boundaryMode: 'MINIMUM_INCLUSIVE',
      isEnabled: payload.isEnabled,
      refundAllowed: payload.refundAllowed,
      refundTiers: refundTiers as Prisma.InputJsonArray,
      allowPartiallyUsedRefund: payload.allowPartiallyUsedRefund,
      allowExpiredRefund: payload.allowExpiredRefund,
      requireNoActiveAppointments: payload.requireNoActiveAppointments,
    };

    if (existing) {
      const updated = await tx.groupPurchaseRefundPolicy.updateMany({
        where: {
          branchId,
          version: existing.version,
        },
        data: {
          ...policyData,
          version: {
            increment: 1,
          },
        },
      });

      if (updated.count !== 1) {
        throw new AppError(
          "Refund policy was modified by another request. Please retry.",
          409,
        );
      }
    } else {
      await tx.groupPurchaseRefundPolicy.create({
        data: {
          branchId,
          ...policyData,
          version: 1,
        },
      });
    }

    const policy = await tx.groupPurchaseRefundPolicy.findUniqueOrThrow({
      where: {
        branchId,
      },
    });

    // ===================================================
    // 7. AUDIT LOG
    // ===================================================

    await auditLogService.createAuditLog(
      {
        userId,
        action: "GROUP_PURCHASE_REFUND_POLICY_UPDATED",
        entityType: "BRANCH",
        entityId: branchId,
        metadata: {
          previousVersion: existing?.version ?? null,
          newVersion: policy.version,
          isEnabled: policy.isEnabled,
          refundAllowed: policy.refundAllowed,
          allowPartiallyUsedRefund: policy.allowPartiallyUsedRefund,
          allowExpiredRefund: policy.allowExpiredRefund,
          requireNoActiveAppointments: policy.requireNoActiveAppointments,
        },
      },
      tx,
    );

    return policy;
  });
};

// =====================================================
// GET GROUP PURCHASE REFUND POLICY
// =====================================================

const getGroupPurchaseRefundPolicy = async (branchId: string, userId: string, role: Role) => {
  await assertBranchPolicyAccess(branchId, userId, role);
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(branchId)) {
    throw new AppError("Invalid branch ID", 400);
  }

  const branchData = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },
    select: {
      id: true,
    },
  });

  if (!branchData) {
    throw new AppError("Branch not found", 404);
  }



  const policy = await prisma.groupPurchaseRefundPolicy.findUnique({
    where: {
      branchId,
    },
  });

  if (!policy) {
    throw new AppError(
      "Group purchase refund policy has not been configured",
      404,
    );
  }

  return policy;
};
const updateGroupPurchaseCancellationPolicy = async (
  branchId: string,
  payload: IUpdateGroupPurchaseCancellationPolicyPayload,
  userId: string,
  role: Role,
) => {
  await assertBranchPolicyAccess(branchId, userId, role);
  // =====================================================
  // 1. AUTHORIZATION
  // =====================================================



  // =====================================================
  // 2. VALIDATE BRANCH ID
  // =====================================================

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(branchId)) {
    throw new AppError("Invalid branch ID", 400);
  }

  // =====================================================
  // 3. VALIDATE PAYLOAD
  // =====================================================

  if (
    typeof payload.isEnabled !== "boolean" ||
    typeof payload.cancellationAllowed !== "boolean"
  ) {
    throw new AppError("Invalid cancellation policy configuration", 400);
  }

  if (
    !Number.isInteger(payload.minimumCancellationMinutes) ||
    payload.minimumCancellationMinutes < 0
  ) {
    throw new AppError(
      "Minimum cancellation minutes must be a non-negative integer",
      400,
    );
  }

  if (
    !Number.isInteger(payload.restorationMinimumMinutes) ||
    payload.restorationMinimumMinutes < 0
  ) {
    throw new AppError(
      "Restoration minimum minutes must be a non-negative integer",
      400,
    );
  }

  if (payload.restorationMinimumMinutes < payload.minimumCancellationMinutes) {
    throw new AppError(
      "Restoration minimum minutes cannot be less than minimum cancellation minutes",
      400,
    );
  }

  if (
    payload.lateCancellationOutcome !== "RESTORED" &&
    payload.lateCancellationOutcome !== "FORFEITED"
  ) {
    throw new AppError("Invalid late cancellation outcome", 400);
  }

  // =====================================================
  // 4. TRANSACTION
  // =====================================================

  return prisma.$transaction(async (tx) => {
    const branchData = await tx.branch.findUnique({
      where: { id: branchId },
      select: {
        id: true,
      },
    });

    if (!branchData) {
      throw new AppError("Branch not found", 404);
    }

    const existing = await tx.groupPurchaseCancellationPolicy.findUnique({ where: { branchId } });
    const policyData = {
      isEnabled: payload.isEnabled,
      cancellationAllowed: payload.cancellationAllowed,
      minimumCancellationMinutes: payload.minimumCancellationMinutes,
      restorationMinimumMinutes: payload.restorationMinimumMinutes,
      lateCancellationOutcome: payload.lateCancellationOutcome,
    };
    if (existing) {
      const changed = await tx.groupPurchaseCancellationPolicy.updateMany({
        where: { branchId, version: existing.version },
        data: { ...policyData, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new AppError("Cancellation policy was modified by another request. Please retry.", 409);
    } else {
      await tx.groupPurchaseCancellationPolicy.create({ data: { branchId, ...policyData, version: 1 } });
    }
    const policy = await tx.groupPurchaseCancellationPolicy.findUniqueOrThrow({ where: { branchId } });
    await auditLogService.createAuditLog({
      userId, action: "GROUP_PURCHASE_CANCELLATION_POLICY_UPDATED", entityType: "BRANCH", entityId: branchId,
      metadata: { previousVersion: existing?.version ?? null, newVersion: policy.version, ...policyData },
    }, tx);
    return policy;
  }
  );
};

// =====================================================
// GET GROUP PURCHASE CANCELLATION POLICY
// =====================================================

const getGroupPurchaseCancellationPolicy = async (branchId: string, userId: string, role: Role) => {
  await assertBranchPolicyAccess(branchId, userId, role);
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidRegex.test(branchId)) {
    throw new AppError("Invalid branch ID", 400);
  }

  const branchData = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
    },
  });

  if (!branchData) {
    throw new AppError("Branch not found", 404);
  }



  const policy = await prisma.groupPurchaseCancellationPolicy.findUnique({
    where: { branchId },
  });

  if (!policy) {
    throw new AppError(
      "Group purchase cancellation policy has not been configured",
      404,
    );
  }

  return policy;
};

export const branchGroupPurchasePolicyService = { updateGroupPurchaseRefundPolicy, getGroupPurchaseRefundPolicy, updateGroupPurchaseCancellationPolicy, getGroupPurchaseCancellationPolicy };
