import { redisClient } from '../../lib/redis.js';
import { AppError } from '../../utils/app-error.js';
import { catchAsync } from '../../utils/catchAsync.js';

export const emailRateLimit = (action: string, limit = 5) => catchAsync(async (req, res, next) => {
  const window = Math.floor(Date.now() / 900000);
  const key = `merchant-email-rate:${req.params.brandId}:${req.user!.userId}:${action}:${window}`;
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, 900);
  if (count > limit) { res.setHeader('Retry-After', '900'); throw new AppError('EMAIL_RATE_LIMITED', 429); }
  next();
});
