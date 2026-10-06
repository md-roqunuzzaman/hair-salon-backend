import {
  AppointmentStatus,
  ReviewModerationStatus,
  Role,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { contentModerationService } from "../contentModeration/contentModeration.service.js";
import { notificationService } from "../notification/notification.service.js";

import {
  ICreateReviewPayload,
  IGetReviewsQuery,
  IModerateReviewPayload,
  IReviewReplyPayload,
  IUpdateReviewPayload,
} from "./review.interface.js";

const createReview = async (
  customerId: string,
  appointmentId: string,
  payload: ICreateReviewPayload,
) => {
  // =====================================================
  // 1. FIND APPOINTMENT
  // =====================================================

  const appointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },

    select: {
      id: true,
      customerId: true,
      branchId: true,
      staffId: true,
      appointmentStatus: true,
    },
  });

  if (!appointment) {
    throw new AppError("APPOINTMENT_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. OWNERSHIP
  // =====================================================

  if (appointment.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

  // =====================================================
  // 3. MUST BE COMPLETED
  // =====================================================

  if (appointment.appointmentStatus !== AppointmentStatus.COMPLETED) {
    throw new AppError("REVIEW_NOT_ALLOWED", 409);
  }

  // =====================================================
  // 4. APPOINTMENT MUST HAVE STAFF
  // =====================================================

  if (!appointment.staffId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 409);
  }

  // =====================================================
  // 5. ONE REVIEW PER APPOINTMENT
  // =====================================================

  const existingReview = await prisma.review.findUnique({
    where: {
      appointmentId,
    },

    select: {
      id: true,
    },
  });

  if (existingReview) {
    throw new AppError("REVIEW_ALREADY_EXISTS", 409);
  }

  // =====================================================
  // 6. AUTOMATED CONTENT MODERATION
  // =====================================================

  let moderationStatus: ReviewModerationStatus = ReviewModerationStatus.PENDING;

  let moderationReason: string | null = null;

  try {
    const moderationResult = await contentModerationService.moderateText(
      payload.comment,
    );

    if (moderationResult.safe) {
      moderationStatus = ReviewModerationStatus.VISIBLE;
      moderationReason = null;
    } else {
      moderationStatus = ReviewModerationStatus.HIDDEN;
      moderationReason = moderationResult.reason ?? "Unsafe review content";
    }
  } catch {
    moderationStatus = ReviewModerationStatus.PENDING;
    moderationReason = "Moderation service unavailable";
  }

  // =====================================================
  // 7. CREATE REVIEW
  // =====================================================

  const review = await prisma.review.create({
    data: {
      customerId,

      appointmentId: appointment.id,

      branchId: appointment.branchId,

      staffId: appointment.staffId,

      rating: payload.rating,

      comment: payload.comment,

      moderationStatus,

      moderationReason,

      images:
        payload.imageObjectKeys && payload.imageObjectKeys.length > 0
          ? {
              create: payload.imageObjectKeys.map((objectKey, index) => ({
                objectKey,
                sortOrder: index,
              })),
            }
          : undefined,
    },

    select: {
      id: true,
      rating: true,
      comment: true,

      moderationStatus: true,
      moderationReason: true,

      images: {
        orderBy: {
          sortOrder: "asc",
        },

        select: {
          objectKey: true,
        },
      },
    },
  });

  // =====================================================
  // 8. MODERATION RESULT NOTIFICATION
  // =====================================================

  try {
    if (review.moderationStatus === ReviewModerationStatus.VISIBLE) {
      await notificationService.createNotification({
        userId: customerId,
        type: "REVIEW_PUBLISHED",
        title: "Review published",
        message: "Your review has been published successfully.",
      });
    }

    if (review.moderationStatus === ReviewModerationStatus.HIDDEN) {
      await notificationService.createNotification({
        userId: customerId,
        type: "REVIEW_NEEDS_CHANGES",
        title: "Review needs changes",
        message:
          "Your review is not public because it may contain content that does not meet our review guidelines. You can edit and resubmit it.",
      });
    }

    if (review.moderationStatus === ReviewModerationStatus.PENDING) {
      await notificationService.createNotification({
        userId: customerId,
        type: "REVIEW_PENDING",
        title: "Review under review",
        message: "Your review is being checked before publication.",
      });
    }
  } catch (error) {
    console.error("Failed to create review notification:", error);
  }
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,

    images: review.images.map((image) => ({
      objectKey: image.objectKey,

      // R2 is intentionally not integrated yet.
      url: null,
    })),

    moderationStatus: review.moderationStatus,
    moderationReason: review.moderationReason,
  };
};

const getBranchReviews = async (branchId: string, query: IGetReviewsQuery) => {
  const branch = await prisma.branch.findUnique({
    where: {
      id: branchId,
    },

    select: {
      id: true,
    },
  });

  if (!branch) {
    throw new AppError("BRANCH_NOT_FOUND", 404);
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  const where = {
    branchId,

    moderationStatus: ReviewModerationStatus.VISIBLE,

    ...(query.rating !== undefined && {
      rating: query.rating,
    }),
  };

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,

        // ==========================================
        // SALON REPLY
        // ==========================================

        replyText: true,
        repliedAt: true,

        customer: {
          select: {
            id: true,
            name: true,
          },
        },

        staff: {
          select: {
            id: true,

            user: {
              select: {
                name: true,
              },
            },
          },
        },

        images: {
          orderBy: {
            sortOrder: "asc",
          },

          select: {
            objectKey: true,
          },
        },
      },
    }),

    prisma.review.count({
      where,
    }),
  ]);

  return {
    items: reviews.map((review) => ({
      id: review.id,

      rating: review.rating,

      comment: review.comment,

      customer: {
        id: review.customer.id,
        name: review.customer.name,
      },

      staff: {
        id: review.staff.id,
        name: review.staff.user.name,
      },

      // ==========================================
      // SALON OFFICIAL REPLY
      // ==========================================

      reply: review.replyText
        ? {
            text: review.replyText,

            repliedAt: review.repliedAt ? review.repliedAt.toISOString() : null,
          }
        : null,

      images: review.images.map((image) => ({
        objectKey: image.objectKey,

        // R2 is not integrated yet.
        url: null,
      })),

      createdAt: review.createdAt.toISOString(),
    })),

    pagination: {
      page,
      limit,
      total,

      totalPages: Math.ceil(total / limit),

      hasNextPage: page * limit < total,

      hasPreviousPage: page > 1,
    },
  };
};
const getStaffReviews = async (staffId: string, query: IGetReviewsQuery) => {
  const staff = await prisma.staff.findUnique({
    where: {
      id: staffId,
    },

    select: {
      id: true,
    },
  });

  if (!staff) {
    throw new AppError("STAFF_NOT_FOUND", 404);
  }

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  const where = {
    staffId,

    moderationStatus: ReviewModerationStatus.VISIBLE,

    ...(query.rating !== undefined && {
      rating: query.rating,
    }),
  };

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        rating: true,
        comment: true,
        createdAt: true,

        // ==========================================
        // SALON REPLY
        // ==========================================

        replyText: true,
        repliedAt: true,

        customer: {
          select: {
            id: true,
            name: true,
          },
        },

        branch: {
          select: {
            id: true,
            name: true,
          },
        },

        images: {
          orderBy: {
            sortOrder: "asc",
          },

          select: {
            objectKey: true,
          },
        },
      },
    }),

    prisma.review.count({
      where,
    }),
  ]);

  return {
    items: reviews.map((review) => ({
      id: review.id,

      rating: review.rating,

      comment: review.comment,

      customer: {
        id: review.customer.id,
        name: review.customer.name,
      },

      branch: {
        id: review.branch.id,
        name: review.branch.name,
      },

      // ==========================================
      // SALON OFFICIAL REPLY
      // ==========================================

      reply: review.replyText
        ? {
            text: review.replyText,

            repliedAt: review.repliedAt ? review.repliedAt.toISOString() : null,
          }
        : null,

      images: review.images.map((image) => ({
        objectKey: image.objectKey,

        // R2 not integrated yet
        url: null,
      })),

      createdAt: review.createdAt.toISOString(),
    })),

    pagination: {
      page,
      limit,
      total,

      totalPages: Math.ceil(total / limit),

      hasNextPage: page * limit < total,

      hasPreviousPage: page > 1,
    },
  };
};

const getMyReviews = async (customerId: string, query: IGetReviewsQuery) => {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  const where = {
    customerId,

    ...(query.rating !== undefined && {
      rating: query.rating,
    }),
  };

  const [reviews, total] = await prisma.$transaction([
    prisma.review.findMany({
      where,

      skip,
      take: limit,

      orderBy: {
        createdAt: "desc",
      },

      select: {
        id: true,
        rating: true,
        comment: true,

        moderationStatus: true,
        moderationReason: true,

        replyText: true,
        repliedAt: true,

        createdAt: true,
        updatedAt: true,

        branch: {
          select: {
            id: true,
            name: true,
          },
        },

        staff: {
          select: {
            id: true,

            user: {
              select: {
                name: true,
              },
            },
          },
        },

        appointment: {
          select: {
            id: true,
            date: true,
            startTime: true,

            itemName: true,
          },
        },

        images: {
          orderBy: {
            sortOrder: "asc",
          },

          select: {
            objectKey: true,
          },
        },
      },
    }),

    prisma.review.count({
      where,
    }),
  ]);

  return {
    items: reviews.map((review) => ({
      id: review.id,

      rating: review.rating,
      comment: review.comment,

      moderationStatus: review.moderationStatus,

      moderationReason: review.moderationReason,

      canEdit: true,
      canDelete: true,

      branch: {
        id: review.branch.id,
        name: review.branch.name,
      },

      staff: {
        id: review.staff.id,
        name: review.staff.user.name,
      },

      appointment: {
        id: review.appointment.id,

        date: review.appointment.date.toISOString().slice(0, 10),

        startTime: review.appointment.startTime,

        itemName: review.appointment.itemName,
      },

      reply: review.replyText
        ? {
            text: review.replyText,

            repliedAt: review.repliedAt ? review.repliedAt.toISOString() : null,
          }
        : null,

      images: review.images.map((image) => ({
        objectKey: image.objectKey,

        // R2 later
        url: null,
      })),

      createdAt: review.createdAt.toISOString(),
      updatedAt: review.updatedAt.toISOString(),
    })),

    pagination: {
      page,
      limit,
      total,

      totalPages: total === 0 ? 0 : Math.ceil(total / limit),

      hasNextPage: page < Math.ceil(total / limit),

      hasPreviousPage: page > 1,
    },
  };
};

const updateReview = async (
  customerId: string,
  reviewId: string,
  payload: IUpdateReviewPayload,
) => {
  // =====================================================
  // 1. FIND REVIEW
  // =====================================================

  const existingReview = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
      customerId: true,
      moderationStatus: true,
    },
  });

  if (!existingReview) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. OWNERSHIP CHECK
  // =====================================================

  if (existingReview.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

  // =====================================================
  // 3. RE-MODERATE COMMENT IF CHANGED
  // =====================================================

  let moderationUpdate:
    | {
        moderationStatus: ReviewModerationStatus;
        moderationReason: string | null;
      }
    | undefined;

  if (payload.comment !== undefined) {
    try {
      const moderationResult = await contentModerationService.moderateText(
        payload.comment,
      );

      if (moderationResult.safe) {
        moderationUpdate = {
          moderationStatus: ReviewModerationStatus.VISIBLE,
          moderationReason: null,
        };
      } else {
        moderationUpdate = {
          moderationStatus: ReviewModerationStatus.HIDDEN,
          moderationReason: moderationResult.reason ?? "Unsafe review content",
        };
      }
    } catch {
      moderationUpdate = {
        moderationStatus: ReviewModerationStatus.PENDING,
        moderationReason: "Moderation service unavailable",
      };
    }
  }

  // =====================================================
  // 4. UPDATE REVIEW TRANSACTIONALLY
  // =====================================================

  const result = await prisma.$transaction(async (tx) => {
    if (payload.imageObjectKeys !== undefined) {
      await tx.reviewImage.deleteMany({
        where: {
          reviewId,
        },
      });
    }

    return tx.review.update({
      where: {
        id: reviewId,
      },

      data: {
        ...(payload.rating !== undefined && {
          rating: payload.rating,
        }),

        ...(payload.comment !== undefined && {
          comment: payload.comment,
        }),

        ...(moderationUpdate && moderationUpdate),

        ...(payload.imageObjectKeys !== undefined && {
          images: {
            create: payload.imageObjectKeys.map((objectKey, index) => ({
              objectKey,
              sortOrder: index,
            })),
          },
        }),
      },

      select: {
        id: true,
        rating: true,
        comment: true,

        moderationStatus: true,
        moderationReason: true,

        images: {
          orderBy: {
            sortOrder: "asc",
          },

          select: {
            objectKey: true,
          },
        },
      },
    });
  });

  // =====================================================
  // 5. MODERATION RESULT NOTIFICATION
  // Only if comment changed
  // =====================================================

  if (payload.comment !== undefined && moderationUpdate) {
    try {
      if (result.moderationStatus === ReviewModerationStatus.VISIBLE) {
        await notificationService.createNotification({
          userId: customerId,
          type: "REVIEW_PUBLISHED",
          title: "Review published",
          message: "Your updated review has been published successfully.",
        });
      }

      if (result.moderationStatus === ReviewModerationStatus.HIDDEN) {
        await notificationService.createNotification({
          userId: customerId,
          type: "REVIEW_NEEDS_CHANGES",
          title: "Review needs changes",
          message:
            "Your updated review is not public because it may contain content that does not meet our review guidelines. You can edit and resubmit it.",
        });
      }

      if (result.moderationStatus === ReviewModerationStatus.PENDING) {
        await notificationService.createNotification({
          userId: customerId,
          type: "REVIEW_PENDING",
          title: "Review under review",
          message: "Your updated review is being checked before publication.",
        });
      }
    } catch (error) {
      console.error("Failed to create review update notification:", error);
    }
  }

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return {
    id: result.id,

    rating: result.rating,

    comment: result.comment,

    images: result.images.map((image) => ({
      objectKey: image.objectKey,

      // R2 not integrated yet
      url: null,
    })),

    moderationStatus: result.moderationStatus,

    moderationReason: result.moderationReason,
  };
};

const deleteReview = async (customerId: string, reviewId: string) => {
  const review = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
      customerId: true,
    },
  });

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  if (review.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

  await prisma.review.delete({
    where: {
      id: reviewId,
    },
  });

  return null;
};

// const moderateReview = async (
//   reviewId: string,
//   payload: IModerateReviewPayload,
// ) => {
//   const review = await prisma.review.findUnique({
//     where: {
//       id: reviewId,
//     },

//     select: {
//       id: true,
//     },
//   });

//   if (!review) {
//     throw new AppError("REVIEW_NOT_FOUND", 404);
//   }

//   const updatedReview = await prisma.review.update({
//     where: {
//       id: reviewId,
//     },

//     data: {
//       moderationStatus: payload.moderationStatus,

//       moderationReason:
//         payload.moderationStatus === ReviewModerationStatus.HIDDEN
//           ? (payload.reason ?? null)
//           : null,
//     },

//     select: {
//       id: true,
//       moderationStatus: true,
//     },
//   });

//   return updatedReview;
// };

const moderateReview = async (
  reviewId: string,
  userId: string,
  payload: IModerateReviewPayload,
) => {
  // =====================================================
  // 1. FIND REVIEW
  // =====================================================

  const review = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
      customerId: true,
      moderationStatus: true,
    },
  });

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. UPDATE MODERATION
  // =====================================================

  const updatedReview = await prisma.review.update({
    where: {
      id: reviewId,
    },

    data: {
      moderationStatus: payload.moderationStatus,

      moderationReason:
        payload.moderationStatus === ReviewModerationStatus.HIDDEN
          ? (payload.reason ?? "Hidden by manual moderation")
          : null,
    },

    select: {
      id: true,
      moderationStatus: true,
      moderationReason: true,
    },
  });

  // =====================================================
  // 3. CHECK IF STATUS ACTUALLY CHANGED
  // =====================================================

  const statusChanged =
    review.moderationStatus !== updatedReview.moderationStatus;

  // =====================================================
  // 4. CREATE AUDIT LOG
  // =====================================================

  if (statusChanged) {
    await auditLogService.createAuditLog({
      userId,

      action: "REVIEW_MODERATED",

      entityType: "REVIEW",

      entityId: reviewId,

      metadata: {
        previousStatus: review.moderationStatus,
        newStatus: updatedReview.moderationStatus,
        reason: updatedReview.moderationReason,
      },
    });
  }

  // =====================================================
  // 5. CUSTOMER NOTIFICATION
  // =====================================================

  if (statusChanged) {
    try {
      if (updatedReview.moderationStatus === ReviewModerationStatus.VISIBLE) {
        await notificationService.createNotification({
          userId: review.customerId,

          type: "REVIEW_PUBLISHED",

          title: "Review published",

          message: "Your review has been reviewed and is now publicly visible.",
        });
      }

      if (updatedReview.moderationStatus === ReviewModerationStatus.HIDDEN) {
        await notificationService.createNotification({
          userId: review.customerId,

          type: "REVIEW_NEEDS_CHANGES",

          title: "Review needs changes",

          message:
            "Your review is not publicly visible. You can edit and resubmit it.",
        });
      }
    } catch (error) {
      console.error("Failed to create review moderation notification:", error);
    }
  }

  // =====================================================
  // 6. RESPONSE
  // =====================================================

  return updatedReview;
};
const saveReviewReply = async (
  reviewId: string,
  userId: string,
  role: Role,
  payload: IReviewReplyPayload,
) => {
  // =====================================================
  // 1. FIND REVIEW
  // =====================================================

  const review = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
      branchId: true,
      customerId: true,
      moderationStatus: true,

      // Needed to determine create vs update
      replyText: true,
    },
  });

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. ROLE CHECK
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("FORBIDDEN", 403);
  }

  // =====================================================
  // 3. BRANCH MANAGER SCOPE
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: review.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError("FORBIDDEN_BRANCH_SCOPE", 403);
    }
  }

  // =====================================================
  // 4. ONLY REPLY TO VISIBLE REVIEW
  // =====================================================

  if (review.moderationStatus !== ReviewModerationStatus.VISIBLE) {
    throw new AppError("REVIEW_REPLY_NOT_ALLOWED", 409);
  }

  // =====================================================
  // 5. CHECK IF THIS IS A NEW REPLY OR AN UPDATE
  // =====================================================

  const isNewReply = !review.replyText;

  // =====================================================
  // 6. AUTOMATED REPLY MODERATION
  // =====================================================

  let moderationResult;

  try {
    moderationResult = await contentModerationService.moderateText(
      payload.reply,
    );
  } catch {
    throw new AppError("REVIEW_REPLY_MODERATION_UNAVAILABLE", 503);
  }

  if (!moderationResult.safe) {
    throw new AppError("REVIEW_REPLY_CONTENT_NOT_ALLOWED", 422);
  }

  // =====================================================
  // 7. CREATE / UPDATE SINGLE OFFICIAL REPLY
  // =====================================================

  const updatedReview = await prisma.review.update({
    where: {
      id: reviewId,
    },

    data: {
      replyText: payload.reply.trim(),

      // V1 behavior:
      // reply edit করলে repliedAt নতুন timestamp হবে.
      repliedAt: new Date(),

      repliedById: userId,
    },

    select: {
      id: true,

      replyText: true,
      repliedAt: true,

      repliedBy: {
        select: {
          id: true,
          name: true,
          role: true,
        },
      },
    },
  });

  // =====================================================
  // 8. CUSTOMER NOTIFICATION
  // Only notify on first reply, not on reply edits
  // =====================================================

  if (isNewReply) {
    try {
      await notificationService.createNotification({
        userId: review.customerId,
        type: "REVIEW_REPLY",
        title: "Salon replied to your review",
        message: "The salon has replied to your review.",
      });
    } catch (error) {
      console.error("Failed to create review reply notification:", error);
    }
  }

  // =====================================================
  // 9. RESPONSE
  // =====================================================

  return {
    reviewId: updatedReview.id,

    reply: {
      text: updatedReview.replyText,

      repliedAt: updatedReview.repliedAt,

      repliedBy: updatedReview.repliedBy
        ? {
            id: updatedReview.repliedBy.id,
            name: updatedReview.repliedBy.name,
            role: updatedReview.repliedBy.role,
          }
        : null,
    },
  };
};

const deleteReviewReply = async (
  reviewId: string,
  userId: string,
  role: Role,
) => {
  // =====================================================
  // 1. FIND REVIEW
  // =====================================================

  const review = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
      branchId: true,
      replyText: true,
    },
  });

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. ROLE CHECK
  // =====================================================

  if (role !== Role.BRAND_OWNER && role !== Role.BRANCH_MANAGER) {
    throw new AppError("FORBIDDEN", 403);
  }

  // =====================================================
  // 3. BRANCH MANAGER SCOPE
  // =====================================================

  if (role === Role.BRANCH_MANAGER) {
    const managerBranch = await prisma.branchManagerBranch.findUnique({
      where: {
        userId_branchId: {
          userId,
          branchId: review.branchId,
        },
      },
    });

    if (!managerBranch) {
      throw new AppError("FORBIDDEN_BRANCH_SCOPE", 403);
    }
  }

  // =====================================================
  // 4. REPLY MUST EXIST
  // =====================================================

  if (!review.replyText) {
    throw new AppError("REVIEW_REPLY_NOT_FOUND", 404);
  }

  // =====================================================
  // 5. DELETE REPLY
  // =====================================================

  await prisma.review.update({
    where: {
      id: reviewId,
    },

    data: {
      replyText: null,
      repliedAt: null,
      repliedById: null,
    },
  });

  return null;
};
export const reviewService = {
  createReview,
  getBranchReviews,
  getStaffReviews,
  getMyReviews,
  updateReview,
  deleteReview,
  moderateReview,
  saveReviewReply,
  deleteReviewReply,
};
