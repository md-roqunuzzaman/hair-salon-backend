import { env as bindings } from 'cloudflare:workers';
import { z } from 'zod';
// Make existing integration configuration available before app modules evaluate.
for (const [key, value] of Object.entries(bindings)) {
  if (typeof value === 'string') process.env[key] = value;
}
export const env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().default('postgresql://unused/unused'),
  REDIS_URL: z.string().default('redis://unused'),
  CORS_ORIGIN: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  EMAIL_SENDER: z.string().min(1),
  ENABLE_BOOK_NOW_PURCHASE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(),
}).parse(process.env);
