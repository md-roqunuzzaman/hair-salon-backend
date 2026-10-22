import { z } from 'zod';
const groupPurchaseRefundTierValidationSchema = z
  .object({
    minimumHoursAfterPurchase: z.number().int().min(0),

    calculationType: z.enum(["PERCENTAGE", "FIXED"]),

    value: z.number().finite().nonnegative(),
  })
  .strict()
  .superRefine((tier, ctx) => {
    if (tier.calculationType === "PERCENTAGE" && tier.value > 100) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Refund percentage cannot exceed 100",
      });
    }

    if (
      tier.calculationType === "FIXED" &&
      Math.abs(tier.value * 100 - Math.round(tier.value * 100)) > 0.000001
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "Fixed refund amount supports at most two decimal places",
      });
    }
  });

// =====================================================
// UPDATE GROUP PURCHASE REFUND POLICY VALIDATION
// =====================================================

const updateGroupPurchaseRefundPolicyValidationSchema = z.object({
  body: z
    .object({
      isEnabled: z.boolean(),

      refundAllowed: z.boolean(),

      refundTiers: z
        .array(groupPurchaseRefundTierValidationSchema)
        .min(1, "At least one refund tier is required"),

      allowPartiallyUsedRefund: z.boolean(),

      allowExpiredRefund: z.boolean(),

      requireNoActiveAppointments: z.boolean(),
    })
    .strict()
    .superRefine((policy, ctx) => {
      const seenHours = new Set<number>();

      for (const [index, tier] of policy.refundTiers.entries()) {
        if (seenHours.has(tier.minimumHoursAfterPurchase)) {
          ctx.addIssue({
            code: "custom",
            path: ["refundTiers", index, "minimumHoursAfterPurchase"],
            message: "Duplicate refund tier hours",
          });
        }

        seenHours.add(tier.minimumHoursAfterPurchase);
      }

      if (!seenHours.has(0)) {
        ctx.addIssue({
          code: "custom",
          path: ["refundTiers"],
          message: "Refund tiers must include a tier starting at 0 hours",
        });
      }
    }),
});
// =====================================================
// GROUP PURCHASE CANCELLATION POLICY
// =====================================================

const updateGroupPurchaseCancellationPolicyValidationSchema = z.object({
  body: z
    .object({
      isEnabled: z.boolean(),

      cancellationAllowed: z.boolean(),

      minimumCancellationHours: z.number().int().min(0),

      restorationMinimumHours: z.number().int().min(0),

      lateCancellationOutcome: z.enum(["RESTORED", "FORFEITED"]),
    })
    .strict()
    .superRefine((body, ctx) => {
      if (body.restorationMinimumHours < body.minimumCancellationHours) {
        ctx.addIssue({
          code: "custom",
          path: ["restorationMinimumHours"],
          message:
            "Restoration minimum hours cannot be less than minimum cancellation hours",
        });
      }
    }),
});
// =====================================================
// 9. EXPORT
// =====================================================


export const branchGroupPurchasePolicyValidation = { updateGroupPurchaseRefundPolicyValidationSchema, updateGroupPurchaseCancellationPolicyValidationSchema };
