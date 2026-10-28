import { NextFunction, Request, Response } from "express";

import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { catchAsync } from "../../utils/catchAsync.js";
import { Role } from "../../../../generated/prisma/enums.js";
import { z } from 'zod';

export const verifyBrandEmailAccess = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    // =====================================================
    // 1. VERIFY AUTHENTICATED USER
    // =====================================================

    const user = req.user;

    if (!user) {
      throw new AppError("Authentication required", 401);
    }

    // =====================================================
    // 2. VERIFY BRAND OWNER ROLE
    // =====================================================

    if (user.role !== Role.BRAND_OWNER) {
      throw new AppError("Only the brand owner can manage email settings", 403);
    }

    // =====================================================
    // 3. VALIDATE BRAND ID
    // =====================================================

    const brandId = req.params.brandId;

    if (!z.uuid().safeParse(brandId).success) {
      throw new AppError("Brand ID is required", 400);
    }

    // =====================================================
    // 4. VERIFY SINGLE-BRAND CONFIGURATION
    // =====================================================

    const brands = await prisma.brand.findMany({
      select: {
        id: true,
      },
      take: 2,
    });

    if (brands.length !== 1) {
      throw new AppError(
        "Email settings require exactly one configured brand",
        409,
      );
    }

    // =====================================================
    // 5. PREVENT ACCESS TO ANOTHER BRAND ID
    // =====================================================

    if (brands[0].id !== brandId) {
      throw new AppError(
        "You do not have permission to manage this brand",
        403,
      );
    }

    // =====================================================
    // 6. ACCESS GRANTED
    // =====================================================

    next();
  },
);
