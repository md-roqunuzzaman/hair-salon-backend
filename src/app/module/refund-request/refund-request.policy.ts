import {
  PaymentPurpose,
  PaymentProvider,
  PaymentStatus,
} from "../../../../generated/prisma/client.js";

import { AppError } from "../../utils/app-error.js";

interface IRefundEligibilityInput {
  paymentStatus: PaymentStatus;
  paymentProvider: PaymentProvider;
  paymentPurpose: PaymentPurpose;
  paymentAmount: number;
  alreadyRefunded: number;
}

export const calculateRefundEligibility = ({
  paymentStatus,
  paymentProvider,
  paymentPurpose,
  paymentAmount,
  alreadyRefunded,
}: IRefundEligibilityInput) => {
  // 1. Validate payment status
  if (
    paymentStatus !== PaymentStatus.PAID &&
    paymentStatus !== PaymentStatus.PARTIALLY_REFUNDED
  ) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  // 2. Only Stripe payments are refundable
  if (paymentProvider !== PaymentProvider.STRIPE) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  // 3. Supported payment purposes
  if (
    paymentPurpose !== PaymentPurpose.APPOINTMENT &&
    paymentPurpose !== PaymentPurpose.APPOINTMENT_DEPOSIT &&
    paymentPurpose !== PaymentPurpose.GROUP_PURCHASE
  ) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  // 4. Calculate remaining refundable balance
  const paymentCents = Math.round(paymentAmount * 100);
  const refundedCents = Math.round(alreadyRefunded * 100);

  const remainingCents = paymentCents - refundedCents;

  if (remainingCents <= 0) {
    throw new AppError("NO_REFUNDABLE_BALANCE", 409);
  }

  return {
    eligible: true,
    refundableAmount: remainingCents / 100,
  };
};

interface IAppointmentRefundPolicyInput {
  appointmentDateTime: Date;
  cancellationCutoffHours: number;
  appointmentStatus: string;
}

export const validateAppointmentRefundPolicy = ({
  appointmentDateTime,
  cancellationCutoffHours,
  appointmentStatus,
}: IAppointmentRefundPolicyInput) => {
  // 1. Validate appointment status

  if (appointmentStatus !== "RESERVED" && appointmentStatus !== "CONFIRMED") {
    throw new AppError("APPOINTMENT_REFUND_NOT_ALLOWED", 409);
  }

  // 2. Calculate cancellation deadline

  if (
    !Number.isFinite(cancellationCutoffHours) ||
    cancellationCutoffHours < 0 ||
    Number.isNaN(appointmentDateTime.getTime())
  ) {
    throw new AppError("INVALID_CANCELLATION_POLICY", 409);
  }

  const cutoffMs = cancellationCutoffHours * 60 * 60 * 1000;

  const cancellationDeadline = new Date(
    appointmentDateTime.getTime() - cutoffMs,
  );

  // 3. Check cutoff

  if (new Date() >= cancellationDeadline) {
    throw new AppError("CANCELLATION_REFUND_DEADLINE_PASSED", 422);
  }

  return {
    eligible: true,
    cancellationDeadline,
  };
};
