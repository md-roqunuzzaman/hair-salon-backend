import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../utils/app-error.js";
import { uploadService } from "../upload/upload.service.js";

import { DEFAULT_LANGUAGE, type Language } from "../../utils/language.js";

import { getLocalizedContent } from "../../utils/localization.js";

import type {
  IBrandInternationalSettings,
  IBrandTheme,
  IBrandTranslations,
  IUpdateBrandInternationalSettingsPayload,
  IUpdateBrandPayload,
  IUpdateBrandThemePayload,
} from "./brand.interface.js";
import { Prisma } from "../../../../generated/prisma/client.js";
import { validateBrandThemeContrast } from "./brand-theme.utils.js";
import {
  validateCountryCode,
  validateCurrencyCode,
  validateTimezone,
} from "../../utils/international-config.utils.js";

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
    countryCode: brand.countryCode,
    currency: brand.currency,
    timezone: brand.timezone,

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

// =====================================================
// GET BRAND THEME
// =====================================================

const getBrandTheme = async (): Promise<IBrandTheme> => {
  const brand = await prisma.brand.findFirst({
    select: {
      primaryColor: true,
      secondaryColor: true,
      backgroundColor: true,
      surfaceColor: true,
      textColor: true,
      mutedTextColor: true,
      lineColor: true,
      onPrimaryColor: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  return brand;
};

// =====================================================
// UPDATE BRAND THEME
// =====================================================

const updateBrandTheme = async (
  payload: IUpdateBrandThemePayload,
): Promise<IBrandTheme> => {
  const result = await prisma.$transaction(
    async (tx) => {
      // Serialize theme updates for this brand.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM "Brand"
        ORDER BY "createdAt" ASC, id ASC
        LIMIT 1
        FOR UPDATE
      `;

      const brandId = rows[0]?.id;

      if (!brandId) {
        throw new AppError("Brand not found", 404);
      }

      const brand = await tx.brand.findUniqueOrThrow({
        where: { id: brandId },
        select: {
          primaryColor: true,
          secondaryColor: true,
          backgroundColor: true,
          surfaceColor: true,
          onPrimaryColor: true,
          textColor: true,
          mutedTextColor: true,
          lineColor: true,
        },
      });

      // Merge existing colors with partial PATCH payload.
      const nextTheme: IBrandTheme = {
        primaryColor: payload.primaryColor ?? brand.primaryColor,

        secondaryColor: payload.secondaryColor ?? brand.secondaryColor,

        backgroundColor: payload.backgroundColor ?? brand.backgroundColor,

        surfaceColor: payload.surfaceColor ?? brand.surfaceColor,

        textColor: payload.textColor ?? brand.textColor,

        mutedTextColor: payload.mutedTextColor ?? brand.mutedTextColor,

        lineColor: payload.lineColor ?? brand.lineColor,

        onPrimaryColor: payload.onPrimaryColor ?? brand.onPrimaryColor,
      };

      // Validate final configuration.
      validateBrandThemeContrast(nextTheme);

      // Save only provided fields.
      const updatedBrand = await tx.brand.update({
        where: {
          id: brandId,
        },

        data: {
          ...payload,
        },

        select: {
          primaryColor: true,
          secondaryColor: true,
          backgroundColor: true,
          surfaceColor: true,
          onPrimaryColor: true,
          textColor: true,
          mutedTextColor: true,
          lineColor: true,
        },
      });

      return updatedBrand;
    },
    {
      maxWait: 5000,
      timeout: 10000,
    },
  );

  return result;
};

const getBrandInternationalSettings =
  async (): Promise<IBrandInternationalSettings> => {
    const brand = await prisma.brand.findFirst({
      select: {
        countryCode: true,
        currency: true,
        timezone: true,
      },
    });

    if (!brand) {
      throw new AppError("Brand not found", 404);
    }

    return {
      countryCode: brand.countryCode,
      currency: brand.currency,
      timezone: brand.timezone,
    };
  };

const updateBrandInternationalSettings = async (
  payload: IUpdateBrandInternationalSettingsPayload,
): Promise<IBrandInternationalSettings> => {
  // =====================================================
  // 1. VALIDATE REQUEST
  // =====================================================

  if (!payload || Object.keys(payload).length === 0) {
    throw new AppError(
      "At least one international setting must be provided",
      400,
    );
  }

  // =====================================================
  // 2. VALIDATE PROVIDED VALUES
  // =====================================================

  const countryCode =
    payload.countryCode !== undefined
      ? validateCountryCode(payload.countryCode)
      : undefined;

  const currency =
    payload.currency !== undefined
      ? validateCurrencyCode(payload.currency)
      : undefined;

  const timezone =
    payload.timezone !== undefined
      ? validateTimezone(payload.timezone)
      : undefined;

  // =====================================================
  // 3. FIND BRAND
  // =====================================================

  return prisma.$transaction(async tx => {
  const brand = await tx.brand.findFirst({
    select: {
      id: true,
      countryCode: true,
      currency: true,
      timezone: true,
    },
  });

  if (!brand) {
    throw new AppError("Brand not found", 404);
  }

  // =====================================================
  // 4. RESOLVE NEXT CONFIGURATION
  // =====================================================

  const nextCountryCode = countryCode ?? brand.countryCode;

  const nextCurrency = currency ?? brand.currency;

  const nextTimezone = timezone ?? brand.timezone;

  // =====================================================
  // 5. CURRENCY CHANGE SAFETY
  // =====================================================

  if (nextCurrency !== brand.currency && (
    await tx.payment.count() || await tx.wallet.count() || await tx.groupPurchase.count() || await tx.appointment.count()
  )) {
    throw new AppError(
      "Currency changes require an empty financial history; existing wallets and transactions cannot be redenominated",
      409,
    );
  }

  // =====================================================
  // 6. TIMEZONE CHANGE SAFETY
  // =====================================================

  if (nextTimezone !== brand.timezone && await tx.appointment.count()) {
    throw new AppError(
      "Timezone changes require appointment history reconciliation; existing calendar keys must not be reinterpreted",
      409,
    );
  }

  // =====================================================
  // 7. UPDATE BRAND
  // =====================================================

  const updatedBrand = await tx.brand.update({
    where: {
      id: brand.id,
    },

    data: {
      countryCode: nextCountryCode,
      currency: nextCurrency,
      timezone: nextTimezone,
    },

    select: {
      countryCode: true,
      currency: true,
      timezone: true,
    },
  });

  return updatedBrand;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

export const brandService = {
  getBrand,
  updateBrand,
  getBrandTheme,
  updateBrandTheme,
  getBrandInternationalSettings,
  updateBrandInternationalSettings,
};
