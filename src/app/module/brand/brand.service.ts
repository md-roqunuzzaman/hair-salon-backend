import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { uploadService } from "../upload/upload.service.js";

import { DEFAULT_LANGUAGE, type Language } from "../../utils/language.js";

import { getLocalizedContent } from "../../utils/localization.js";

import type {
  IBrandTranslations,
  IUpdateBrandPayload,
} from "./brand.interface.js";
import { Prisma } from "../../../../generated/prisma/client.js";

// =====================================================
// HELPERS
// =====================================================

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readTranslations = (value: unknown): IBrandTranslations => {
  if (!isRecord(value)) {
    return {};
  }

  const result: IBrandTranslations = {};

  for (const language of ["en", "zh-CN", "zh-HK"] as const) {
    const locale = value[language];

    if (!isRecord(locale)) {
      continue;
    }

    result[language] = {
      ...(typeof locale.name === "string" && {
        name: locale.name,
      }),

      ...(typeof locale.description === "string" && {
        description: locale.description,
      }),
    };
  }

  return result;
};

const mergeTranslations = (
  existing: unknown,
  incoming: IBrandTranslations | undefined,
  name: string,
  description: string | null,
): Prisma.InputJsonObject => {
  const previous = readTranslations(existing);

  const mergeLocale = (language: "zh-CN" | "zh-HK") => ({
    ...(previous[language] ?? {}),
    ...(incoming?.[language] ?? {}),
  });

  return {
    en: {
      name,
      ...(description !== null && { description }),
    },

    "zh-CN": mergeLocale("zh-CN"),

    "zh-HK": mergeLocale("zh-HK"),
  };
};

// =====================================================
// GET BRAND
// =====================================================

const getBrand = async (language: Language = DEFAULT_LANGUAGE) => {
  const brand = await prisma.brand.findFirst();

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  const localized = getLocalizedContent(brand.translations, language, {
    name: brand.name,
    description: brand.description,
  });

  const logoUrl = brand.logoObjectKey
    ? await uploadService.getImageUrl(brand.logoObjectKey)
    : null;

  return {
    id: brand.id,

    name: localized.name,
    description: localized.description,

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

const updateBrand = async (
  payload: IUpdateBrandPayload,
  language: Language = DEFAULT_LANGUAGE,
) => {
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
  // 3. RESOLVE ENGLISH BASE VALUES
  // ===================================================

  const nextName =
    payload.name !== undefined
      ? payload.name.trim()
      : payload.translations?.en?.name !== undefined
        ? payload.translations.en.name.trim()
        : brand.name;

  const nextDescription =
    payload.description !== undefined
      ? payload.description.trim()
      : payload.translations?.en?.description !== undefined
        ? payload.translations.en.description.trim()
        : brand.description;

  // ===================================================
  // 4. MERGE TRANSLATIONS
  // ===================================================

  const translations = mergeTranslations(
    brand.translations,
    payload.translations,
    nextName,
    nextDescription,
  );

  // ===================================================
  // 5. UPDATE BRAND
  // ===================================================

  const updatedBrand = await prisma.brand.update({
    where: {
      id: brand.id,
    },

    data: {
      name: nextName,

      description: nextDescription,

      translations,

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
  // 6. SIGNED LOGO URL
  // ===================================================

  const logoUrl = updatedBrand.logoObjectKey
    ? await uploadService.getImageUrl(updatedBrand.logoObjectKey)
    : null;

  // ===================================================
  // 7. LOCALIZED RESPONSE
  // ===================================================

  const localized = getLocalizedContent(updatedBrand.translations, language, {
    name: updatedBrand.name,
    description: updatedBrand.description,
  });

  return {
    id: updatedBrand.id,

    name: localized.name,
    description: localized.description,

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
