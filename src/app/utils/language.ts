export const SUPPORTED_LANGUAGES = ["en", "zh-CN", "zh-HK"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "en";

export const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" &&
  SUPPORTED_LANGUAGES.some((lang) => lang === value);
