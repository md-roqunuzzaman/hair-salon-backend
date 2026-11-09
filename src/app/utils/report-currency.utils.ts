import { prisma } from "../lib/prisma.js";
import { getBrandInternationalSettings } from "./brand-international-settings.utils.js";
import { AppError } from "./app-error.js";
import { Prisma } from "../../../generated/prisma/client.js";

// Existing report contracts expose one total.
// Fail closed rather than silently sum different denominations.
// This deliberately conservative gate is global.
export const reportingCurrency = async (
  client: Prisma.TransactionClient = prisma,
): Promise<string> => {
  // =====================================================
  // 1. GET CURRENT BRAND CURRENCY
  // =====================================================

  const brand = await getBrandInternationalSettings(client);

  // =====================================================
  // 2. COLLECT ALL PERSISTED CURRENCIES
  // =====================================================

  const groups = await Promise.all([
    client.payment.groupBy({
      by: ["currency"],
    }),

    client.wallet.groupBy({
      by: ["currency"],
    }),

    client.appointment.groupBy({
      by: ["currency"],
    }),

    client.groupPurchase.groupBy({
      by: ["currency"],
    }),
  ]);

  // =====================================================
  // 3. BUILD UNIQUE CURRENCY SET
  // =====================================================

  const currencies = new Set<string>([brand.currency]);

  // Every financial model now requires its own currency. Do not infer a missing
  // snapshot from current settings or ignore invalid legacy/storage results.
  if (!brand.currency || groups.some((rows) => rows.some((row) => !row.currency))) {
    throw new AppError(
      "Stored financial currency requires reconciliation before financial reporting",
      409,
    );
  }

  for (const rows of groups) {
    for (const row of rows) {
      if (row.currency) {
        currencies.add(row.currency);
      }
    }
  }

  // =====================================================
  // 4. PREVENT MIXED-CURRENCY REPORTING
  // =====================================================

  if (currencies.size !== 1) {
    throw new AppError(
      "Mixed-currency totals require a currency-separated report",
      409,
    );
  }

  // =====================================================
  // 5. RETURN VERIFIED REPORT CURRENCY
  // =====================================================

  return brand.currency;
};

// Settings changes are forbidden once financial records exist.
// Recheck after collecting totals to also fence an
// initial-configuration change mid-report.
export const assertReportingCurrency = async (
  expected: string,
  client: Prisma.TransactionClient = prisma,
): Promise<void> => {
  const brand = await getBrandInternationalSettings(client);

  if (brand.currency !== expected) {
    throw new AppError("Report currency changed; reload the report", 409);
  }
};
