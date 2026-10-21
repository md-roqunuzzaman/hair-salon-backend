import type { ErrorRequestHandler } from "express";
import { logUnexpectedError, normalizeError } from "../utils/normalize-error.js";

export const globalErrorHandler: ErrorRequestHandler = (error, req, res, next) => {
  const { body, unexpected } = normalizeError(error);
  if (unexpected) logUnexpectedError(error, { method: req.method, route: req.route?.path, source: "express" });
  if (res.headersSent) { next(error); return; }
  res.status(body.statusCode).json(body);
};
