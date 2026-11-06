import { prisma } from "../lib/prisma.js";
import { getBrandInternationalSettings } from "./brand-international-settings.utils.js";
import { AppError } from "./app-error.js";
import { Prisma } from "../../../generated/prisma/client.js";

// Existing report contracts expose one total. Fail closed rather than silently
// sum different denominations. This deliberately conservative gate is global.
export const reportingCurrency = async (client: Prisma.TransactionClient = prisma): Promise<string> => {
  const brand = await getBrandInternationalSettings(client);
  const groups = await Promise.all([
    client.payment.groupBy({ by: ["currency"] }),
    client.wallet.groupBy({ by: ["currency"] }),
    client.appointment.groupBy({ by: ["currency"] }),
    client.groupPurchase.groupBy({ by: ["currency"] }),
  ]);
  const currencies = new Set<string>([brand.currency]);
  // Legacy purchase currency may be established by linked persisted payments or
  // appointments, already included above. An unlinked legacy amount is unknown.
  if (groups[3]!.some(row => !row.currency) && await client.groupPurchase.count({ where: { currency: null, payments: { none: {} }, appointments: { none: {} } } })) {
    throw new AppError("Historical purchase currency requires reconciliation before financial reporting", 409);
  }
  for (const rows of groups) for (const row of rows) if (row.currency) currencies.add(row.currency);
  if (currencies.size !== 1) throw new AppError("Mixed-currency totals require a currency-separated report", 409);
  return brand.currency;
};

// Settings changes are forbidden once financial records exist. Recheck after
// collecting totals to also fence an initial-configuration change mid-report.
export const assertReportingCurrency = async (expected: string, client: Prisma.TransactionClient = prisma): Promise<void> => {
  if ((await getBrandInternationalSettings(client)).currency !== expected) throw new AppError("Report currency changed; reload the report", 409);
};
