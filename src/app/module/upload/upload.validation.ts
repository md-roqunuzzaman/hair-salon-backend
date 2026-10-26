import { z } from "zod";

// =====================================================
// CONSTANTS
// =====================================================

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const imageContentTypeSchema = z.enum([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const imagePurposeSchema = z.enum([
  "USER_AVATAR",
  "BRAND_LOGO",
  "BRANCH_IMAGE",
  "SERVICE_IMAGE",
  "PACKAGE_IMAGE",
  "STAFF_IMAGE",
  "REVIEW_IMAGE",
  "PROMOTION_IMAGE",
  "BANNER_MEDIA",
]);
// Expected:
// folder/entityId/fileName.ext
const objectKeySchema = z
  .string()
  .trim()
  .min(1, "Object key is required")
  .max(1024, "Object key is too long")
  .regex(
    /^(users|brands|branches|services|packages|staff|reviews|promotions|banners)\/[^/]+\/[^/]+$/,
    "Invalid image or banner media object key",
  );
// =====================================================
// PRESIGN
// =====================================================

const presignImageUploadValidationSchema = z.object({
  body: z
    .object({
      fileName: z
        .string()
        .trim()
        .min(1, "File name is required")
        .max(255, "File name is too long"),

      contentType: z.enum([
        "image/jpeg",
        "image/png",
        "image/webp",
        "video/mp4",
      ]),

      fileSize: z
        .number()
        .int("File size must be an integer")
        .positive("File size must be greater than 0"),

      purpose: z.enum([
        "USER_AVATAR",
        "BRAND_LOGO",
        "BRANCH_IMAGE",
        "SERVICE_IMAGE",
        "PACKAGE_IMAGE",
        "STAFF_IMAGE",
        "REVIEW_IMAGE",
        "PROMOTION_IMAGE",
        "BANNER_MEDIA",
      ]),

      entityId: z.string().trim().uuid("Invalid entity ID"),
    })
    .superRefine((data, ctx) => {
      const MAX_BANNER_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;

      // Banner supports JPEG images and MP4 videos.
      if (data.purpose === "BANNER_MEDIA") {
        if (
          data.contentType !== "image/jpeg" &&
          data.contentType !== "video/mp4"
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["contentType"],
            message: "Banner media must be JPEG or MP4",
          });
        }

        const isVideo = data.contentType === "video/mp4";

        const maxSize = isVideo
          ? MAX_BANNER_VIDEO_SIZE_BYTES
          : MAX_IMAGE_SIZE_BYTES;

        if (data.fileSize > maxSize) {
          ctx.addIssue({
            code: "custom",
            path: ["fileSize"],
            message: isVideo
              ? "Banner video must not exceed 50 MB"
              : "Banner image must not exceed 5 MB",
          });
        }

        return;
      }

      // Preserve existing image-only upload behavior.
      if (!imageContentTypeSchema.safeParse(data.contentType).success) {
        ctx.addIssue({
          code: "custom",
          path: ["contentType"],
          message: "Only JPEG, PNG and WebP images are allowed",
        });
      }

      if (data.fileSize > MAX_IMAGE_SIZE_BYTES) {
        ctx.addIssue({
          code: "custom",
          path: ["fileSize"],
          message: "Image must not exceed 5 MB",
        });
      }
    }),
});
// =====================================================
// CONFIRM
// =====================================================

const confirmImageUploadValidationSchema = z.object({
  body: z
    .object({
      objectKey: objectKeySchema,

      purpose: imagePurposeSchema,

      entityId: z.string().trim().uuid("Invalid entity ID"),
    })
    .superRefine((data, ctx) => {
      const parts = data.objectKey.split("/");

      if (parts.length !== 3) {
        ctx.addIssue({
          code: "custom",
          path: ["objectKey"],
          message: "Invalid object key structure",
        });

        return;
      }

      const [folder, entityId] = parts;

      const purposeFolderMap: Record<
        z.infer<typeof imagePurposeSchema>,
        string
      > = {
        USER_AVATAR: "users",
        BRAND_LOGO: "brands",
        BRANCH_IMAGE: "branches",
        SERVICE_IMAGE: "services",
        PACKAGE_IMAGE: "packages",
        STAFF_IMAGE: "staff",
        REVIEW_IMAGE: "reviews",
        PROMOTION_IMAGE: "promotions",
        BANNER_MEDIA: "banners",
      };

      if (
        folder !== purposeFolderMap[data.purpose] ||
        entityId !== data.entityId
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["objectKey"],
          message: "Object key does not match purpose or entity ID",
        });
      }
    }),
});

// =====================================================
// DELETE
// =====================================================

const deleteImageValidationSchema = z.object({
  body: z.object({
    objectKey: objectKeySchema,
  }),
});

// =====================================================
// EXPORT
// =====================================================

export const uploadValidation = {
  presignImageUploadValidationSchema,
  confirmImageUploadValidationSchema,
  deleteImageValidationSchema,
};
