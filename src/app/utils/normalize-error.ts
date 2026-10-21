import httpStatus from "http-status";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "./app-error.js";

export type ValidationDetail = { path: (string | number)[]; message: string };
export type ErrorBody = { success: false; statusCode: number; name: string; message: string; details?: ValidationDetail[] };
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value !== null && typeof value === "object" ? value as RecordValue : {};
const labels: Record<string, string> = {
  branchId: "Branch ID", staffId: "Staff ID", serviceId: "Service ID", packageId: "Package ID",
  email: "Email address", name: "Name", phone: "Phone number", date: "Date", startTime: "Start time",
  password: "Password", amount: "Amount", price: "Price",
};
export const validationDetails = (issues: z.core.$ZodIssue[]): ValidationDetail[] => issues.map(issue => ({
  path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"),
  message: issue.code === "invalid_type" && issue.message.includes("received undefined")
    ? `${labels[String(issue.path.at(-1))] ?? "This field"} is required` : issue.message,
}));

function details(value: unknown): ValidationDetail[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const safe = value.filter(item => Array.isArray(item?.path) && typeof item?.message === "string")
    .map(item => ({ path: item.path.filter((part: unknown) => typeof part === "string" || typeof part === "number"), message: item.message }));
  return safe.length ? safe : undefined;
}
export function errorBody(statusCode: number, message: string, validation?: ValidationDetail[]): ErrorBody {
  return { success: false, statusCode, name: String(httpStatus[statusCode as keyof typeof httpStatus] ?? "Error"), message,
    ...(validation?.length ? { details: validation } : {}) };
}
function chain(error: unknown): RecordValue[] {
  const values: RecordValue[] = [];
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  while (pending.length && values.length < 12) {
    const current = pending.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);
    const item = record(current);
    values.push(item);
    pending.push(item.cause, record(item.meta).driverAdapterError, item.driverAdapterError);
  }
  return values;
}
function fields(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((field): field is string => typeof field === "string");
  if (typeof value === "string") return value.split(/[^A-Za-z0-9]+/);
  return [];
}
function duplicate(target: unknown, model?: unknown) {
  const names = fields(target);
  if (names.includes("email")) return model === "User" ? "A user with this email already exists" : "A record with this email already exists";
  if (names.includes("phone")) return "A record with this phone number already exists";
  return "A record with these values already exists";
}
function foreignKey(field: unknown) {
  const names = fields(field);
  for (const [key, label] of [["branchId", "branch"], ["staffId", "staff member"], ["serviceId", "service"], ["packageId", "package"], ["customerId", "customer"]]) {
    if (names.includes(key)) return `The selected ${label} does not exist or is still in use`;
  }
  return "A related record does not exist or is still in use";
}

/** Only trusted operational messages cross this boundary; driver/provider text never does. */
export function normalizeError(error: unknown): { body: ErrorBody; unexpected: boolean } {
  const known = (status: number, message: string, validation?: ValidationDetail[]) => ({ body: errorBody(status, message, validation), unexpected: false });
  const unavailable = () => ({ body: errorBody(503, "Service temporarily unavailable. Please try again later"), unexpected: true });
  if (error instanceof AppError && Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode <= 599) {
    return known(error.statusCode, error.message, details(error.details));
  }
  if (error instanceof z.ZodError) {
    const validation = validationDetails(error.issues);
    return known(400, validation[0]?.message ?? "Invalid request", validation);
  }
  if (error instanceof jwt.TokenExpiredError) return known(401, "Your session has expired. Please log in again");
  if (error instanceof jwt.NotBeforeError || error instanceof jwt.JsonWebTokenError) return known(401, "Authentication token is invalid. Please log in again");
  const root = record(error);
  if (error instanceof URIError && (root.status === 400 || root.statusCode === 400)) return known(400, "Invalid URL encoding");
  // PostgreSQL errors may surface directly from pool/driver operations.
  switch (root.code) {
    case "23505": return known(409, duplicate(root.constraint, root.table));
    case "23503": return known(400, foreignKey(root.constraint));
    case "23502": return known(400, "A required field is missing");
    case "23514": return known(400, "The supplied values violate a data constraint");
    case "22001": return known(400, "A field value exceeds the allowed length");
    case "22P02": return known(400, "An identifier or field value is invalid");
    case "40001": case "40P01": return known(409, "This operation conflicts with another update. Please try again");
  }
  // Express body-parser errors are identified by their documented type, not a
  // provider's arbitrary status/statusCode property.
  const parserErrors: Record<string, [number, string]> = {
    "entity.parse.failed": [400, "Invalid JSON request body"],
    "entity.too.large": [413, "Request body is too large"],
    "encoding.unsupported": [415, "Unsupported request encoding"],
    "charset.unsupported": [415, "Unsupported request character encoding"],
    "request.aborted": [400, "Request was interrupted. Please try again"],
    "request.size.invalid": [400, "Invalid request body size"],
    "parameters.too.many": [413, "Too many request parameters"],
    "entity.verify.failed": [403, "Request body verification failed"],
  };
  if (typeof root.type === "string" && parserErrors[root.type]) return known(...parserErrors[root.type]);
  // Inspect bounded causes for real SQLite errors wrapped by Prisma/DO storage.
  for (const cause of chain(error)) {
    const text = cause.originalMessage ?? cause.message;
    const message = typeof text === "string" ? text.replace(/: SQLITE_[A-Z_]+\s*$/, "") : "";
    const unique = message.match(/^(?:D1_ERROR: |SqliteError: )?(?:UNIQUE|PRIMARY KEY) constraint failed: ([\w., ]+)$/);
    if (unique) {
      const table = unique[1].split(".")[0];
      return known(409, duplicate(unique[1], table));
    }
    if (/^(?:D1_ERROR: |SqliteError: )?FOREIGN KEY constraint failed$/.test(message)) return known(400, foreignKey(undefined));
    if (/^(?:D1_ERROR: |SqliteError: )?NOT NULL constraint failed: [\w.]+$/.test(message)) return known(400, "A required field is missing");
    if (message === "Money precision exceeded") return known(400, "Amount exceeds the supported precision or range");
    if (/^(?:D1_ERROR: |SqliteError: )?CHECK constraint failed(?:: [\w]+)?$/.test(message)) return known(400, "The supplied values violate a data constraint");
    if (/^(?:database is (?:locked|busy)|SQLITE_BUSY|SQLITE_LOCKED)$/.test(message)) return unavailable();
  }
  if (error instanceof Prisma.PrismaClientValidationError) return known(400, "You have provided incorrect field type or missing fields");
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const meta = record(error.meta);
    switch (error.code) {
      case "P2002": return known(409, duplicate(meta.target ?? record(meta.driverAdapterError).constraint, meta.modelName));
      case "P2003": return known(400, foreignKey(meta.field_name));
      case "P2025": return known(404, "The requested record was not found");
      case "P2011": case "P2012": case "P2013": return known(400, "A required field is missing");
      case "P2000": return known(400, "A field value exceeds the allowed length");
      case "P2004": case "P2014": return known(400, "The supplied values violate a data constraint");
      case "P2005": case "P2006": case "P2007": case "P2009": case "P2019": case "P2023": return known(400, "An identifier or field value is invalid");
      case "P2020": return known(400, "A numeric value is outside the supported range");
      case "P2034": return known(409, "This operation conflicts with another update. Please try again");
      case "P2024": case "P2028": case "P2037": return unavailable();
    }
  }
  if (error instanceof Prisma.PrismaClientInitializationError && ["P1000", "P1001", "P1002", "P1008", "P1017"].includes(error.errorCode ?? "")) return unavailable();
  return { body: errorBody(500, "Internal Server Error"), unexpected: true };
}

/** Deliberately excludes raw error messages, query strings, SQL, headers and bodies. */
export function logUnexpectedError(error: unknown, context: { method?: string; route?: string; source?: string } = {}) {
  const item = record(error);
  console.error("Unexpected backend error", {
    incidentId: crypto.randomUUID(), ...context,
    name: typeof item.name === "string" && /^[\w.]+$/.test(item.name) ? item.name : "Error",
    code: typeof item.code === "string" && /^[A-Z0-9_]+$/.test(item.code) ? item.code : undefined,
    // Stack frames only: the first stack line contains the potentially sensitive message.
    frames: typeof item.stack === "string" ? item.stack.split("\n").map(line => line.match(/^\s+at ([\w.$<>]+) \(/)?.[1]).filter(Boolean).slice(0, 5) : undefined,
  });
}
