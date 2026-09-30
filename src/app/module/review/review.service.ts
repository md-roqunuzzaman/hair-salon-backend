import {
  AppointmentStatus,
  ReviewModerationStatus,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";

import {
  ICreateReviewPayload,
  IGetReviewsQuery,
  IModerateReviewPayload,
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
  // 6. CREATE REVIEW
  // =====================================================

  const review = await prisma.review.create({
    data: {
      customerId,

      appointmentId: appointment.id,

      branchId: appointment.branchId,

      staffId: appointment.staffId,

      rating: payload.rating,

      comment: payload.comment,

      moderationStatus: ReviewModerationStatus.VISIBLE,

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

      images: review.images.map((image) => ({
        objectKey: image.objectKey,
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

const updateReview = async (
  customerId: string,
  reviewId: string,
  payload: IUpdateReviewPayload,
) => {
  const existingReview = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
      customerId: true,
    },
  });

  if (!existingReview) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  if (existingReview.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

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

  return {
    id: result.id,
    rating: result.rating,
    comment: result.comment,

    images: result.images.map((image) => ({
      objectKey: image.objectKey,
      url: null,
    })),
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

const moderateReview = async (
  reviewId: string,
  payload: IModerateReviewPayload,
) => {
  const review = await prisma.review.findUnique({
    where: {
      id: reviewId,
    },

    select: {
      id: true,
    },
  });

  if (!review) {
    throw new AppError("REVIEW_NOT_FOUND", 404);
  }

  const updatedReview = await prisma.review.update({
    where: {
      id: reviewId,
    },

    data: {
      moderationStatus: payload.moderationStatus,

      moderationReason:
        payload.moderationStatus === ReviewModerationStatus.HIDDEN
          ? (payload.reason ?? null)
          : null,
    },

    select: {
      id: true,
      moderationStatus: true,
    },
  });

  return updatedReview;
};

export const reviewService = {
  createReview,
  getBranchReviews,
  getStaffReviews,
  updateReview,
  deleteReview,
  moderateReview,
};
