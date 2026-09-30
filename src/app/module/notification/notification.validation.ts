import { z } from "zod";

const getNotificationsValidationSchema = z.object({
  body: z.object({
    page: z.coerce.number().int().positive().default(1),

    limit: z.coerce.number().int().positive().max(100).default(20),

    unreadOnly: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  }),
});

export const notificationValidation = {
  getNotificationsValidationSchema,
};
