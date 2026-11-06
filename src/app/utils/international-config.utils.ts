import countries from "i18n-iso-countries";
import currencyCodes from "currency-codes";

import { AppError } from "./app-error.js";
import { currencyDigits } from "./transaction-currency.utils.js";

// =====================================================
// VALIDATE ISO COUNTRY CODE
// =====================================================

export const validateCountryCode = (value: string): string => {
  const countryCode = value.trim().toUpperCase();

  if (!countries.isValid(countryCode)) {
    throw new AppError("Invalid ISO country code", 400);
  }

  return countryCode;
};

// =====================================================
// VALIDATE ISO CURRENCY CODE
// =====================================================

export const validateCurrencyCode = (value: string): string => {
  const currency = value.trim().toUpperCase();

  if (!currencyCodes.code(currency)) {
    throw new AppError("Invalid ISO currency code", 400);
  }

  currencyDigits(currency);

  return currency;
};

// =====================================================
// VALIDATE IANA TIMEZONE
// =====================================================

export const validateTimezone = (value: string): string => {
  const timezone = value.trim();

  if (!timezone) {
    throw new AppError("Timezone is required", 400);
  }

  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
    });
  } catch {
    throw new AppError("Invalid IANA timezone", 400);
  }

  return timezone;
};
