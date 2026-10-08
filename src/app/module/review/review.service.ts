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
import { uploadService } from "../upload/upload.service.js";

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
  // 6. VALIDATE REVIEW IMAGE OBJECT KEYS
  // =====================================================

  const imageObjectKeys = payload.imageObjectKeys ?? [];

  if (new Set(imageObjectKeys).size !== imageObjectKeys.length) {
    throw new AppError("Duplicate review images are not allowed", 400);
  }

  if (imageObjectKeys.length > 0) {
    const expectedPrefix = `reviews/${customerId}/`;

    const invalidObjectKey = imageObjectKeys.find(
      (objectKey) => !objectKey.startsWith(expectedPrefix),
    );

    if (invalidObjectKey) {
      throw new AppError("Invalid review image object key", 400);
    }

    // Verify every referenced image really exists in R2.
    await Promise.all(
      imageObjectKeys.map((objectKey) =>
        uploadService.verifyImageExists(objectKey),
      ),
    );
  }

  // =====================================================
  // 7. GENERATE TEMPORARY SIGNED IMAGE URLS
  //
  // Used for:
  // - image moderation
  // - immediate API response
  //
  // DB still stores objectKey only.
  // =====================================================

  const reviewImages = await Promise.all(
    imageObjectKeys.map(async (objectKey) => ({
      objectKey,

      url: await uploadService.getImageUrl(objectKey),
    })),
  );

  const imageUrls = reviewImages.map((image) => image.url);

  // =====================================================
  // 8. AUTOMATED TEXT + IMAGE MODERATION
  // =====================================================

  let moderationStatus: ReviewModerationStatus = ReviewModerationStatus.PENDING;

  let moderationReason: string | null = null;

  try {
    const moderationResult =
      await contentModerationService.moderateReviewContent(
        payload.comment,
        imageUrls,
      );

    if (moderationResult.safe) {
      moderationStatus = ReviewModerationStatus.VISIBLE;

      moderationReason = null;
    } else {
      moderationStatus = ReviewModerationStatus.HIDDEN;

      moderationReason = moderationResult.reason ?? "Unsafe review content";
    }
  } catch (error) {
    console.error("Review moderation failed:", error);

    moderationStatus = ReviewModerationStatus.PENDING;

    moderationReason = "Moderation service unavailable";
  }

  // =====================================================
  // 9. CREATE REVIEW
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
        imageObjectKeys.length > 0
          ? {
              create: imageObjectKeys.map((objectKey, index) => ({
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
          sortOrder: true,
        },
      },

      createdAt: true,
    },
  });

  // =====================================================
  // 10. GENERATE RESPONSE IMAGE URLS
  //
  // Use returned DB ordering as source of truth.
  // =====================================================

  const images = await Promise.all(
    review.images.map(async (image) => {
      const existingSignedImage = reviewImages.find(
        (item) => item.objectKey === image.objectKey,
      );

      return {
        objectKey: image.objectKey,

        url:
          existingSignedImage?.url ??
          (await uploadService.getImageUrl(image.objectKey)),

        sortOrder: image.sortOrder,
      };
    }),
  );

  // =====================================================
  // 11. MODERATION RESULT NOTIFICATION
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

  // =====================================================
  // 12. RESPONSE
  // =====================================================

  return {
    id: review.id,

    rating: review.rating,

    comment: review.comment,

    images,

    moderationStatus: review.moderationStatus,

    moderationReason: review.moderationReason,

    createdAt: review.createdAt.toISOString(),
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
            sortOrder: true,
          },
        },
      },
    }),

    prisma.review.count({
      where,
    }),
  ]);

  const items = await Promise.all(
    reviews.map(async (review) => {
      const images = await Promise.all(
        review.images.map(async (image) => ({
          objectKey: image.objectKey,

          url: await uploadService.getImageUrl(image.objectKey),

          sortOrder: image.sortOrder,
        })),
      );

      return {
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

        reply: review.replyText
          ? {
              text: review.replyText,

              repliedAt: review.repliedAt
                ? review.repliedAt.toISOString()
                : null,
            }
          : null,

        images,

        createdAt: review.createdAt.toISOString(),
      };
    }),
  );

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,

      hasNextPage: page < totalPages,

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
            sortOrder: true,
          },
        },
      },
    }),

    prisma.review.count({
      where,
    }),
  ]);

  const items = await Promise.all(
    reviews.map(async (review) => {
      const images = await Promise.all(
        review.images.map(async (image) => ({
          objectKey: image.objectKey,

          url: await uploadService.getImageUrl(image.objectKey),

          sortOrder: image.sortOrder,
        })),
      );

      return {
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

        reply: review.replyText
          ? {
              text: review.replyText,

              repliedAt: review.repliedAt
                ? review.repliedAt.toISOString()
                : null,
            }
          : null,

        images,

        createdAt: review.createdAt.toISOString(),
      };
    }),
  );

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,

      hasNextPage: page < totalPages,

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
            sortOrder: true,
          },
        },
      },
    }),

    prisma.review.count({
      where,
    }),
  ]);

  const items = await Promise.all(
    reviews.map(async (review) => {
      const images = await Promise.all(
        review.images.map(async (image) => ({
          objectKey: image.objectKey,

          url: await uploadService.getImageUrl(image.objectKey),

          sortOrder: image.sortOrder,
        })),
      );

      return {
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

              repliedAt: review.repliedAt
                ? review.repliedAt.toISOString()
                : null,
            }
          : null,

        images,

        createdAt: review.createdAt.toISOString(),

        updatedAt: review.updatedAt.toISOString(),
      };
    }),
  );

  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    items,

    pagination: {
      page,
      limit,
      total,
      totalPages,

      hasNextPage: page < totalPages,

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
  // 1. FIND EXISTING REVIEW
  // =====================================================

  const existingReview = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,

      customerId: true,

      comment: true,

      moderationStatus: true,

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

  if (!existingReview) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. OWNERSHIP
  // =====================================================

  if (existingReview.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

  // =====================================================
  // 3. DETERMINE FINAL IMAGE SET
  // =====================================================

  const finalImageObjectKeys =
    payload.imageObjectKeys !== undefined
      ? payload.imageObjectKeys
      : existingReview.images.map((image) => image.objectKey);

  // =====================================================
  // 4. DUPLICATE IMAGE CHECK
  // =====================================================

  if (new Set(finalImageObjectKeys).size !== finalImageObjectKeys.length) {
    throw new AppError("Duplicate review images are not allowed", 400);
  }

  // =====================================================
  // 5. VALIDATE IMAGE OWNERSHIP + R2 EXISTENCE
  // =====================================================

  if (finalImageObjectKeys.length > 0) {
    const expectedPrefix = `reviews/${customerId}/`;

    const invalidObjectKey = finalImageObjectKeys.find(
      (objectKey) => !objectKey.startsWith(expectedPrefix),
    );

    if (invalidObjectKey) {
      throw new AppError("Invalid review image object key", 400);
    }

    await Promise.all(
      finalImageObjectKeys.map((objectKey) =>
        uploadService.verifyImageExists(objectKey),
      ),
    );
  }

  // =====================================================
  // 6. DETERMINE FINAL COMMENT
  // =====================================================

  const finalComment =
    payload.comment !== undefined ? payload.comment : existingReview.comment;

  // =====================================================
  // 7. SHOULD RE-MODERATE?
  //
  // Rating-only update does not need moderation.
  // Comment OR image change must re-moderate.
  // =====================================================

  const requiresModeration =
    payload.comment !== undefined || payload.imageObjectKeys !== undefined;

  let moderationUpdate:
    | {
        moderationStatus: ReviewModerationStatus;

        moderationReason: string | null;
      }
    | undefined;

  let signedImages: {
    objectKey: string;
    url: string;
  }[] = [];

  if (requiresModeration) {
    // ===================================================
    // 8. SIGN FINAL IMAGE SET
    // ===================================================

    signedImages = await Promise.all(
      finalImageObjectKeys.map(async (objectKey) => ({
        objectKey,

        url: await uploadService.getImageUrl(objectKey),
      })),
    );

    const imageUrls = signedImages.map((image) => image.url);

    // ===================================================
    // 9. MODERATE FINAL TEXT + IMAGES
    // ===================================================

    try {
      const moderationResult =
        await contentModerationService.moderateReviewContent(
          finalComment,
          imageUrls,
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
    } catch (error) {
      console.error("Review update moderation failed:", error);

      moderationUpdate = {
        moderationStatus: ReviewModerationStatus.PENDING,

        moderationReason: "Moderation service unavailable",
      };
    }
  }

  // =====================================================
  // 10. UPDATE TRANSACTIONALLY
  // =====================================================

  const result = await prisma.$transaction(
    async (tx) => {
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

          ...(moderationUpdate && {
            moderationStatus: moderationUpdate.moderationStatus,

            moderationReason: moderationUpdate.moderationReason,
          }),

          ...(payload.imageObjectKeys !== undefined && {
            images: {
              create: finalImageObjectKeys.map((objectKey, index) => ({
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
              sortOrder: true,
            },
          },

          updatedAt: true,
        },
      });
    },
    {
      maxWait: 5000,
      timeout: 15000,
    },
  );

  // =====================================================
  // 11. SIGN RESPONSE IMAGES
  // =====================================================

  const images = await Promise.all(
    result.images.map(async (image) => {
      const existingSigned = signedImages.find(
        (item) => item.objectKey === image.objectKey,
      );

      return {
        objectKey: image.objectKey,

        url:
          existingSigned?.url ??
          (await uploadService.getImageUrl(image.objectKey)),

        sortOrder: image.sortOrder,
      };
    }),
  );

  // =====================================================
  // 12. MODERATION NOTIFICATION
  // =====================================================

  if (requiresModeration && moderationUpdate) {
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
  // 13. RESPONSE
  // =====================================================

  return {
    id: result.id,

    rating: result.rating,

    comment: result.comment,

    images,

    moderationStatus: result.moderationStatus,

    moderationReason: result.moderationReason,

    updatedAt: result.updatedAt.toISOString(),
  };
};

const deleteReview = async (customerId: string, reviewId: string) => {
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

      images: {
        select: {
          objectKey: true,
        },
      },
    },
  });

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. OWNERSHIP
  // =====================================================

  if (review.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

  const imageObjectKeys = review.images.map((image) => image.objectKey);

  // =====================================================
  // 3. DELETE REVIEW FROM DB
  //
  // ReviewImage rows are deleted by Prisma cascade.
  // =====================================================

  await prisma.review.delete({
    where: {
      id: reviewId,
    },
  });

  // =====================================================
  // 4. DELETE REVIEW IMAGES FROM R2
  // =====================================================

  if (imageObjectKeys.length > 0) {
    try {
      await Promise.all(
        imageObjectKeys.map((objectKey) =>
          uploadService.deleteImage(
            {
              objectKey,
            },
            {
              userId: customerId,
              role: Role.CUSTOMER,
            },
          ),
        ),
      );
    } catch (error) {
      console.error("Failed to cleanup review images from R2:", error);
    }
  }

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
