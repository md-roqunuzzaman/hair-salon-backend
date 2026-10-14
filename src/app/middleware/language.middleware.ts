import { Request, Response, NextFunction } from "express";
import { DEFAULT_LANGUAGE, isLanguage, Language } from "../utils/language.js";

export const languageMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const queryLanguage =
    typeof req.query.lang === "string" ? req.query.lang : undefined;

  const headerLanguage = req.acceptsLanguages("en", "zh-CN", "zh-HK");

  const requested = queryLanguage ?? headerLanguage;

  const language: Language = isLanguage(requested)
    ? requested
    : DEFAULT_LANGUAGE;

  res.locals.language = language;
  res.setHeader("Content-Language", language);
  res.vary("Accept-Language");

  next();
};
