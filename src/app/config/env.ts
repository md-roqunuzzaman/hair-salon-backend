import "dotenv/config";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    PORT: z.coerce.number().int().positive().default(5000),

    DATABASE_URL: z.string().url(),

    REDIS_URL: z.string().url(),

    CORS_ORIGIN: z.string().url().default("http://localhost:3000"),

    JWT_ACCESS_SECRET: z.string().min(32),

    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),

    JWT_REFRESH_SECRET: z.string().min(32),

    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    ENABLE_BOOK_NOW_PURCHASE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    SMTP_USER: z.string().min(1).optional(),

    SMTP_PASSWORD: z.string().min(1).optional(),

    EMAIL_SENDER: z.string().min(1).optional(),

    // ==========================================
    // TENCENT CLOUD REVIEW MODERATION
    // ==========================================

    TENCENT_MODERATION_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),

    TENCENT_SECRET_ID: z.string().trim().min(1).optional().or(z.literal("")),

    TENCENT_SECRET_KEY: z.string().trim().min(1).optional().or(z.literal("")),

    TENCENT_REGION: z.string().trim().min(1).default("ap-guangzhou"),

    TENCENT_TMS_BIZ_TYPE: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.TENCENT_MODERATION_ENABLED) {
      return;
    }

    if (!data.TENCENT_SECRET_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["TENCENT_SECRET_ID"],
        message: "Tencent SecretId is required when moderation is enabled",
      });
    }

    if (!data.TENCENT_SECRET_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["TENCENT_SECRET_KEY"],
        message: "Tencent SecretKey is required when moderation is enabled",
      });
    }
  });

export const env = schema.parse(process.env);
