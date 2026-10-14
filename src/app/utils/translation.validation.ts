import { z } from "zod";

export const localizedTextSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().nullable().optional(),
});

export const translationsSchema = z
  .object({
    en: localizedTextSchema.optional(),
    "zh-CN": localizedTextSchema.optional(),
    "zh-HK": localizedTextSchema.optional(),
  })
  .strict();
