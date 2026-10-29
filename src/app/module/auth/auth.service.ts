import { logUnexpectedError } from "../../utils/normalize-error.js";
import config from "../../config/index.js";
import { prisma } from "../../lib/prisma.js";
import { Role, UserStatus } from "../../../../generated/prisma/client.js";
import {
  IForgotPasswordPayload,
  ILoginUserPayload,
  IRegisterUserPayload,
  IResetPasswordPayload,
  IVerifyResetOtpPayload,
} from "./auth.interface.js";
import bcrypt from "bcrypt";
import { jwtUtils } from "../../utils/jwt.js";
import { JwtPayload, SignOptions } from "jsonwebtoken";
import { redisClient } from "../../lib/redis.js";
import crypto from "crypto";
import ejs from "ejs";
import path from "path";
import { resolveEmailBrand } from '../brand-email-setting/brand-email-setting.sender.js';
import { sendMerchantSecurityEmail } from '../brand-email-setting/brand-email-setting.auth.js';
import { safeEmailError, EmailProviderError } from '../brand-email-setting/brand-email-setting.errors.js';
import { AppError } from "../../utils/app-error.js";

const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const RESET_TOKEN_TTL_SECONDS = 10 * 60; // 10 minutes

const OTP_MAX_ATTEMPTS = 5;

const OTP_RESEND_COOLDOWN_SECONDS = 60; // 1 minute

const FORGOT_PASSWORD_MAX_REQUESTS = 5;
const FORGOT_PASSWORD_WINDOW_SECONDS = 15 * 60; // 15 minutes

const refreshTokenKey = (userId: string, tokenId: string) =>
  `auth:refresh:${userId}:${tokenId}`;

export const invalidateUserRefreshSessions = async (userId: string) => {
  await redisClient.eval(
    `
      local cursor = "0"
      repeat
        local result = redis.call("SCAN", cursor, "MATCH", ARGV[1], "COUNT", 100)
        cursor = result[1]
        if #result[2] > 0 then redis.call("DEL", unpack(result[2])) end
      until cursor == "0"
      return 1
    `,
    { arguments: [`auth:refresh:${userId}:*`], keys: [] },
  );
};
const registerUser = async (payload: IRegisterUserPayload) => {
  const { name, password } = payload;

  const email = payload.email.trim().toLowerCase();
  const phone = payload.phone?.trim();

  const isEmailExists = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (isEmailExists) {
    throw new AppError("User with this email already exists", 409);
  }

  if (phone) {
    const isPhoneExists = await prisma.user.findUnique({
      where: {
        phone,
      },
    });

    if (isPhoneExists) {
      throw new AppError("User with this phone number already exists", 409);
    }
  }

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  const createdUser = await prisma.user.create({
    data: {
      name: name.trim(),
      email,
      phone: phone || null,
      passwordHash: hashedPassword,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
    },

    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return createdUser;
};

const loginUser = async (payload: ILoginUserPayload) => {
  const email = payload.email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!user) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError("User account is inactive", 403);
  }

  const isPasswordMatched = await bcrypt.compare(
    payload.password,
    user.passwordHash,
  );

  if (!isPasswordMatched) {
    throw new AppError("Invalid email or password", 401);
  }

  // Access token payload
  const accessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  // Refresh token payload
  // tokenId makes every refresh token unique
  const refreshTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    jti: crypto.randomUUID(),
  };

  const accessToken = jwtUtils.createToken(
    accessTokenPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions["expiresIn"],
  );

  const refreshToken = jwtUtils.createToken(
    refreshTokenPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions["expiresIn"],
  );

  const sessionKey = refreshTokenKey(user.id, refreshTokenPayload.jti);

  await redisClient.set(sessionKey, "valid", {
    expiration: {
      type: "EX",
      value: jwtUtils.getRemainingLifetimeSeconds(refreshToken),
    },
  });

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
    },

    accessToken,
    refreshToken,
  };
};

const refreshToken = async (token: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    token,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new AppError("Invalid or expired refresh token", 401);
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  const user = await prisma.user.findUnique({
    where: {
      id: data.userId,
    },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new AppError("User is inactive or not found", 401);
  }

  if (typeof data.jti !== "string") {
    throw new AppError("Invalid refresh token", 401);
  }

  const accessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  const newRefreshTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    jti: crypto.randomUUID(),
  };

  const accessToken = jwtUtils.createToken(
    accessTokenPayload,
    config.jwt_access_secret,
    config.jwt_access_expires_in as SignOptions["expiresIn"],
  );

  const newRefreshToken = jwtUtils.createToken(
    newRefreshTokenPayload,
    config.jwt_refresh_secret,
    config.jwt_refresh_expires_in as SignOptions["expiresIn"],
  );

  const oldSessionKey = refreshTokenKey(user.id, data.jti);
  const newSessionKey = refreshTokenKey(user.id, newRefreshTokenPayload.jti);
  const rotated = await redisClient.eval(
    `
      if redis.call("GET", KEYS[1]) then
        redis.call("DEL", KEYS[1])
        redis.call("SET", KEYS[2], "valid", "EX", ARGV[1])
        return 1
      end
      return 0
    `,
    {
      keys: [oldSessionKey, newSessionKey],
      arguments: [String(jwtUtils.getRemainingLifetimeSeconds(newRefreshToken))],
    },
  );

  if (rotated !== 1) {
    throw new AppError("Refresh session expired or invalid", 401);
  }

  return {
    accessToken,
    refreshToken: newRefreshToken,
  };
};

const logoutUser = async (userId: string, refreshToken: string) => {
  const verifiedRefreshToken = jwtUtils.verifyToken(
    refreshToken,
    config.jwt_refresh_secret,
  );

  if (!verifiedRefreshToken.success || !verifiedRefreshToken.data) {
    throw new AppError("Invalid or expired refresh token", 401);
  }

  const data = verifiedRefreshToken.data as JwtPayload;

  if (data.userId !== userId || typeof data.jti !== "string") {
    throw new AppError("Invalid refresh token", 401);
  }

  await redisClient.del(refreshTokenKey(userId, data.jti));

  return null;
};

const forgotPassword = async (payload: IForgotPasswordPayload) => {
  const email = payload.email.trim().toLowerCase();
  let brandId: string | undefined;
  try {
    brandId = await resolveEmailBrand(payload.brandId);
    const suffix = `${brandId}:${email}`;
    const resendKey = `password-reset-resend:${suffix}`;
    const rateLimitKey = `password-reset-rate:${suffix}`;
    const requestCount = await redisClient.incr(rateLimitKey);
    if (requestCount === 1) await redisClient.expire(rateLimitKey, FORGOT_PASSWORD_WINDOW_SECONDS);
    if (requestCount > FORGOT_PASSWORD_MAX_REQUESTS) throw new AppError("Too many password reset requests. Please try again later.", 429);
    const reserved = await redisClient.set(resendKey, '1', { EX: OTP_RESEND_COOLDOWN_SECONDS, NX: true });
    if (!reserved) throw new AppError("Please wait before requesting another OTP", 429);
    const user = await prisma.user.findUnique({ where: { email } });
    // Identical public response/counters for absent and inactive accounts.
    if (!user || user.status !== UserStatus.ACTIVE) return null;
    const otp = crypto.randomInt(100000, 1000000).toString();
    const html = await ejs.renderFile(path.join(process.cwd(), "src/app/templates/forgot-password.ejs"), { name: user.name, otp, expirationMinutes: OTP_TTL_SECONDS / 60 });
    await sendMerchantSecurityEmail({ brandId, userId: user.id, to: user.email, eventType: 'AUTH_PASSWORD_RESET_OTP', subject: 'Reset Your Password', html });
    // No newly valid OTP exists until the merchant provider accepts the message.
    await redisClient.set(`password-reset-otp:${suffix}`, otp, { EX: OTP_TTL_SECONDS });
    await redisClient.del(`password-reset-attempts:${suffix}`);
  } catch (error) {
    if (error instanceof AppError && !(error instanceof EmailProviderError) && error.statusCode === 429) throw error;
    const safe = safeEmailError(error);
    console.error('[Authentication Email]', { code: safe.code, deliveryUncertain: safe.deliveryUncertain, brandId });
  }
  return null;
};

const verifyResetOtp = async (payload: IVerifyResetOtpPayload) => {
  const email = payload.email.trim().toLowerCase();
  let brandId: string;
  try { brandId = await resolveEmailBrand(payload.brandId); }
  catch { throw new AppError('OTP expired or invalid', 400); }

  const otp = payload.otp;

  const user = await prisma.user.findUnique({
    where: {
      email,
    },
  });

  if (!user) {
    throw new AppError("OTP expired or invalid", 400);
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError("OTP expired or invalid", 400);
  }

  const otpKey = `password-reset-otp:${brandId}:${email}`;

  const attemptsKey = `password-reset-attempts:${brandId}:${email}`;

  /*
   * 1. Check OTP exists.
   */
  const storedOtp = await redisClient.get(otpKey);

  if (!storedOtp) {
    throw new AppError("OTP expired or invalid", 400);
  }

  /*
   * 2. Check existing failed attempts.
   */
  const currentAttempts = Number((await redisClient.get(attemptsKey)) || 0);

  if (currentAttempts >= OTP_MAX_ATTEMPTS) {
    await redisClient.del(otpKey);
    await redisClient.del(attemptsKey);

    throw new AppError(
      "Too many incorrect OTP attempts. Please request a new OTP.",
      429,
    );
  }

  /*
   * 3. Wrong OTP
   */
  if (storedOtp !== otp) {
    const attempts = await redisClient.incr(attemptsKey);

    /*
     * Attempt counter should expire
     * when the OTP expires.
     */
    if (attempts === 1) {
      const otpTtl = await redisClient.ttl(otpKey);

      if (otpTtl > 0) {
        await redisClient.expire(attemptsKey, otpTtl);
      }
    }

    /*
     * Fifth wrong attempt:
     * invalidate OTP completely.
     */
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await redisClient.del(otpKey);

      await redisClient.del(attemptsKey);

      throw new AppError(
        "Too many incorrect OTP attempts. Please request a new OTP.",
        429,
      );
    }

    const remainingAttempts = OTP_MAX_ATTEMPTS - attempts;

    throw new AppError(
      `Invalid OTP. ${remainingAttempts} attempts remaining.`,
      400,
    );
  }

  /*
   * 4. Correct OTP
   *
   * Delete OTP + attempt counter.
   */
  await redisClient.del(otpKey);
  await redisClient.del(attemptsKey);

  /*
   * 5. Generate reset token
   */
  const resetToken = crypto.randomBytes(32).toString("hex");

  const resetTokenKey = `password-reset-token:${resetToken}`;

  await redisClient.set(resetTokenKey, JSON.stringify({ userId: user.id, brandId }), {
    expiration: {
      type: "EX",
      value: RESET_TOKEN_TTL_SECONDS,
    },
  });

  return {
    resetToken,
    expiresIn: RESET_TOKEN_TTL_SECONDS,
  };
};

const resetPassword = async (payload: IResetPasswordPayload) => {
  const { resetToken, newPassword } = payload;

  const resetTokenKey = `password-reset-token:${resetToken}`;

  const stored = await redisClient.getDel(resetTokenKey);
  let userId = stored;
  const brandId = await resolveEmailBrand();
  if (stored?.startsWith('{')) {
    try {
      const token = JSON.parse(stored) as { userId: string; brandId: string };
      if (token.brandId !== brandId || typeof token.userId !== 'string') throw new Error();
      userId = token.userId;
    } catch { throw new AppError('Reset token expired or invalid', 400); }
  }

  if (!userId) {
    throw new AppError("Reset token expired or invalid", 400);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new AppError("User does not exist", 404);
  }

  if (user.status !== UserStatus.ACTIVE) {
    throw new AppError("User account is inactive", 403);
  }

  const hashedPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds),
  );

  await prisma.user.update({
    where: {
      id: user.id,
    },
    data: {
      passwordHash: hashedPassword,
    },
  });

  await invalidateUserRefreshSessions(user.id);

  // Password reset success email
  const templatePath = path.join(
    process.cwd(),
    "src/app/templates/reset-password.ejs",
  );

  const html = await ejs.renderFile(templatePath, {
    name: user.name,
  });

  try {
    await sendMerchantSecurityEmail({
      brandId, userId: user.id, eventType: 'AUTH_PASSWORD_RESET_SUCCESS',
      to: user.email,
      subject: "Password Reset Successful",
      html,
    });
  } catch (error) {
    logUnexpectedError(error, { source: "src/app/module/auth/auth.service.ts:574" });
  }

  return null;
};
export const authService = {
  registerUser,
  loginUser,
  refreshToken,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  logoutUser,
};
