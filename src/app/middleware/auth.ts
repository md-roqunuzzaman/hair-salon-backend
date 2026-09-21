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
    const authorization = req.headers.authorization;
    const token = req.cookies?.accessToken ??
      (authorization?.startsWith("Bearer ")
        ? authorization.slice(7)
        : undefined);

    if (!token) {
      throw new AppError(
        "You are not logged in. Please log in to access this resource.",
        401,
      );
    }

    const verifiedToken = jwtUtils.verifyToken(token, config.jwt_access_secret);

    if (!verifiedToken.success || !verifiedToken.data) {
      throw new AppError(verifiedToken.error || "Invalid or expired token", 401);
    }

    const { userId, email } = verifiedToken.data as JwtPayload;

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new AppError("User not found. Please log in again.", 401);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AppError("Your account is inactive.", 403);
    }

    if (requiredRoles.length && !requiredRoles.includes(user.role)) {
      throw new AppError(
        "Forbidden. You don't have permission to access this resource.",
        403,
      );
    }

    req.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    next();
  });
};
