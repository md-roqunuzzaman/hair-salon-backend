import type { EntitlementCancellationOutcome } from "../../../../generated/prisma/client.js";

export interface IUpdateGroupPurchaseCancellationPolicyPayload {
  isEnabled: boolean;
  cancellationAllowed: boolean;
  minimumCancellationMinutes: number;
  restorationMinimumMinutes: number;
  lateCancellationOutcome: EntitlementCancellationOutcome;
}
