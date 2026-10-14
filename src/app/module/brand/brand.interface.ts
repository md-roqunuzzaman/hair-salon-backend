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
