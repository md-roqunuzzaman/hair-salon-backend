import type { Language } from "../../utils/language.js";

export interface IBrandLocale {
  name?: string;
  description?: string;
}

export type IBrandTranslations = Partial<Record<Language, IBrandLocale>>;

export interface IUpdateBrandPayload {
  name?: string;
  description?: string;
  phone?: string;
  email?: string;
  logoObjectKey?: string;
  translations?: IBrandTranslations;
}

export interface IBrandTheme {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  mutedTextColor: string;
  lineColor: string;
  onPrimaryColor: string;
}

export type IUpdateBrandThemePayload = Partial<IBrandTheme>;
