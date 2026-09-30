import { z } from "zod";

const getAdminUsersValidationSchema = z.object({
  body: z.object({
    page: z.coerce.number().int().positive().default(1),

    limit: z.coerce.number().int().positive().max(100).default(20),

    role: z
      .enum(["CUSTOMER", "STAFF", "BRANCH_MANAGER", "BRAND_OWNER"])
      .optional(),

    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),

    q: z.string().trim().optional(),
  }),
});

const updateAdminUserStatusValidationSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "INACTIVE"]),
  }),
});
export const adminUserValidation = {
  getAdminUsersValidationSchema,
  updateAdminUserStatusValidationSchema,
};
