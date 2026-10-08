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
]);

// Expected:
// folder/entityId/fileName.ext
const objectKeySchema = z
  .string()
  .trim()
  .min(1, "Object key is required")
  .max(1024, "Object key is too long")
  .regex(
    /^(users|brands|branches|services|packages|staff|reviews|promotions)\/[^/]+\/[^/]+$/,
    "Invalid image object key",
  );

// =====================================================
// PRESIGN
// =====================================================

const presignImageUploadValidationSchema = z.object({
  body: z.object({
    fileName: z
      .string()
      .trim()
      .min(1, "File name is required")
      .max(255, "File name is too long"),

    contentType: imageContentTypeSchema,

    fileSize: z
      .number()
      .int("File size must be an integer")
      .positive("File size must be greater than 0")
      .max(MAX_IMAGE_SIZE_BYTES, "Image must not exceed 5 MB"),

    purpose: imagePurposeSchema,

    entityId: z.string().trim().uuid("Invalid entity ID"),
  }),
});

// =====================================================
// CONFIRM
// =====================================================

const confirmImageUploadValidationSchema = z.object({
  body: z.object({
    objectKey: objectKeySchema,

    purpose: imagePurposeSchema,

    entityId: z.string().trim().uuid("Invalid entity ID"),
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
