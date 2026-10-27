import { isSnapshot } from "../cancellation-refund/policy.calculation.js";
import { validatePolicyRefund } from "../cancellation-refund/policy-refund.execution.js";
import {
  cancelWithPolicy,
  previewAppointment,
  previewGroupRefund,
  requestGroupRefund,
} from "../cancellation-refund/cancellation-refund.service.js";
import {
  PaymentProvider,
  PaymentPurpose,
  Prisma,
  RefundRequestStatus,
  RefundStatus,
  Role,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import {
  calculateRefundEligibility,
  validateAppointmentRefundPolicy,
} from "./refund-request.policy.js";

import type {
  ICreateRefundRequestPayload,
  ICreateRefundRequestResponse,
  IGetRefundRequestsQuery,
  IReviewRefundRequestPayload,
} from "./refund-request.interface.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { notificationService } from "../notification/notification.service.js";

const createHongKongDateTime = (date: Date, time: string): Date => {
  const datePart = date.toISOString().slice(0, 10);

  return new Date(`${datePart}T${time}:00+08:00`);
};

const createRefundRequest = async (
  customerId: string,
  payload: ICreateRefundRequestPayload,
): Promise<ICreateRefundRequestResponse> => {
  // =====================================================
  // 1. FIND PAYMENT AND RELATED RECORDS
  // =====================================================

  const payment = await prisma.payment.findUnique({
    where: { id: payload.paymentId },

    include: {
      appointment: {
        include: {
          branch: {
            include: {
              bookingPolicy: true,
            },
          },
        },
      },

      groupPurchase: {
        include: {
          appointments: true,
        },
      },

      refunds: true,
    },
  });

  if (!payment) {
    throw new AppError("PAYMENT_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. VERIFY CUSTOMER OWNERSHIP
  // =====================================================

  if (payment.customerId !== customerId) {
    throw new AppError("REFUND_NOT_ALLOWED", 403);
  }

  const snap =
    payment.appointment?.cancellationPolicySnapshot ??
    payment.groupPurchase?.refundPolicySnapshot;
  if (isSnapshot(snap) && !snap.legacy) {
    let created;
    if (payment.appointment && !payment.appointment.groupPurchaseId) {
      const preview = await previewAppointment(
        payment.appointment.id,
        customerId,
      );
      if (preview.refund.refundAmount <= 0)
        throw new AppError("ZERO_REFUND_USE_CANCELLATION_ENDPOINT", 422);
      const result = (await cancelWithPolicy(
        payment.appointment.id,
        customerId,
        Role.CUSTOMER,
        {
          reason: payload.reason,
          idempotencyKey: "existing-refund-" + payment.id,
          previewToken: preview.previewToken,
        },
      )) as { refundRequestId: string };
      created = await prisma.refundRequest.findUniqueOrThrow({
        where: { id: result.refundRequestId },
      });
    } else if (payment.groupPurchase) {
      const preview = await previewGroupRefund(
        payment.groupPurchase.id,
        customerId,
      );
      created = await requestGroupRefund(payment.groupPurchase.id, customerId, {
        reason: payload.reason,
        idempotencyKey: "existing-refund-" + payment.id,
        previewToken: preview.previewToken,
      });
    } else throw new AppError("REFUND_NOT_ALLOWED", 409);
    return {
      id: created.id,
      paymentId: created.paymentId,
      amount: Number(created.amount),
      currency: payment.currency,
      status: "PENDING",
      createdAt: created.createdAt,
    };
  }

  // =====================================================
  // 3. VALIDATE PAYMENT PROVIDER
  // =====================================================

  const isStripe = payment.provider === PaymentProvider.STRIPE;
  const isWallet = payment.provider === PaymentProvider.WALLET;

  if (!isStripe && !isWallet) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  if (isStripe && !payment.providerPaymentId) {
    throw new AppError("REFUND_NOT_ALLOWED", 409);
  }

  // =====================================================
  // 4. VALIDATE PAYMENT PURPOSE AND LINKED RESOURCE
  // =====================================================

  if (
    (payment.purpose === PaymentPurpose.APPOINTMENT ||
      payment.purpose === PaymentPurpose.APPOINTMENT_DEPOSIT) &&
    !payment.appointment
  ) {
    throw new AppError("APPOINTMENT_NOT_FOUND", 404);
  }

  if (
    payment.purpose === PaymentPurpose.GROUP_PURCHASE &&
    !payment.groupPurchase
  ) {
    throw new AppError("GROUP_PURCHASE_NOT_FOUND", 404);
  }

  // =====================================================
  // 5. CALCULATE REFUND ELIGIBILITY
  // =====================================================

  const alreadyRefunded = payment.refunds
    .filter((refund) => refund.status === RefundStatus.SUCCEEDED)
    .reduce((sum, refund) => sum + Number(refund.amount), 0);

  const eligibility = calculateRefundEligibility({
    paymentStatus: payment.status,
    paymentProvider: payment.provider,
    paymentPurpose: payment.purpose,
    paymentAmount: Number(payment.amount),
    alreadyRefunded,
  });

  // =====================================================
  // 6. VALIDATE APPOINTMENT REFUND POLICY
  // =====================================================

  if (payment.appointment) {
    const appointment = payment.appointment;
    const policy = appointment.branch.bookingPolicy;

    if (!policy) {
      throw new AppError("BRANCH_BOOKING_POLICY_NOT_FOUND", 404);
    }

    const appointmentDateTime = createHongKongDateTime(
      appointment.date,
      appointment.startTime,
    );

    validateAppointmentRefundPolicy({
      appointmentDateTime,
      cancellationCutoffHours: policy.cancellationCutoffHours,
      appointmentStatus: appointment.appointmentStatus,
    });
  }

  // =====================================================
  // 7. VALIDATE GROUP PURCHASE ELIGIBILITY
  // =====================================================

  if (payment.groupPurchase) {
    const purchase = payment.groupPurchase;

    if (
      purchase.appointments.some(
        (appointment) =>
          appointment.appointmentStatus === "COMPLETED" ||
          appointment.appointmentStatus === "CONFIRMED",
      )
    ) {
      throw new AppError("GROUP_PURCHASE_REDEMPTION_REVIEW_REQUIRED", 409);
    }
  }

  // =====================================================
  // 8. PREVENT DUPLICATE ACTIVE REFUND REQUESTS
  // =====================================================

  const existingRequest = await prisma.refundRequest.findFirst({
    where: {
      paymentId: payment.id,
      status: {
        in: [
          RefundRequestStatus.PENDING,
          RefundRequestStatus.APPROVED,
          RefundRequestStatus.PROCESSING,
        ],
      },
    },
  });

  if (existingRequest) {
    throw new AppError("REFUND_REQUEST_ALREADY_EXISTS", 409);
  }

  // =====================================================
  // 9. BLOCK UNRESOLVED REFUNDS
  // =====================================================

  const unresolvedRefund = payment.refunds.some(
    (refund) => refund.status === RefundStatus.PENDING,
  );

  if (unresolvedRefund) {
    throw new AppError("REFUND_ALREADY_PENDING", 409);
  }

  // =====================================================
  // 10. VALIDATE REFUND REASON
  // =====================================================

  const reason = payload.reason?.trim();

  if (!reason) {
    throw new AppError("REFUND_REASON_REQUIRED", 400);
  }

  // =====================================================
  // 11. CREATE REFUND REQUEST + AUDIT LOG
  // =====================================================

  const refundRequest = await prisma.$transaction(
    async (tx) => {
      const created = await tx.refundRequest.create({
        data: {
          customerId,
          paymentId: payment.id,
          amount: eligibility.refundableAmount,
          reason,
          status: RefundRequestStatus.PENDING,
        },
      });

      await auditLogService.createAuditLog(
        {
          userId: customerId,
          action: "REFUND_REQUEST_CREATED",
          entityType: "REFUND_REQUEST",
          entityId: created.id,
          metadata: {
            paymentId: payment.id,
            provider: payment.provider,
            purpose: payment.purpose,
            amount: Number(created.amount),
            currency: payment.currency,
            status: RefundRequestStatus.PENDING,
          },
        },
        tx,
      );

      return created;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10000,
    },
  );

  // =====================================================
  // 12. RESPONSE
  // =====================================================

  return {
    id: refundRequest.id,
    paymentId: refundRequest.paymentId,
    amount: Number(refundRequest.amount),
    currency: payment.currency,
    status: "PENDING",
    createdAt: refundRequest.createdAt,
  };
};

const getMyRefundRequests = async (customerId: string) => {
  const requests = await prisma.refundRequest.findMany({
    where: {
      customerId,
    },

    select: {
      id: true,
      paymentId: true,
      amount: true,
      reason: true,
      status: true,
      reviewedAt: true,
      reviewNote: true,
      createdAt: true,

      payment: {
        select: {
          orderNumber: true,
          currency: true,
          purpose: true,
          appointmentId: true,
          groupPurchaseId: true,
        },
      },
    },

    orderBy: {
      createdAt: "desc",
    },
  });

  return requests.map((request) => ({
    id: request.id,

    paymentId: request.paymentId,

    // Customer-friendly order number
    orderNumber: request.payment.orderNumber,

    amount: Number(request.amount),

    currency: request.payment.currency,

    purpose: request.payment.purpose,

    appointmentId: request.payment.appointmentId,

    groupPurchaseId: request.payment.groupPurchaseId,

    reason: request.reason,

    status: request.status,

    reviewedAt: request.reviewedAt,

    reviewNote: request.reviewNote,

    createdAt: request.createdAt,
  }));
};

const getRefundRequests = async (query: IGetRefundRequestsQuery) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const skip = (page - 1) * limit;

  const where = {
    ...(query.status ? { status: query.status } : {}),
  };

  const [requests, total] = await prisma.$transaction([
    prisma.refundRequest.findMany({
      where,

      select: {
        id: true,
        customerId: true,
        paymentId: true,
        amount: true,
        reason: true,
        status: true,
        reviewedBy: true,
        reviewedAt: true,
        reviewNote: true,
        createdAt: true,

        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },

        payment: {
          select: {
            amount: true,
            currency: true,
            purpose: true,
            status: true,
            appointmentId: true,
            groupPurchaseId: true,
          },
        },
      },

      orderBy: [{ createdAt: "desc" }, { id: "desc" }],

      skip,
      take: limit,
    }),

    prisma.refundRequest.count({ where }),
  ]);

  return {
    items: requests.map((request) => ({
      id: request.id,
      customerId: request.customerId,
      paymentId: request.paymentId,
      amount: Number(request.amount),
      reason: request.reason,
      status: request.status,
      reviewedBy: request.reviewedBy,
      reviewedAt: request.reviewedAt,
      reviewNote: request.reviewNote,
      createdAt: request.createdAt,

      customer: request.customer,

      payment: {
        amount: Number(request.payment.amount),
        currency: request.payment.currency,
        purpose: request.payment.purpose,
        status: request.payment.status,
        appointmentId: request.payment.appointmentId,
        groupPurchaseId: request.payment.groupPurchaseId,
      },
    })),

    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

const reviewRefundRequest = async (
  requestId: string,
  reviewerId: string,
  payload: IReviewRefundRequestPayload,
) => {
  const decision = payload.decision;

  if (decision !== "APPROVE" && decision !== "REJECT") {
    throw new AppError("INVALID_REVIEW_DECISION", 400);
  }

  if (decision === "REJECT" && !payload.reviewNote?.trim()) {
    throw new AppError("REVIEW_NOTE_REQUIRED", 400);
  }

  return prisma.$transaction(
    async (tx) => {
      // =====================================================
      // 1. FETCH REFUND REQUEST
      // =====================================================

      const request = await tx.refundRequest.findUnique({
        where: {
          id: requestId,
        },

        include: {
          payment: {
            include: {
              refunds: true,

              appointment: {
                include: {
                  branch: {
                    include: {
                      bookingPolicy: true,
                    },
                  },
                },
              },

              groupPurchase: {
                include: {
                  appointments: true,
                },
              },
            },
          },
        },
      });

      if (!request) {
        throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
      }

      if (request.status !== RefundRequestStatus.PENDING) {
        throw new AppError("REFUND_REQUEST_ALREADY_REVIEWED", 409);
      }

      const currency = request.payment.currency;
      const amount = Number(request.amount);

      // =====================================================
      // 2. REJECT REQUEST
      // =====================================================

      if (decision === "REJECT") {
        const reviewNote = payload.reviewNote!.trim();
        const reviewedAt = new Date();

        const updated = await tx.refundRequest.updateMany({
          where: {
            id: request.id,
            status: RefundRequestStatus.PENDING,
          },

          data: {
            status: RefundRequestStatus.REJECTED,
            reviewedBy: reviewerId,
            reviewedAt,
            reviewNote,
          },
        });

        if (updated.count !== 1) {
          throw new AppError("REFUND_REQUEST_ALREADY_REVIEWED", 409);
        }

        // =================================================
        // 2.1 AUDIT LOG: REFUND REJECTED
        // =================================================

        await auditLogService.createAuditLog(
          {
            userId: reviewerId,
            action: "REFUND_REQUEST_REJECTED",
            entityType: "REFUND_REQUEST",
            entityId: request.id,

            metadata: {
              customerId: request.customerId,
              paymentId: request.paymentId,
              amount,
              currency,
              provider: request.payment.provider,
              previousStatus: RefundRequestStatus.PENDING,
              newStatus: RefundRequestStatus.REJECTED,
              reviewNote,
            },
          },
          tx,
        );

        // =================================================
        // 2.2 CUSTOMER NOTIFICATION
        // =================================================

        await notificationService.createNotification(
          {
            userId: request.customerId,
            type: "SYSTEM",
            title: "Refund Request Rejected",
            message:
              `Your refund request for ${currency} ` +
              `${amount.toFixed(2)} was rejected. ` +
              `Reason: ${reviewNote}`,
          },
          tx,
        );

        const rejected = await tx.refundRequest.findUniqueOrThrow({
          where: {
            id: request.id,
          },
        });

        return {
          id: rejected.id,
          paymentId: rejected.paymentId,
          amount: Number(rejected.amount),
          status: rejected.status,
          reviewedBy: rejected.reviewedBy,
          reviewedAt: rejected.reviewedAt,
          reviewNote: rejected.reviewNote,
        };
      }

      // =====================================================
      // 3. CHECK PAYMENT ELIGIBILITY
      // =====================================================

      const payment = request.payment;
      const policyExecution = await validatePolicyRefund(tx, request);

      const isStripe = payment.provider === PaymentProvider.STRIPE;

      const isWallet = payment.provider === PaymentProvider.WALLET;

      if (!isStripe && !isWallet) {
        throw new AppError("REFUND_NOT_ALLOWED", 409);
      }

      if (isStripe && !payment.providerPaymentId) {
        throw new AppError("STRIPE_PAYMENT_NOT_FOUND", 409);
      }

      const alreadyRefunded = payment.refunds
        .filter((refund) => refund.status === RefundStatus.SUCCEEDED)
        .reduce((sum, refund) => sum + Number(refund.amount), 0);

      const eligibility = policyExecution
        ? {
            eligible: true,
            refundableAmount: Number(payment.amount) - alreadyRefunded,
          }
        : calculateRefundEligibility({
            paymentStatus: payment.status,
            paymentProvider: payment.provider,
            paymentPurpose: payment.purpose,
            paymentAmount: Number(payment.amount),
            alreadyRefunded,
          });

      if (
        payment.refunds.some((refund) => refund.status === RefundStatus.PENDING)
      ) {
        throw new AppError("REFUND_ALREADY_PENDING", 409);
      }

      // =====================================================
      // 4. VALIDATE REQUESTED AMOUNT
      // =====================================================

      const requestedCents = Math.round(Number(request.amount) * 100);

      const refundableCents = Math.round(eligibility.refundableAmount * 100);

      if (requestedCents <= 0 || requestedCents > refundableCents) {
        throw new AppError("REFUND_AMOUNT_EXCEEDS_AVAILABLE_BALANCE", 409);
      }

      // =====================================================
      // 5. APPOINTMENT REFUND POLICY
      // =====================================================

      if (payment.appointment && !policyExecution) {
        const appointment = payment.appointment;
        const policy = appointment.branch.bookingPolicy;

        if (!policy) {
          throw new AppError("BRANCH_BOOKING_POLICY_NOT_FOUND", 404);
        }

        if (
          appointment.appointmentStatus !== "RESERVED" &&
          appointment.appointmentStatus !== "CONFIRMED"
        ) {
          throw new AppError("APPOINTMENT_REFUND_NOT_ALLOWED", 409);
        }

        const appointmentDateTime = createHongKongDateTime(
          appointment.date,
          appointment.startTime,
        );

        const cutoffHours = policy.cancellationCutoffHours;

        if (
          !Number.isFinite(cutoffHours) ||
          cutoffHours < 0 ||
          Number.isNaN(appointmentDateTime.getTime())
        ) {
          throw new AppError("INVALID_CANCELLATION_POLICY", 409);
        }

        const cancellationDeadline = new Date(
          appointmentDateTime.getTime() - cutoffHours * 60 * 60 * 1000,
        );

        // Check original customer request time,
        // not the merchant review time.

        if (request.createdAt >= cancellationDeadline) {
          throw new AppError("CANCELLATION_REFUND_DEADLINE_PASSED", 422);
        }
      }

      // =====================================================
      // 6. GROUP PURCHASE REFUND POLICY
      // =====================================================

      if (payment.groupPurchase && !policyExecution) {
        const groupPurchase = payment.groupPurchase;

        const hasActiveOrUsedAppointment = groupPurchase.appointments.some(
          (appointment) => appointment.appointmentStatus !== "CANCELLED",
        );

        if (hasActiveOrUsedAppointment) {
          throw new AppError("GROUP_PURCHASE_REDEMPTION_REVIEW_REQUIRED", 409);
        }
      }

      // =====================================================
      // 7. APPROVE REFUND REQUEST
      // =====================================================

      const approvedAt = new Date();

      const updated = await tx.refundRequest.updateMany({
        where: {
          id: request.id,
          status: RefundRequestStatus.PENDING,
        },

        data: {
          status: RefundRequestStatus.APPROVED,
          reviewedBy: reviewerId,
          reviewedAt: approvedAt,
          reviewNote: payload.reviewNote?.trim() || null,
        },
      });

      if (updated.count !== 1) {
        throw new AppError("REFUND_REQUEST_ALREADY_REVIEWED", 409);
      }

      // =====================================================
      // 7.1 AUDIT LOG: REFUND APPROVED
      // =====================================================

      await auditLogService.createAuditLog(
        {
          userId: reviewerId,
          action: "REFUND_REQUEST_APPROVED",
          entityType: "REFUND_REQUEST",
          entityId: request.id,

          metadata: {
            customerId: request.customerId,
            paymentId: request.paymentId,
            amount,
            currency,
            provider: payment.provider,
            previousStatus: RefundRequestStatus.PENDING,
            newStatus: RefundRequestStatus.APPROVED,
            reviewNote: payload.reviewNote?.trim() || null,
          },
        },
        tx,
      );

      // =====================================================
      // 7.2 CUSTOMER NOTIFICATION
      // =====================================================

      await notificationService.createNotification(
        {
          userId: request.customerId,
          type: "SYSTEM",
          title: "Refund Request Approved",
          message:
            `Your refund request for ${currency} ` +
            `${amount.toFixed(2)} has been approved. ` +
            `Your refund will be processed shortly.`,
        },
        tx,
      );

      // =====================================================
      // 8. RESPONSE
      // =====================================================

      const approved = await tx.refundRequest.findUniqueOrThrow({
        where: {
          id: request.id,
        },
      });

      return {
        id: approved.id,
        paymentId: approved.paymentId,
        amount: Number(approved.amount),
        status: approved.status,
        reviewedBy: approved.reviewedBy,
        reviewedAt: approved.reviewedAt,
        reviewNote: approved.reviewNote,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10000,
    },
  );
};

const getRefundRequestById = async (
  requestId: string,
  userId: string,
  role: Role,
) => {
  const request = await prisma.refundRequest.findUnique({
    where: {
      id: requestId,
    },

    include: {
      customer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },

      reviewer: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },

      payment: {
        select: {
          id: true,
          amount: true,
          currency: true,
          purpose: true,
          provider: true,
          status: true,
          appointmentId: true,
          groupPurchaseId: true,

          appointment: {
            select: {
              id: true,
              branchId: true,
              bookingMethod: true,
              appointmentStatus: true,
              paymentStatus: true,
              date: true,
              startTime: true,
              endTime: true,
              itemName: true,
              price: true,
              cancelledAt: true,
            },
          },

          groupPurchase: {
            select: {
              id: true,
              quantity: true,
              amount: true,
              paymentStatus: true,
              packageId: true,
            },
          },
        },
      },

      refund: {
        select: {
          id: true,
          amount: true,
          status: true,
          providerRefundId: true,
          refundedAt: true,
          createdAt: true,
        },
      },
    },
  });

  if (!request) {
    throw new AppError("REFUND_REQUEST_NOT_FOUND", 404);
  }

  // =====================================================
  // 1. CUSTOMER OWNERSHIP
  // =====================================================

  if (role === Role.CUSTOMER && request.customerId !== userId) {
    throw new AppError("ACCESS_DENIED", 403);
  }

  // =====================================================
  // 2. BRANCH MANAGER ACCESS
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const branchId = request.payment.appointment?.branchId;

    // Group purchase may cover multiple branches.
    // Do not expose it to a branch manager without
    // a defined branch-scoped authorization policy.
    if (!branchId) {
      throw new AppError("ACCESS_DENIED", 403);
    }

    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId,
        },
      },

      select: {
        userId: true,
      },
    });

    if (!managerBranch) {
      throw new AppError("ACCESS_DENIED", 403);
    }
  }

  if (role === Role.STAFF) {
    throw new AppError("ACCESS_DENIED", 403);
  }

  // =====================================================
  // 3. RESPONSE
  // =====================================================

  return {
    id: request.id,

    customer: {
      id: request.customer.id,
      name: request.customer.name,
      email: request.customer.email,
    },

    payment: {
      id: request.payment.id,
      amount: Number(request.payment.amount),
      currency: request.payment.currency,
      purpose: request.payment.purpose,
      provider: request.payment.provider,
      status: request.payment.status,
    },

    appointment: request.payment.appointment
      ? {
          ...request.payment.appointment,
          price: Number(request.payment.appointment.price),
        }
      : null,

    groupPurchase: request.payment.groupPurchase
      ? {
          ...request.payment.groupPurchase,
          amount: Number(request.payment.groupPurchase.amount),
        }
      : null,

    refundRequest: {
      amount: Number(request.amount),
      reason: request.reason,
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    },

    review: request.reviewedAt
      ? {
          reviewedAt: request.reviewedAt,
          reviewNote: request.reviewNote,
          reviewedBy: request.reviewer
            ? {
                id: request.reviewer.id,
                name: request.reviewer.name,
                role: request.reviewer.role,
              }
            : null,
        }
      : null,

    refund: request.refund
      ? {
          id: request.refund.id,
          amount: Number(request.refund.amount),
          status: request.refund.status,
          providerRefundId: request.refund.providerRefundId,
          refundedAt: request.refund.refundedAt,
          createdAt: request.refund.createdAt,
        }
      : null,
  };
};

export const RefundRequestService = {
  createRefundRequest,
  getMyRefundRequests,
  getRefundRequests,
  reviewRefundRequest,
  getRefundRequestById,
};
