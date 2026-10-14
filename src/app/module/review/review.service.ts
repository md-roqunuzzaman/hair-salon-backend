import {
  AppointmentStatus,
  Prisma,
  ReviewModerationStatus,
  Role,
} from "../../../../generated/prisma/client.js";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { DEFAULT_LANGUAGE, Language } from "../../utils/language.js";
import { getLocalizedContent } from "../../utils/localization.js";
import { auditLogService } from "../auditLog/auditLog.service.js";
import { contentModerationService } from "../contentModeration/contentModeration.service.js";
import { INotificationTranslations } from "../notification/notification.interface.js";
import { notificationService } from "../notification/notification.service.js";
import { notificationTemplates } from "../notification/notification.templates.js";
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
  // 2. CHECK CUSTOMER OWNERSHIP
  // =====================================================

  if (appointment.customerId !== customerId) {
    throw new AppError("REVIEW_NOT_ALLOWED", 403);
  }

  // =====================================================
  // 3. APPOINTMENT MUST BE COMPLETED
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
  //
  // Early check for a clear API error.
  // Database unique constraint is the final protection.
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

  // Prevent duplicate images in the same review.

  if (new Set(imageObjectKeys).size !== imageObjectKeys.length) {
    throw new AppError("Duplicate review images are not allowed", 400);
  }

  if (imageObjectKeys.length > 0) {
    const expectedPrefix = `reviews/${customerId}/`;

    // Validate image object key ownership.

    const invalidObjectKey = imageObjectKeys.find(
      (objectKey) => !objectKey.startsWith(expectedPrefix),
    );

    if (invalidObjectKey) {
      throw new AppError("Invalid review image object key", 400);
    }

    // Verify referenced images exist in Cloudflare R2.

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
  // - Automated image moderation
  // - Immediate API response
  //
  // Database stores objectKey only.
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
  // 9. CREATE REVIEW — CONCURRENCY SAFE
  //
  // Database unique constraint prevents multiple reviews
  // for the same appointment.
  //
  // Prisma P2002 is converted to a meaningful API error.
  // =====================================================

  const review = await (async () => {
    try {
      return await prisma.review.create({
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
    } catch (error) {
      // -------------------------------------------------
      // HANDLE UNIQUE CONSTRAINT VIOLATION
      // -------------------------------------------------

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // Check whether the conflict is caused by
        // an existing review for this appointment.

        const duplicateReview = await prisma.review.findUnique({
          where: {
            appointmentId,
          },

          select: {
            id: true,
          },
        });

        if (duplicateReview) {
          throw new AppError("REVIEW_ALREADY_EXISTS", 409);
        }
      }

      // Preserve all unrelated Prisma/database errors.

      throw error;
    }
  })();

  // =====================================================
  // 10. GENERATE RESPONSE IMAGE URLS
  //
  // Database image ordering is the source of truth.
  // Reuse already generated signed URLs where possible.
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
  // 11. MULTILINGUAL REVIEW NOTIFICATION
  //
  // Supported languages:
  // - en
  // - zh-CN
  // - zh-HK
  //
  // Notification failure must not fail review creation.
  // =====================================================

  try {
    let notificationType: string;

    let translations: INotificationTranslations;

    // -------------------------------------------------
    // REVIEW PUBLISHED
    // -------------------------------------------------

    if (review.moderationStatus === ReviewModerationStatus.VISIBLE) {
      notificationType = "REVIEW_PUBLISHED";

      translations = notificationTemplates.REVIEW_PUBLISHED();
    }

    // -------------------------------------------------
    // REVIEW HIDDEN / NEEDS CHANGES
    // -------------------------------------------------
    else if (review.moderationStatus === ReviewModerationStatus.HIDDEN) {
      notificationType = "REVIEW_NEEDS_CHANGES";

      translations = notificationTemplates.REVIEW_NEEDS_CHANGES();
    }

    // -------------------------------------------------
    // REVIEW PENDING MODERATION
    // -------------------------------------------------
    else {
      notificationType = "REVIEW_PENDING";

      translations = notificationTemplates.REVIEW_PENDING();
    }

    // -------------------------------------------------
    // SAVE MULTILINGUAL NOTIFICATION
    // -------------------------------------------------

    await notificationService.createNotification({
      userId: customerId,

      type: notificationType,

      // Default English fallback.

      title: translations.en!.title!,

      message: translations.en!.message!,

      // All supported languages.

      translations,
    });
  } catch (error) {
    console.error("Failed to create review notification:", error);
  }

  // =====================================================
  // 12. RESPONSE
  //
  // Preserve existing API response structure.
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

const getBranchReviews = async (
  branchId: string,
  query: IGetReviewsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. CHECK BRANCH
  // =====================================================

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

  // =====================================================
  // 2. PAGINATION
  // =====================================================

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  // =====================================================
  // 3. FILTER
  // =====================================================

  const where = {
    branchId,

    moderationStatus: ReviewModerationStatus.VISIBLE,

    ...(query.rating !== undefined && {
      rating: query.rating,
    }),
  };

  // =====================================================
  // 4. FETCH REVIEWS + TOTAL
  // =====================================================

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

        // Booking-time multilingual snapshot
        appointment: {
          select: {
            id: true,
            itemName: true,
            itemNameTranslations: true,
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

  // =====================================================
  // 5. RESPONSE + LOCALIZATION
  // =====================================================

  const items = await Promise.all(
    reviews.map(async (review) => {
      // ===============================================
      // SIGNED IMAGE URLS
      // ===============================================

      const images = await Promise.all(
        review.images.map(async (image) => ({
          objectKey: image.objectKey,

          url: await uploadService.getImageUrl(image.objectKey),

          sortOrder: image.sortOrder,
        })),
      );

      // ===============================================
      // LOCALIZE APPOINTMENT ITEM NAME
      // ===============================================

      const localizedItem = getLocalizedContent(
        review.appointment.itemNameTranslations,
        language,
        {
          name: review.appointment.itemName,
        },
      );

      // ===============================================
      // RESPONSE
      // ===============================================

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

        appointment: {
          id: review.appointment.id,
          itemName: localizedItem.name,
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

  // =====================================================
  // 6. PAGINATION RESPONSE
  // =====================================================

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

// const getStaffReviews = async (
//   staffId: string,
//   query: IGetReviewsQuery,
//   language: Language = DEFAULT_LANGUAGE,
// ) => {
//   // =====================================================
//   // 1. CHECK STAFF
//   // =====================================================

//   const staff = await prisma.staff.findUnique({
//     where: {
//       id: staffId,
//     },

//     select: {
//       id: true,
//     },
//   });

//   if (!staff) {
//     throw new AppError("STAFF_NOT_FOUND", 404);
//   }

//   // =====================================================
//   // 2. PAGINATION
//   // =====================================================

//   const page = query.page ?? 1;
//   const limit = query.limit ?? 20;

//   const skip = (page - 1) * limit;

//   // =====================================================
//   // 3. FILTER
//   // =====================================================

//   const where = {
//     staffId,

//     moderationStatus: ReviewModerationStatus.VISIBLE,

//     ...(query.rating !== undefined && {
//       rating: query.rating,
//     }),
//   };

//   // =====================================================
//   // 4. FETCH REVIEWS + TOTAL
//   // =====================================================

//   const [reviews, total] = await prisma.$transaction([
//     prisma.review.findMany({
//       where,

//       skip,
//       take: limit,

//       orderBy: {
//         createdAt: "desc",
//       },

//       select: {
//         id: true,
//         rating: true,
//         comment: true,
//         createdAt: true,

//         replyText: true,
//         repliedAt: true,

//         customer: {
//           select: {
//             id: true,
//             name: true,
//           },
//         },

//         branch: {
//           select: {
//             id: true,
//             name: true,
//             translations: true,
//           },
//         },

//         // Booking-time multilingual snapshot
//         appointment: {
//           select: {
//             id: true,
//             itemName: true,
//             itemNameTranslations: true,
//           },
//         },

//         images: {
//           orderBy: {
//             sortOrder: "asc",
//           },

//           select: {
//             objectKey: true,
//             sortOrder: true,
//           },
//         },
//       },
//     }),

//     prisma.review.count({
//       where,
//     }),
//   ]);

//   // =====================================================
//   // 5. RESPONSE + LOCALIZATION
//   // =====================================================

//   const items = await Promise.all(
//     reviews.map(async (review) => {
//       // ===============================================
//       // SIGNED IMAGE URLS
//       // ===============================================

//       const images = await Promise.all(
//         review.images.map(async (image) => ({
//           objectKey: image.objectKey,

//           url: await uploadService.getImageUrl(image.objectKey),

//           sortOrder: image.sortOrder,
//         })),
//       );

//       // ===============================================
//       // LOCALIZE BRANCH NAME
//       // ===============================================

//       const localizedBranch = getLocalizedContent(
//         review.branch.translations,
//         language,
//         {
//           name: review.branch.name,
//         },
//       );

//       // ===============================================
//       // LOCALIZE APPOINTMENT ITEM NAME
//       // ===============================================

//       const localizedItem = getLocalizedContent(
//         review.appointment.itemNameTranslations,
//         language,
//         {
//           name: review.appointment.itemName,
//         },
//       );

//       // ===============================================
//       // RESPONSE
//       // ===============================================

//       return {
//         id: review.id,

//         rating: review.rating,

//         comment: review.comment,

//         customer: {
//           id: review.customer.id,
//           name: review.customer.name,
//         },

//         branch: {
//           id: review.branch.id,
//           name: localizedBranch.name,
//         },

//         appointment: {
//           id: review.appointment.id,
//           itemName: localizedItem.name,
//         },

//         reply: review.replyText
//           ? {
//               text: review.replyText,

//               repliedAt: review.repliedAt
//                 ? review.repliedAt.toISOString()
//                 : null,
//             }
//           : null,

//         images,

//         createdAt: review.createdAt.toISOString(),
//       };
//     }),
//   );

//   // =====================================================
//   // 6. PAGINATION RESPONSE
//   // =====================================================

//   const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

//   return {
//     items,

//     pagination: {
//       page,
//       limit,
//       total,
//       totalPages,

//       hasNextPage: page < totalPages,

//       hasPreviousPage: page > 1,
//     },
//   };
// };

const getMyReviews = async (
  customerId: string,
  query: IGetReviewsQuery,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. PAGINATION
  // =====================================================

  const page = query.page ?? 1;
  const limit = query.limit ?? 20;

  const skip = (page - 1) * limit;

  // =====================================================
  // 2. FILTER
  // =====================================================

  const where = {
    customerId,

    ...(query.rating !== undefined && {
      rating: query.rating,
    }),
  };

  // =====================================================
  // 3. FETCH MY REVIEWS + TOTAL
  // =====================================================

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
            translations: true,
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
            itemNameTranslations: true,
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

  // =====================================================
  // 4. GENERATE RESPONSE + LOCALIZATION
  // =====================================================

  const items = await Promise.all(
    reviews.map(async (review) => {
      // ===================================================
      // GENERATE SIGNED IMAGE URLS
      // ===================================================

      const images = await Promise.all(
        review.images.map(async (image) => ({
          objectKey: image.objectKey,

          url: await uploadService.getImageUrl(image.objectKey),

          sortOrder: image.sortOrder,
        })),
      );

      // ===================================================
      // LOCALIZE BRANCH NAME
      // ===================================================

      const localizedBranch = getLocalizedContent(
        review.branch.translations,
        language,
        {
          name: review.branch.name,
        },
      );

      // ===================================================
      // LOCALIZE APPOINTMENT ITEM NAME
      // ===================================================

      const localizedItem = getLocalizedContent(
        review.appointment.itemNameTranslations,
        language,
        {
          name: review.appointment.itemName,
        },
      );

      console.log("\n========== MY REVIEW LOCALIZATION ==========");
      console.log("Requested Language:", language);
      console.log("Appointment ID:", review.appointment.id);
      console.log("Original Item Name:", review.appointment.itemName);

      console.log(
        "Saved Item Translations:",
        JSON.stringify(review.appointment.itemNameTranslations, null, 2),
      );

      console.log("Localized Item Name:", localizedItem.name);
      console.log("============================================");
      // ===================================================
      // RESPONSE
      // ===================================================

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
          name: localizedBranch.name,
        },

        staff: {
          id: review.staff.id,
          name: review.staff.user.name,
        },

        appointment: {
          id: review.appointment.id,

          date: review.appointment.date.toISOString().slice(0, 10),

          startTime: review.appointment.startTime,

          itemName: localizedItem.name,
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

  // =====================================================
  // 5. PAGINATION RESPONSE
  // =====================================================

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

    // TEMPORARY DEBUG - REMOVE AFTER TESTING
    debug: {
      requestedLanguage: language,

      appointments: reviews.map((review) => ({
        appointmentId: review.appointment.id,

        originalItemName: review.appointment.itemName,

        savedTranslations: review.appointment.itemNameTranslations,

        localizedItemName: getLocalizedContent(
          review.appointment.itemNameTranslations,
          language,
          {
            name: review.appointment.itemName,
          },
        ).name,
      })),
    },
  };
};
const getStaffReviews = async (
  staffId: string,
  query: Record<string, any>,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. CHECK STAFF
  // =====================================================

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

  // =====================================================
  // 2. PARSE & VALIDATE QUERY PARAMETERS
  // =====================================================

  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 10);

  if (!Number.isInteger(page) || page < 1) {
    throw new AppError("Page must be a positive integer", 400);
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError("Limit must be between 1 and 100", 400);
  }

  let rating: number | undefined;

  if (query.rating !== undefined && query.rating !== "") {
    rating = Number(query.rating);

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw new AppError("Rating must be between 1 and 5", 400);
    }
  }

  const skip = (page - 1) * limit;

  // =====================================================
  // 3. BUILD REVIEW FILTER
  // =====================================================

  const where = {
    staffId,

    moderationStatus: "VISIBLE" as const,

    ...(rating !== undefined && {
      rating,
    }),
  };

  // =====================================================
  // 4. FETCH REVIEWS & TOTAL COUNT
  // =====================================================

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
            translations: true,
          },
        },

        appointment: {
          select: {
            id: true,
            itemName: true,
            itemNameTranslations: true,
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

  // =====================================================
  // 5. GENERATE SIGNED REVIEW IMAGE URLS
  // =====================================================

  const items = await Promise.all(
    reviews.map(async (review) => {
      const images = await Promise.all(
        review.images.map(async (image) => ({
          objectKey: image.objectKey,

          imageUrl: await uploadService.getImageUrl(image.objectKey),

          sortOrder: image.sortOrder,
        })),
      );

      return {
        id: review.id,

        rating: review.rating,

        comment: review.comment,

        customer: review.customer,

        branch: review.branch,

        appointment: review.appointment,

        images,

        reply: review.replyText
          ? {
              text: review.replyText,
              repliedAt: review.repliedAt,
            }
          : null,

        createdAt: review.createdAt,
      };
    }),
  );

  // =====================================================
  // 6. PAGINATION
  // =====================================================

  const totalPages = Math.ceil(total / limit);

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

// =====================================================
// GET LOGGED-IN STAFF REVIEWS
// =====================================================

const getMyStaffReview = async (
  userId: string,
  query: Record<string, any>,
  language: Language = DEFAULT_LANGUAGE,
) => {
  // =====================================================
  // 1. RESOLVE STAFF ID USING JWT USER ID
  // =====================================================

  const staff = await prisma.staff.findUnique({
    where: {
      userId,
    },

    select: {
      id: true,
    },
  });

  if (!staff) {
    throw new AppError("STAFF_NOT_FOUND", 404);
  }

  // =====================================================
  // 2. REUSE EXISTING STAFF REVIEWS SERVICE
  // =====================================================

  return getStaffReviews(staff.id, query, language);
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
  // 12. MULTILINGUAL MODERATION NOTIFICATION
  // =====================================================

  if (requiresModeration && moderationUpdate) {
    try {
      let type: string;
      let translations: INotificationTranslations;

      if (result.moderationStatus === ReviewModerationStatus.VISIBLE) {
        type = "REVIEW_PUBLISHED";
        translations = notificationTemplates.REVIEW_PUBLISHED(true);
      } else if (result.moderationStatus === ReviewModerationStatus.HIDDEN) {
        type = "REVIEW_NEEDS_CHANGES";
        translations = notificationTemplates.REVIEW_NEEDS_CHANGES(true);
      } else {
        type = "REVIEW_PENDING";
        translations = notificationTemplates.REVIEW_PENDING(true);
      }

      await notificationService.createNotification({
        userId: customerId,
        type,
        title: translations.en!.title!,
        message: translations.en!.message!,
        translations,
      });
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
  // 5. MULTILINGUAL CUSTOMER NOTIFICATION
  // =====================================================

  if (statusChanged) {
    try {
      let type: string;
      let translations: INotificationTranslations;

      if (updatedReview.moderationStatus === ReviewModerationStatus.VISIBLE) {
        type = "REVIEW_PUBLISHED";
        translations = notificationTemplates.REVIEW_PUBLISHED();
      } else if (
        updatedReview.moderationStatus === ReviewModerationStatus.HIDDEN
      ) {
        type = "REVIEW_NEEDS_CHANGES";
        translations = notificationTemplates.REVIEW_NEEDS_CHANGES();
      } else {
        type = "REVIEW_PENDING";
        translations = notificationTemplates.REVIEW_PENDING();
      }

      await notificationService.createNotification({
        userId: review.customerId,
        type,
        title: translations.en!.title!,
        message: translations.en!.message!,
        translations,
      });
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
  // 5. CHECK NEW REPLY OR UPDATE
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
  // 7. CREATE / UPDATE OFFICIAL REPLY
  // =====================================================

  const updatedReview = await prisma.review.update({
    where: {
      id: reviewId,
    },
    data: {
      replyText: payload.reply.trim(),
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
  // 8. MULTILINGUAL CUSTOMER NOTIFICATION
  //
  // Only first reply, not reply edits.
  // =====================================================

  if (isNewReply) {
    try {
      const translations = notificationTemplates.REVIEW_REPLY();

      await notificationService.createNotification({
        userId: review.customerId,
        type: "REVIEW_REPLY",
        title: translations.en!.title!,
        message: translations.en!.message!,
        translations,
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
  getMyStaffReview,
  updateReview,
  deleteReview,
  moderateReview,
  saveReviewReply,
  deleteReviewReply,
};
