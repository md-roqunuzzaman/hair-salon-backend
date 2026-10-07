import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { uploadService } from "../upload/upload.service.js";
import { IUpdateBrandPayload } from "./brand.interface.js";

// =====================================================
// GET BRAND
// =====================================================

const getBrand = async () => {
  const brand = await prisma.brand.findFirst();

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const logoUrl = brand.logoObjectKey
    ? await uploadService.getImageUrl(brand.logoObjectKey)
    : null;

  return {
    id: brand.id,

    name: brand.name,

    description: brand.description,

    phone: brand.phone,

    email: brand.email,

    logoObjectKey: brand.logoObjectKey,

    logoUrl,

    createdAt: brand.createdAt,

    updatedAt: brand.updatedAt,
  };
};

// =====================================================
// UPDATE BRAND
// =====================================================

const updateBrand = async (payload: IUpdateBrandPayload) => {
  // ===================================================
  // 1. FIND BRAND
  // ===================================================

  const brand = await prisma.brand.findFirst();

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // ===================================================
  // 2. LOGO R2 VALIDATION
  // ===================================================

  if (payload.logoObjectKey !== undefined) {
    const expectedPrefix = `brands/${brand.id}/`;

    if (!payload.logoObjectKey.startsWith(expectedPrefix)) {
      throw new AppError("Invalid brand logo object key", 400);
    }

    await uploadService.verifyImageExists(payload.logoObjectKey);
  }

  // ===================================================
  // 3. UPDATE
  // ===================================================

  const updatedBrand = await prisma.brand.update({
    where: {
      id: brand.id,
    },

    data: {
      ...(payload.name !== undefined && {
        name: payload.name.trim(),
      }),

      ...(payload.description !== undefined && {
        description: payload.description.trim(),
      }),

      ...(payload.phone !== undefined && {
        phone: payload.phone.trim(),
      }),

      ...(payload.email !== undefined && {
        email: payload.email.trim().toLowerCase(),
      }),

      ...(payload.logoObjectKey !== undefined && {
        logoObjectKey: payload.logoObjectKey,
      }),
    },
  });

  // ===================================================
  // 4. SIGNED LOGO URL
  // ===================================================

  const logoUrl = updatedBrand.logoObjectKey
    ? await uploadService.getImageUrl(updatedBrand.logoObjectKey)
    : null;

  // ===================================================
  // 5. RESPONSE
  // ===================================================

  return {
    id: updatedBrand.id,

    name: updatedBrand.name,

    description: updatedBrand.description,

    phone: updatedBrand.phone,

    email: updatedBrand.email,

    logoObjectKey: updatedBrand.logoObjectKey,

    logoUrl,

    createdAt: updatedBrand.createdAt,

    updatedAt: updatedBrand.updatedAt,
  };
};

export const brandService = {
  getBrand,
  updateBrand,
};
