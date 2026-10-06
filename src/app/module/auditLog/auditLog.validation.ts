import { z } from "zod";

const getAuditLogsValidationSchema = z.object({
  body: z.object({
    page: z.coerce.number().int().positive().default(1),

    limit: z.coerce.number().int().positive().max(100).default(20),

    userId: z.string().trim().optional(),

    action: z.string().trim().optional(),

    entityType: z.string().trim().optional(),

    entityId: z.string().trim().optional(),

    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),

    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
});

export const auditLogValidation = {
  getAuditLogsValidationSchema,
};
