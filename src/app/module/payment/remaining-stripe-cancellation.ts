import Stripe from "stripe";

import { stripe } from "../../lib/stripe.js";
import { AppError } from "../../utils/app-error.js";

export const cancelRemainingStripeIntent = async (
  providerPaymentId: string,
): Promise<Stripe.PaymentIntent> => {
  // 1. Retrieve current Stripe status.
  const intent = await stripe.paymentIntents.retrieve(providerPaymentId);

  // 2. Already canceled: safe terminal state.
  if (intent.status === "canceled") {
    return intent;
  }

  // 3. Already paid: do not cancel.
  if (intent.status === "succeeded") {
    throw new AppError("STRIPE_REMAINING_PAYMENT_ALREADY_SUCCEEDED", 409);
  }

  // 4. Processing: settlement may still complete.
  if (intent.status === "processing") {
    throw new AppError("STRIPE_REMAINING_PAYMENT_PROCESSING", 409);
  }

  // 5. Cancel only supported states.
  const cancellableStatuses = [
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
  ];

  if (!cancellableStatuses.includes(intent.status)) {
    throw new AppError("STRIPE_REMAINING_PAYMENT_NOT_CANCELLABLE", 409);
  }

  // 6. Request Stripe cancellation.
  const canceled = await stripe.paymentIntents.cancel(providerPaymentId);

  // 7. Require confirmed terminal cancellation.
  if (canceled.status !== "canceled") {
    throw new AppError(
      "STRIPE_REMAINING_PAYMENT_CANCELLATION_UNCONFIRMED",
      409,
    );
  }

  return canceled;
};
