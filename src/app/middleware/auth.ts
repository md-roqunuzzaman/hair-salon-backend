import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import { catchAsync } from "../utils/catchAsync.js";
import { jwtUtils } from "../utils/jwt.js";
import { assertActiveAuthSession } from "../utils/auth-session.js";
import config from "../config/index.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/app-error.js";

declare global {
  namespace Express {
    interface Request {
      user?: {
        userId: string;
        email: string;
        name: string;
        role: Role;
      };
    }
  }
}

type AuthOptions = {
  allowPasswordChangeRequired?: boolean;
};

export const auth = (...args: (Role | AuthOptions)[]) => {
  const requiredRoles = args.filter(
    (arg): arg is Role => typeof arg === "string",
  );

  const options = args.find(
    (arg): arg is AuthOptions => typeof arg === "object" && arg !== null,
  );

  return catchAsync(async (req: Request, res: Response, next: NextFunction) => {
    // =====================================================
    // 1. EXTRACT ACCESS TOKEN
    // =====================================================

    const authorization = req.headers.authorization;

    const token =
      req.cookies?.accessToken ??
      (authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : undefined);

    if (!token) {
      throw new AppError(
        "You are not logged in. Please log in to access this resource.",
        401,
      );
    }

    // =====================================================
    // 2. VERIFY JWT SIGNATURE AND EXPIRATION
    // =====================================================

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

    if (!verifiedToken.success || !verifiedToken.data) {
      throw new AppError(
        verifiedToken.error || "Invalid or expired token",
        401,
      );
    }

    const data = verifiedToken.data as JwtPayload;

    // =====================================================
    // 3. VALIDATE TOKEN CLAIMS
    // =====================================================

    const { userId, sid } = data;

    if (
      typeof userId !== "string" ||
      !userId.trim() ||
      typeof sid !== "string" ||
      !sid.trim()
    ) {
      throw new AppError(
        "Authentication token is invalid. Please log in again.",
        401,
      );
    }

    // =====================================================
    // 4. VERIFY ACTIVE SESSION (S4)
    // =====================================================

    await assertActiveAuthSession(userId, sid);

    // =====================================================
    // 5. FETCH CURRENT USER
    // =====================================================

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        status: true,
        emailVerified: true,
        mustChangePassword: true,
      },
    });

    if (!user) {
      throw new AppError("User not found. Please log in again.", 401);
    }

    // =====================================================
    // 6. ACCOUNT STATUS
    // =====================================================

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError("Your account is inactive.", 403);
    }

    // =====================================================
    // 7. CUSTOMER EMAIL VERIFICATION
    // =====================================================

    if (user.role === Role.CUSTOMER && !user.emailVerified) {
      throw new AppError(
        "Email verification required. Please verify your email before accessing this resource.",
        403,
      );
    }

    // =====================================================
    // 8. PASSWORD CHANGE REQUIREMENT (S3)
    // =====================================================

    if (user.mustChangePassword && !options?.allowPasswordChangeRequired) {
      throw new AppError(
        "Password change required. Please change your temporary password before continuing.",
        403,
      );
    }

    // =====================================================
    // 9. ROLE AUTHORIZATION
    // =====================================================

    if (requiredRoles.length > 0 && !requiredRoles.includes(user.role)) {
      throw new AppError(
        "Forbidden. You don't have permission to access this resource.",
        403,
      );
    }

    // =====================================================
    // 10. ATTACH AUTHENTICATED USER
    // =====================================================

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  });
};
