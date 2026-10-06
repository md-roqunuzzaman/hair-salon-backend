import { z } from "zod";

const presignImageUploadValidationSchema = z.object({
  body: z.object({
    fileName: z.string().trim().min(1, "File name is required"),

    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),

    fileSize: z
      .number()
      .positive()
      .max(5 * 1024 * 1024, "Image must not exceed 5 MB"),

    purpose: z.enum([
      "USER_AVATAR",
      "BRAND_LOGO",
      "BRANCH_IMAGE",
      "SERVICE_IMAGE",
      "PACKAGE_IMAGE",
      "STAFF_IMAGE",
      "REVIEW_IMAGE",
      "PROMOTION_IMAGE",
    ]),

    entityId: z.string().trim().min(1, "Entity ID is required"),
  }),
});

const confirmImageUploadValidationSchema = z.object({
  body: z.object({
    objectKey: z.string().trim().min(1, "Object key is required"),

    purpose: z.enum([
      "USER_AVATAR",
      "BRAND_LOGO",
      "BRANCH_IMAGE",
      "SERVICE_IMAGE",
      "PACKAGE_IMAGE",
      "STAFF_IMAGE",
      "REVIEW_IMAGE",
      "PROMOTION_IMAGE",
    ]),

    entityId: z.string().trim().min(1, "Entity ID is required"),
  }),
});

const deleteImageValidationSchema = z.object({
  body: z.object({
    objectKey: z.string().trim().min(1, "Object key is required"),
  }),
});

export const uploadValidation = {
  presignImageUploadValidationSchema,
  confirmImageUploadValidationSchema,
  deleteImageValidationSchema,
};
