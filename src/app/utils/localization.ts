import type { Language } from "./language.js";

type LocalizedFields = Record<string, unknown>;

type TranslationMap = Partial<Record<Language, LocalizedFields>>;

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

export const getLocalizedContent = <T extends Record<string, unknown>>(
  translations: unknown,
  language: Language,
  fallback: T,
): T => {
  if (!isRecord(translations)) {
    return fallback;
  }

  const data = translations as TranslationMap;

  const selected = isRecord(data[language]) ? data[language] : {};

  const english = isRecord(data.en) ? data.en : {};

  const result: Record<string, unknown> = {
    ...fallback,
  };

  for (const key of Object.keys(fallback)) {
    const selectedValue = selected[key];
    const englishValue = english[key];

    result[key] =
      selectedValue !== undefined && selectedValue !== null
        ? selectedValue
        : englishValue !== undefined && englishValue !== null
          ? englishValue
          : fallback[key];
  }

  return result as T;
};
