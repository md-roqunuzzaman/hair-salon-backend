import type { EntitlementCancellationOutcome } from "../../../../generated/prisma/client.js";

export interface IUpdateGroupPurchaseCancellationPolicyPayload {
  isEnabled: boolean;
  cancellationAllowed: boolean;
  minimumCancellationHours: number;
  restorationMinimumHours: number;
  lateCancellationOutcome: EntitlementCancellationOutcome;
}
