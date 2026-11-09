import currencyCodes from "currency-codes";
import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "./app-error.js";

// Storage and allocation ledgers use exact hundredths. Stripe's wire units are
// separate: JPY is whole units, whereas ISK/UGX require whole units * 100.
export const currencyDigits = (currency: string): number => {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new AppError("Currency code requires reconciliation", 409);
  const code = currencyCodes.code(currency);
  if (!code || ![0, 2].includes(code.digits))
    throw new AppError(
      "Currency precision is not supported by this ledger",
      409,
    );
  return [
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
    "ISK",
  ].includes(currency)
    ? 0
    : code.digits;
};

export const assertCurrencyAmount = (
  value: Prisma.Decimal | number | string,
  currency: string,
): Prisma.Decimal => {
  const amount = new Prisma.Decimal(value);
  const scaled = amount.mul(10 ** currencyDigits(currency));
  if (
    !amount.isFinite() ||
    amount.lt(0) ||
    !scaled.isInteger() ||
    !Number.isSafeInteger(scaled.toNumber())
  ) {
    throw new AppError(
      "Amount cannot be represented in the transaction currency",
      409,
    );
  }
  return amount;
};

export const stripeAmount = (
  value: Prisma.Decimal | number | string,
  currency: string,
): number => {
  const amount = assertCurrencyAmount(value, currency);

  const multiplier = ["ISK", "UGX"].includes(currency)
    ? 100
    : 10 ** currencyDigits(currency);

  const stripeValue = amount.mul(multiplier);

  if (
    !stripeValue.isFinite() ||
    !stripeValue.isInteger() ||
    !Number.isSafeInteger(stripeValue.toNumber())
  ) {
    throw new AppError(
      "Amount cannot be represented in Stripe currency units",
      409,
    );
  }

  return stripeValue.toNumber();
};

export const assertSameCurrency = (actual: string, expected: string): void => {
  currencyDigits(expected);
  if (actual !== expected)
    throw new AppError("Currency mismatch; balances cannot be converted", 409);
};

export const historicalPurchaseCurrency = (
  snapshot: string | null | undefined,
  evidence: readonly string[],
): string => {
  const values = new Set([...(snapshot ? [snapshot] : []), ...evidence]);
  if (values.size !== 1)
    throw new AppError(
      "Purchase currency requires historical reconciliation",
      409,
    );
  const currency = [...values][0]!;
  currencyDigits(currency);
  return currency;
};

export const getPurchaseCurrency = async (
  client: Prisma.TransactionClient,
  purchaseId: string,
): Promise<string> => {
  const purchase = await client.groupPurchase.findUnique({
    where: { id: purchaseId },
    select: {
      currency: true,
      payments: { select: { currency: true } },
      appointments: { select: { currency: true } },
    },
  });
  if (!purchase) throw new AppError("Group purchase not found", 404);
  return historicalPurchaseCurrency(
    purchase.currency,
    [...purchase.payments, ...purchase.appointments].map((row) => row.currency),
  );
};

export const getPurchaseCurrencies = async (
  client: Prisma.TransactionClient,
  ids: string[],
): Promise<Map<string, string>> => {
  if (!ids.length) return new Map();
  const rows = await client.groupPurchase.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      currency: true,
      payments: { select: { currency: true } },
      appointments: { select: { currency: true } },
    },
  });
  if (rows.length !== new Set(ids).size)
    throw new AppError("Group purchase history changed; reload the page", 409);
  return new Map(
    rows.map((row) => [
      row.id,
      historicalPurchaseCurrency(
        row.currency,
        [...row.payments, ...row.appointments].map((item) => item.currency),
      ),
    ]),
  );
};
