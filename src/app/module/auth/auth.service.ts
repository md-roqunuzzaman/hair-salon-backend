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
import { resolveEmailBrand } from "../brand-email-setting/brand-email-setting.sender.js";
import { sendMerchantSecurityEmail } from "../brand-email-setting/brand-email-setting.auth.js";
import {
  safeEmailError,
  EmailProviderError,
} from "../brand-email-setting/brand-email-setting.errors.js";
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

const hashEmailVerificationOtp = (userId: string, otp: string): string => {
  const secret = config.jwt_access_secret;

  if (typeof secret !== "string" || secret.length < 32) {
    throw new AppError(
      "Email verification security configuration is invalid",
      500,
    );
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`email-verification:${userId}:${otp}`)
    .digest("hex");
};

const hashPasswordResetOtp = (userId: string, otp: string): string => {
  const secret = config.jwt_access_secret;

  if (typeof secret !== "string" || secret.length < 32) {
    throw new AppError("Password reset security configuration is invalid", 500);
  }

  return crypto
    .createHmac("sha256", secret)
    .update(`password-reset:${userId}:${otp}`)
    .digest("hex");
};

const registerUser = async (payload: IRegisterUserPayload) => {
  const { name, password } = payload;

  const normalizedName = name.trim();
  const email = payload.email.trim().toLowerCase();
  const phone = payload.phone?.trim() || null;

  // =====================================================
  // 1. CHECK EXISTING EMAIL
  // =====================================================

  const isEmailExists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (isEmailExists) {
    throw new AppError("User with this email already exists", 409);
  }

  // =====================================================
  // 2. CHECK EXISTING PHONE
  // =====================================================

  if (phone) {
    const isPhoneExists = await prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });

    if (isPhoneExists) {
      throw new AppError("User with this phone number already exists", 409);
    }
  }

  // =====================================================
  // 3. RESOLVE BRAND
  // =====================================================

  const brandId = await resolveEmailBrand();

  const brand = await prisma.brand.findUnique({
    where: { id: brandId },
    select: { name: true },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // =====================================================
  // 4. GENERATE OTP
  // =====================================================

  const otp = crypto.randomInt(100000, 1000000).toString();

  // =====================================================
  // 5. RENDER EMAIL BEFORE CREATING USER
  // =====================================================

  const html = await ejs.renderFile(
    path.join(process.cwd(), "src/app/templates/verify-email.ejs"),
    {
      name: normalizedName,
      brandName: brand.name,
      year: new Date().getFullYear(),
      otp,
      expirationMinutes: OTP_TTL_SECONDS / 60,
    },
  );

  // =====================================================
  // 6. HASH PASSWORD
  // =====================================================

  const hashedPassword = await bcrypt.hash(
    password,
    Number(config.bcrypt_salt_rounds),
  );

  // =====================================================
  // 7. CREATE UNVERIFIED CUSTOMER
  // =====================================================

  const createdUser = await prisma.user.create({
    data: {
      name: normalizedName,
      email,
      phone,
      passwordHash: hashedPassword,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: false,
      emailVerifiedAt: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      status: true,
      emailVerified: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  // =====================================================
  // 8. PREPARE OTP KEYS AND HASH
  // =====================================================

  const suffix = `${brandId}:${email}`;

  const otpKey = `email-verification-otp:${suffix}`;
  const attemptsKey = `email-verification-attempts:${suffix}`;

  const otpHash = hashEmailVerificationOtp(createdUser.id, otp);

  // =====================================================
  // 9. STORE OTP ATOMICALLY
  // =====================================================

  try {
    await redisClient.eval(
      `
        redis.call(
          "SET",
          KEYS[1],
          ARGV[1],
          "EX",
          tonumber(ARGV[2])
        )

        redis.call("DEL", KEYS[2])

        return 1
      `,
      {
        keys: [otpKey, attemptsKey],
        arguments: [otpHash, String(OTP_TTL_SECONDS)],
      },
    );
  } catch (error) {
    // The account remains unverified and can recover
    // through the resend-verification endpoint.
    logUnexpectedError(error, {
      source: "auth.registerUser.redisOtp",
    });

    throw new AppError(
      "Registration could not be completed. Please try signing in or requesting a verification code.",
      503,
    );
  }

  // =====================================================
  // 10. SEND VERIFICATION EMAIL
  // =====================================================

  try {
    await sendMerchantSecurityEmail({
      brandId,
      userId: createdUser.id,
      to: createdUser.email,
      eventType: "AUTH_EMAIL_VERIFICATION_OTP",
      subject: `Verify Your Email - ${brand.name}`,
      html,
    });
  } catch (error) {
    // Preserve unverified account and OTP.
    // Customer can request another OTP later.
    const safe = safeEmailError(error);

    console.error("[Registration Verification Email]", {
      code: safe.code,
      deliveryUncertain: safe.deliveryUncertain,
      brandId,
    });
  }

  // =====================================================
  // 11. RETURN REGISTRATION RESULT
  // =====================================================

  return createdUser;
};

const verifyEmailOtp = async (payload: { email: string; otp: string }) => {
  const email = payload.email.trim().toLowerCase();
  const otp = payload.otp;

  const brandId = await resolveEmailBrand();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
    },
  });

  if (
    !user ||
    user.role !== Role.CUSTOMER ||
    user.status !== UserStatus.ACTIVE
  ) {
    throw new AppError("OTP expired or invalid", 400);
  }

  if (user.emailVerified) {
    throw new AppError("Email is already verified", 409);
  }

  const otpKey = `email-verification-otp:${brandId}:${email}`;
  const attemptsKey = `email-verification-attempts:${brandId}:${email}`;
  const lockKey = `email-verification-lock:${brandId}:${email}`;

  const otpHash = hashEmailVerificationOtp(user.id, otp);

  // Acquire a short-lived verification lock.
  const lockToken = crypto.randomUUID();

  const acquired = await redisClient.set(lockKey, lockToken, {
    NX: true,
    EX: 15,
  });

  if (!acquired) {
    throw new AppError(
      "Verification is already in progress. Please try again.",
      409,
    );
  }

  try {
    // Atomically validate the OTP and track failed attempts.
    // Keep the correct OTP until the database update succeeds.
    const result = await redisClient.eval(
      `
        local stored = redis.call("GET", KEYS[1])

        if not stored then
          return -1
        end

        local attempts = tonumber(redis.call("GET", KEYS[2]) or "0")
        local maxAttempts = tonumber(ARGV[2])

        if attempts >= maxAttempts then
          redis.call("DEL", KEYS[1], KEYS[2])
          return -2
        end

        if stored ~= ARGV[1] then
          attempts = redis.call("INCR", KEYS[2])

          if attempts == 1 then
            local ttl = redis.call("TTL", KEYS[1])

            if ttl > 0 then
              redis.call("EXPIRE", KEYS[2], ttl)
            end
          end

          if attempts >= maxAttempts then
            redis.call("DEL", KEYS[1], KEYS[2])
            return -2
          end

          return maxAttempts - attempts
        end

        return 0
      `,
      {
        keys: [otpKey, attemptsKey],
        arguments: [otpHash, String(OTP_MAX_ATTEMPTS)],
      },
    );

    if (result === -1) {
      throw new AppError("OTP expired or invalid", 400);
    }

    if (result === -2) {
      throw new AppError(
        "Too many incorrect OTP attempts. Please request a new OTP.",
        429,
      );
    }

    if (typeof result === "number" && result > 0) {
      throw new AppError(`Invalid OTP. ${result} attempts remaining.`, 400);
    }

    if (result !== 0) {
      throw new AppError("OTP verification failed", 500);
    }

    // Update the database before consuming the OTP.
    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        role: Role.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: false,
      },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      throw new AppError(
        "Email is already verified or account is unavailable",
        409,
      );
    }

    // Consume only the OTP that was actually verified.
    await redisClient.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          redis.call("DEL", KEYS[1], KEYS[2])
        end

        return 1
      `,
      {
        keys: [otpKey, attemptsKey],
        arguments: [otpHash],
      },
    );

    return {
      email: user.email,
      emailVerified: true,
      message: "Email verified successfully. You can now log in.",
    };
  } finally {
    // Release only the lock owned by this request.
    await redisClient.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end

        return 0
      `,
      {
        keys: [lockKey],
        arguments: [lockToken],
      },
    );
  }
};

const resendVerificationOtp = async (payload: { email: string }) => {
  const email = payload.email.trim().toLowerCase();

  // =====================================================
  // 1. RESOLVE BRAND
  // =====================================================

  const brandId = await resolveEmailBrand();

  const suffix = `${brandId}:${email}`;

  const otpKey = `email-verification-otp:${suffix}`;
  const attemptsKey = `email-verification-attempts:${suffix}`;
  const cooldownKey = `email-verification-resend:${suffix}`;
  const rateLimitKey = `email-verification-rate:${suffix}`;
  const lockKey = `email-verification-lock:${suffix}`;

  const genericResponse = {
    message:
      "If this email requires verification, a verification code will be sent.",
  };

  // =====================================================
  // 2. ATOMIC RATE LIMIT + COOLDOWN
  // =====================================================

  const rateResult = await redisClient.eval(
    `
      local count = redis.call("INCR", KEYS[1])

      if count == 1 then
        redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
      end

      if count > tonumber(ARGV[2]) then
        return -1
      end

      local reserved = redis.call(
        "SET",
        KEYS[2],
        "1",
        "NX",
        "EX",
        tonumber(ARGV[3])
      )

      if not reserved then
        return -2
      end

      return 1
    `,
    {
      keys: [rateLimitKey, cooldownKey],
      arguments: [
        String(FORGOT_PASSWORD_WINDOW_SECONDS),
        String(FORGOT_PASSWORD_MAX_REQUESTS),
        String(OTP_RESEND_COOLDOWN_SECONDS),
      ],
    },
  );

  if (rateResult === -1) {
    throw new AppError(
      "Too many verification requests. Please try again later.",
      429,
    );
  }

  if (rateResult === -2) {
    throw new AppError(
      "Please wait 60 seconds before requesting another OTP",
      429,
    );
  }

  if (rateResult !== 1) {
    throw new AppError("Unable to process verification request", 500);
  }

  // =====================================================
  // 3. FIND ELIGIBLE CUSTOMER
  // =====================================================

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      emailVerified: true,
    },
  });

  // Avoid revealing whether an email belongs to an account.
  if (
    !user ||
    user.role !== Role.CUSTOMER ||
    user.status !== UserStatus.ACTIVE ||
    user.emailVerified
  ) {
    return genericResponse;
  }

  // =====================================================
  // 4. ACQUIRE SHARED VERIFICATION LOCK
  // =====================================================

  const lockToken = crypto.randomUUID();

  const acquired = await redisClient.set(lockKey, lockToken, {
    NX: true,
    EX: 30,
  });

  if (!acquired) {
    // Another verification/resend operation is in progress.
    return genericResponse;
  }

  try {
    // =====================================================
    // 5. RECHECK CUSTOMER UNDER LOCK
    // =====================================================

    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        emailVerified: true,
      },
    });

    if (
      !currentUser ||
      currentUser.role !== Role.CUSTOMER ||
      currentUser.status !== UserStatus.ACTIVE ||
      currentUser.emailVerified
    ) {
      return genericResponse;
    }

    // =====================================================
    // 6. RESOLVE BRAND NAME
    // =====================================================

    const brand = await prisma.brand.findUnique({
      where: { id: brandId },
      select: { name: true },
    });

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    // =====================================================
    // 7. GENERATE OTP
    // =====================================================

    const otp = crypto.randomInt(100000, 1000000).toString();

    // Keep the same hashing algorithm as register/verify.
    const otpHash = hashEmailVerificationOtp(currentUser.id, otp);

    // =====================================================
    // 8. RENDER EMAIL
    // =====================================================

    const html = await ejs.renderFile(
      path.join(process.cwd(), "src/app/templates/verify-email.ejs"),
      {
        name: currentUser.name,
        brandName: brand.name,
        year: new Date().getFullYear(),
        otp,
        expirationMinutes: OTP_TTL_SECONDS / 60,
      },
    );

    // =====================================================
    // 9. SEND EMAIL
    // =====================================================

    try {
      await sendMerchantSecurityEmail({
        brandId,
        userId: currentUser.id,
        to: currentUser.email,
        eventType: "AUTH_EMAIL_VERIFICATION_OTP",
        subject: `Verify Your Email - ${brand.name}`,
        html,
      });
    } catch (error) {
      const safe = safeEmailError(error);

      console.error("[Resend Verification Email]", {
        code: safe.code,
        deliveryUncertain: safe.deliveryUncertain,
        brandId,
      });

      // Preserve existing OTP when delivery fails.
      return genericResponse;
    }

    // =====================================================
    // 10. REPLACE OTP ATOMICALLY
    // =====================================================

    await redisClient.eval(
      `
        redis.call(
          "SET",
          KEYS[1],
          ARGV[1],
          "EX",
          tonumber(ARGV[2])
        )

        redis.call("DEL", KEYS[2])

        return 1
      `,
      {
        keys: [otpKey, attemptsKey],
        arguments: [otpHash, String(OTP_TTL_SECONDS)],
      },
    );

    return genericResponse;
  } finally {
    // Release only our own lock.
    await redisClient.eval(
      `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        end

        return 0
      `,
      {
        keys: [lockKey],
        arguments: [lockToken],
      },
    );
  }
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

  // =====================================================
  // EMAIL VERIFICATION CHECK — CUSTOMER ONLY
  // =====================================================

  if (user.role === Role.CUSTOMER && !user.emailVerified) {
    throw new AppError(
      "Email is not verified. Please verify your email using the OTP sent to your inbox.",
      403,
    );
  }

  // =====================================================
  // ACCESS TOKEN PAYLOAD
  // =====================================================

  const accessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  // =====================================================
  // REFRESH TOKEN PAYLOAD
  // =====================================================

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
      emailVerified: user.emailVerified,
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

  // =====================================================
  // EMAIL VERIFICATION CHECK — CUSTOMER ONLY
  // =====================================================

  if (user.role === Role.CUSTOMER && !user.emailVerified) {
    throw new AppError(
      "Email is not verified. Please verify your email before continuing.",
      403,
    );
  }

  if (typeof data.jti !== "string") {
    throw new AppError("Invalid refresh token", 401);
  }

  // =====================================================
  // ACCESS TOKEN PAYLOAD
  // =====================================================

  const accessTokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };

  // =====================================================
  // REFRESH TOKEN PAYLOAD
  // =====================================================

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
      arguments: [
        String(jwtUtils.getRemainingLifetimeSeconds(newRefreshToken)),
      ],
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
    // =====================================================
    // 1. RESOLVE BRAND
    // =====================================================

    brandId = await resolveEmailBrand(payload.brandId);

    const suffix = `${brandId}:${email}`;

    const otpKey = `password-reset-otp:${suffix}`;
    const attemptsKey = `password-reset-attempts:${suffix}`;
    const resendKey = `password-reset-resend:${suffix}`;
    const rateLimitKey = `password-reset-rate:${suffix}`;

    // =====================================================
    // 2. ATOMIC RATE LIMIT + COOLDOWN
    // =====================================================

    const rateResult = await redisClient.eval(
      `
        local count = redis.call("INCR", KEYS[1])

        if count == 1 then
          redis.call(
            "EXPIRE",
            KEYS[1],
            tonumber(ARGV[1])
          )
        end

        if count > tonumber(ARGV[2]) then
          return -1
        end

        local reserved = redis.call(
          "SET",
          KEYS[2],
          "1",
          "NX",
          "EX",
          tonumber(ARGV[3])
        )

        if not reserved then
          return -2
        end

        return 1
      `,
      {
        keys: [rateLimitKey, resendKey],
        arguments: [
          String(FORGOT_PASSWORD_WINDOW_SECONDS),
          String(FORGOT_PASSWORD_MAX_REQUESTS),
          String(OTP_RESEND_COOLDOWN_SECONDS),
        ],
      },
    );

    if (rateResult === -1) {
      throw new AppError(
        "Too many password reset requests. Please try again later.",
        429,
      );
    }

    if (rateResult === -2) {
      throw new AppError("Please wait before requesting another OTP", 429);
    }

    if (rateResult !== 1) {
      throw new AppError("Unable to process password reset request", 500);
    }

    // =====================================================
    // 3. FIND ACTIVE USER
    // =====================================================

    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
      },
    });

    // Keep the public response identical for
    // nonexistent or inactive accounts.
    if (!user || user.status !== UserStatus.ACTIVE) {
      return null;
    }

    // =====================================================
    // 4. GENERATE OTP
    // =====================================================

    const otp = crypto.randomInt(100000, 1000000).toString();

    const otpHash = hashPasswordResetOtp(user.id, otp);

    // =====================================================
    // 5. RENDER EMAIL TEMPLATE
    // =====================================================

    const html = await ejs.renderFile(
      path.join(process.cwd(), "src/app/templates/forgot-password.ejs"),
      {
        name: user.name,
        otp,
        expirationMinutes: OTP_TTL_SECONDS / 60,
      },
    );

    // =====================================================
    // 6. SEND PASSWORD RESET EMAIL
    // =====================================================

    await sendMerchantSecurityEmail({
      brandId,
      userId: user.id,
      to: user.email,
      eventType: "AUTH_PASSWORD_RESET_OTP",
      subject: "Reset Your Password",
      html,
    });

    // =====================================================
    // 7. STORE HMAC OTP ATOMICALLY
    // =====================================================

    await redisClient.eval(
      `
        redis.call(
          "SET",
          KEYS[1],
          ARGV[1],
          "EX",
          tonumber(ARGV[2])
        )

        redis.call("DEL", KEYS[2])

        return 1
      `,
      {
        keys: [otpKey, attemptsKey],
        arguments: [otpHash, String(OTP_TTL_SECONDS)],
      },
    );
  } catch (error) {
    // Preserve rate-limit errors.
    if (
      error instanceof AppError &&
      !(error instanceof EmailProviderError) &&
      error.statusCode === 429
    ) {
      throw error;
    }

    const safe = safeEmailError(error);

    console.error("[Authentication Email]", {
      code: safe.code,
      deliveryUncertain: safe.deliveryUncertain,
      brandId,
    });
  }

  return null;
};

const verifyResetOtp = async (payload: IVerifyResetOtpPayload) => {
  const email = payload.email.trim().toLowerCase();

  // =====================================================
  // 1. RESOLVE BRAND
  // =====================================================

  let brandId: string;

  try {
    brandId = await resolveEmailBrand(payload.brandId);
  } catch {
    throw new AppError("OTP expired or invalid", 400);
  }

  // =====================================================
  // 2. FIND ACTIVE USER
  // =====================================================

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      status: true,
    },
  });

  if (!user || user.status !== UserStatus.ACTIVE) {
    throw new AppError("OTP expired or invalid", 400);
  }

  // =====================================================
  // 3. PREPARE REDIS KEYS
  // =====================================================

  const suffix = `${brandId}:${email}`;

  const otpKey = `password-reset-otp:${suffix}`;
  const attemptsKey = `password-reset-attempts:${suffix}`;

  const otpHash = hashPasswordResetOtp(user.id, payload.otp);

  // =====================================================
  // 4. GENERATE SECURE RESET TOKEN
  // =====================================================

  const resetToken = crypto.randomBytes(32).toString("hex");

  const resetTokenKey = `password-reset-token:${resetToken}`;

  // =====================================================
  // 5. ATOMIC OTP VERIFICATION
  // =====================================================

  const result = await redisClient.eval(
    `
      local stored = redis.call("GET", KEYS[1])

      if not stored then
        return -1
      end

      local attempts = tonumber(
        redis.call("GET", KEYS[2]) or "0"
      )

      local maxAttempts = tonumber(ARGV[2])

      if attempts >= maxAttempts then
        redis.call("DEL", KEYS[1], KEYS[2])
        return -2
      end

      if stored ~= ARGV[1] then
        attempts = redis.call("INCR", KEYS[2])

        if attempts == 1 then
          local ttl = redis.call("TTL", KEYS[1])

          if ttl > 0 then
            redis.call("EXPIRE", KEYS[2], ttl)
          end
        end

        if attempts >= maxAttempts then
          redis.call("DEL", KEYS[1], KEYS[2])
          return -2
        end

        return maxAttempts - attempts
      end

      -- Correct OTP: create reset token before
      -- consuming the OTP, in one atomic script.

      redis.call(
        "SET",
        KEYS[3],
        ARGV[3],
        "EX",
        tonumber(ARGV[4])
      )

      redis.call("DEL", KEYS[1], KEYS[2])

      return 0
    `,
    {
      keys: [otpKey, attemptsKey, resetTokenKey],
      arguments: [
        otpHash,
        String(OTP_MAX_ATTEMPTS),
        JSON.stringify({
          userId: user.id,
          brandId,
        }),
        String(RESET_TOKEN_TTL_SECONDS),
      ],
    },
  );

  // =====================================================
  // 6. HANDLE VERIFICATION RESULT
  // =====================================================

  if (result === -1) {
    throw new AppError("OTP expired or invalid", 400);
  }

  if (result === -2) {
    throw new AppError(
      "Too many incorrect OTP attempts. Please request a new OTP.",
      429,
    );
  }

  if (typeof result === "number" && result > 0) {
    throw new AppError(`Invalid OTP. ${result} attempts remaining.`, 400);
  }

  if (result !== 0) {
    throw new AppError("OTP verification failed", 500);
  }

  // =====================================================
  // 7. RETURN RESET TOKEN
  // =====================================================

  return {
    resetToken,
    expiresIn: RESET_TOKEN_TTL_SECONDS,
  };
};

const resetPassword = async (payload: IResetPasswordPayload) => {
  const { resetToken, newPassword } = payload;

  // =====================================================
  // 1. VALIDATE RESET TOKEN FORMAT
  // =====================================================

  if (typeof resetToken !== "string" || !/^[a-f0-9]{64}$/i.test(resetToken)) {
    throw new AppError("Reset token expired or invalid", 400);
  }

  const resetTokenKey = `password-reset-token:${resetToken}`;

  const lockKey = `password-reset-lock:${resetToken}`;

  const lockToken = crypto.randomUUID();

  // =====================================================
  // 2. ACQUIRE RESET LOCK
  // =====================================================

  const acquired = await redisClient.set(lockKey, lockToken, {
    NX: true,
    EX: 60,
  });

  if (!acquired) {
    throw new AppError(
      "Password reset is already in progress. Please try again.",
      409,
    );
  }

  try {
    // =====================================================
    // 3. READ RESET TOKEN WITHOUT CONSUMING IT
    // =====================================================

    const stored = await redisClient.get(resetTokenKey);

    if (!stored) {
      throw new AppError("Reset token expired or invalid", 400);
    }

    // =====================================================
    // 4. VALIDATE TOKEN PAYLOAD AND BRAND
    // =====================================================

    let tokenData: {
      userId: string;
      brandId: string;
    };

    try {
      const parsed: unknown = JSON.parse(stored);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("userId" in parsed) ||
        !("brandId" in parsed) ||
        typeof parsed.userId !== "string" ||
        typeof parsed.brandId !== "string" ||
        !parsed.userId ||
        !parsed.brandId
      ) {
        throw new Error("Invalid reset token payload");
      }

      tokenData = {
        userId: parsed.userId,
        brandId: parsed.brandId,
      };
    } catch {
      throw new AppError("Reset token expired or invalid", 400);
    }

    const brandId = await resolveEmailBrand();

    if (tokenData.brandId !== brandId) {
      throw new AppError("Reset token expired or invalid", 400);
    }

    // =====================================================
    // 5. FIND ACTIVE USER
    // =====================================================

    const user = await prisma.user.findUnique({
      where: { id: tokenData.userId },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
      },
    });

    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new AppError("Reset token expired or invalid", 400);
    }

    // =====================================================
    // 6. HASH NEW PASSWORD
    // =====================================================

    const hashedPassword = await bcrypt.hash(
      newPassword,
      Number(config.bcrypt_salt_rounds),
    );

    // =====================================================
    // 7. RECHECK TOKEN BEFORE DATABASE UPDATE
    // =====================================================

    const currentStored = await redisClient.get(resetTokenKey);

    if (currentStored !== stored) {
      throw new AppError("Reset token expired or invalid", 400);
    }

    // =====================================================
    // 8. UPDATE PASSWORD
    // =====================================================

    const updated = await prisma.user.updateMany({
      where: {
        id: user.id,
        status: UserStatus.ACTIVE,
      },
      data: {
        passwordHash: hashedPassword,
      },
    });

    if (updated.count !== 1) {
      throw new AppError("Reset token expired or invalid", 400);
    }

    // =====================================================
    // 9. CONSUME RESET TOKEN
    // =====================================================

    try {
      await redisClient.eval(
        `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
          end

          return 0
        `,
        {
          keys: [resetTokenKey],
          arguments: [stored],
        },
      );
    } catch (error) {
      logUnexpectedError(error, {
        source: "auth.resetPassword.consumeToken",
      });

      // The password was already updated.
      // Do not retry the database update automatically.
      throw new AppError(
        "Password updated, but security cleanup could not be completed. Please contact support.",
        503,
      );
    }

    // =====================================================
    // 10. INVALIDATE EXISTING REFRESH SESSIONS
    // =====================================================

    try {
      await invalidateUserRefreshSessions(user.id);
    } catch (error) {
      logUnexpectedError(error, {
        source: "auth.resetPassword.invalidateSessions",
      });

      // This is a security-sensitive failure.
      throw new AppError(
        "Password updated, but existing sessions could not be revoked. Please contact support.",
        503,
      );
    }

    // =====================================================
    // 11. SEND PASSWORD RESET SUCCESS EMAIL
    // =====================================================

    try {
      const templatePath = path.join(
        process.cwd(),
        "src/app/templates/reset-password.ejs",
      );

      const html = await ejs.renderFile(templatePath, {
        name: user.name,
      });

      await sendMerchantSecurityEmail({
        brandId,
        userId: user.id,
        eventType: "AUTH_PASSWORD_RESET_SUCCESS",
        to: user.email,
        subject: "Password Reset Successful",
        html,
      });
    } catch (error) {
      const safe = safeEmailError(error);

      console.error("[Password Reset Success Email]", {
        code: safe.code,
        deliveryUncertain: safe.deliveryUncertain,
        brandId,
      });

      // Password reset is already successful.
      // Notification failure must not roll it back.
    }

    // =====================================================
    // 12. RETURN SUCCESS
    // =====================================================

    return null;
  } finally {
    // =====================================================
    // 13. RELEASE ONLY THE LOCK OWNED BY THIS REQUEST
    // =====================================================

    try {
      await redisClient.eval(
        `
          if redis.call("GET", KEYS[1]) == ARGV[1] then
            return redis.call("DEL", KEYS[1])
          end

          return 0
        `,
        {
          keys: [lockKey],
          arguments: [lockToken],
        },
      );
    } catch (error) {
      // Avoid masking the original reset result.
      logUnexpectedError(error, {
        source: "auth.resetPassword.releaseLock",
      });
    }
  }
};

export const authService = {
  registerUser,
  loginUser,
  refreshToken,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
  logoutUser,
  verifyEmailOtp,
  resendVerificationOtp,
};
