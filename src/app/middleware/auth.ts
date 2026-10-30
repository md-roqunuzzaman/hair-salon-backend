import { NextFunction, Request, Response } from "express";
import { JwtPayload } from "jsonwebtoken";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import { catchAsync } from "../utils/catchAsync.js";
import { jwtUtils } from "../utils/jwt.js";
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

export const auth = (...requiredRoles: Role[]) => {
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
    // 2. VERIFY JWT
    // =====================================================

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

    if (!verifiedToken.success || !verifiedToken.data) {
      throw new AppError(
        verifiedToken.error || "Invalid or expired token",
        401,
      );
    }

    const { userId, email } = verifiedToken.data as JwtPayload;

    if (typeof userId !== "string" || !userId.trim()) {
      throw new AppError(
        "Authentication token is invalid. Please log in again",
        401,
      );
    }

    // =====================================================
    // 3. FIND USER
    // =====================================================

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new AppError("User not found. Please log in again.", 401);
    }

    // =====================================================
    // 4. CHECK ACCOUNT STATUS
    // =====================================================

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError("Your account is inactive.", 403);
    }

    // =====================================================
    // 5. CHECK EMAIL VERIFICATION (CUSTOMER ONLY)
    // =====================================================

    if (user.role === Role.CUSTOMER && !user.emailVerified) {
      throw new AppError(
        "Email verification required. Please verify your email before accessing this resource.",
        403,
      );
    }

    // =====================================================
    // 6. CHECK ROLE PERMISSION
    // =====================================================

    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
      throw new AppError(
        "Forbidden. You don't have permission to access this resource.",
        403,
      );
    }

    // =====================================================
    // 7. ATTACH AUTHENTICATED USER
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
