import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import test from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Prisma } from "../../../generated/prisma/client.js";
import { AppError } from "./app-error.js";
import { logUnexpectedError, normalizeError } from "./normalize-error.js";
import { globalErrorHandler } from "../middleware/globalErrorHandler.js";
import { validateRequest } from "../middleware/validateRequest.js";
import { notFound } from "../middleware/notFound.js";

for (const [status, name, message] of [
  [400, "Bad Request", "Invalid email address"], [401, "Unauthorized", "Authentication token is missing"],
  [403, "Forbidden", "You do not have permission to perform this action"], [404, "Not Found", "Staff not found"],
  [409, "Conflict", "This staff member is already booked for the selected time"],
  [422, "Unprocessable Entity", "This payment is not eligible for a refund"],
  [429, "Too Many Requests", "Too many requests. Please try again later"],
  [400, "Bad Request", "PAY_NOW booking is not enabled for this branch"],
  [409, "Conflict", "Maximum booking capacity has been reached"],
  [400, "Bad Request", "Unsupported image format"], [502, "Bad Gateway", "Payment could not be completed"],
] as const) {
  test(`operational ${status}: ${message}`, () => {
    assert.deepEqual(normalizeError(new AppError(message, status)), {
      body: { success: false, statusCode: status, name, message }, unexpected: false,
    });
  });
}

const prismaError = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError(
  "SELECT private SQL; password=private-provider-value", { code, clientVersion: "7.10.0", meta });
for (const [code, status, message] of [
  ["P2003", 400, "The selected branch does not exist or is still in use"],
  ["P2025", 404, "The requested record was not found"],
  ["P2011", 400, "A required field is missing"],
  ["P2020", 400, "A numeric value is outside the supported range"],
  ["P2034", 409, "This operation conflicts with another update. Please try again"],
  ["P2024", 503, "Service temporarily unavailable. Please try again later"],
  ["P2021", 500, "Internal Server Error"],
] as const) test(`Prisma ${code} is safe and correctly classified`, () => {
  const { body } = normalizeError(prismaError(code, { field_name: "branchId" }));
  assert.equal(body.statusCode, status); assert.equal(body.message, message);
  assert.doesNotMatch(JSON.stringify(body), /SELECT|password|provider-value/);
});

test("Prisma unique, validation and database authentication do not leak internals", () => {
  assert.equal(normalizeError(prismaError("P2002", { modelName: "User", target: ["email"] })).body.message, "A user with this email already exists");
  assert.equal(normalizeError(new Prisma.PrismaClientValidationError("private SQL", { clientVersion: "7.10.0" })).body.statusCode, 400);
  const body = normalizeError(new Prisma.PrismaClientInitializationError("postgresql://secret:password@host/db", "7.10.0", "P1000")).body;
  assert.equal(body.statusCode, 503); assert.doesNotMatch(JSON.stringify(body), /postgres|password|host/);
});

for (const [message, status] of [
  ["UNIQUE constraint failed: User.email: SQLITE_CONSTRAINT", 409],
  ["FOREIGN KEY constraint failed: SQLITE_CONSTRAINT", 400],
  ["NOT NULL constraint failed: Staff.name: SQLITE_CONSTRAINT", 400],
  ["CHECK constraint failed: valid_amount: SQLITE_CONSTRAINT", 400],
  ["Money precision exceeded: SQLITE_CONSTRAINT", 400], ["database is locked: SQLITE_BUSY", 503],
] as const) test(`wrapped SQLite: ${message.split(":")[0]}`, () => {
  const result = normalizeError(new Error("internal adapter error", { cause: new Error(message) }));
  assert.equal(result.body.statusCode, status);
  assert.doesNotMatch(JSON.stringify(result.body), /SQLITE|constraint failed|Staff.name|valid_amount/);
});

test("Zod retains all public issue paths and custom messages", () => {
  const result = z.object({ email: z.email("Invalid email address"), staffId: z.uuid("Invalid staff ID") }).safeParse({ email: "bad", staffId: "bad" });
  assert.equal(result.success, false);
  if (!result.success) {
    const { body } = normalizeError(result.error);
    assert.equal(body.message, "Invalid email address");
    assert.deepEqual(body.details, [{ path: ["email"], message: "Invalid email address" }, { path: ["staffId"], message: "Invalid staff ID" }]);
    assert.doesNotMatch(JSON.stringify(body), /"input"|"stack"/);
  }
});
test("JWT expiry and invalid signatures have safe 401 messages", () => {
  assert.match(normalizeError(new jwt.TokenExpiredError("jwt expired", new Date())).body.message, /session has expired/);
  assert.equal(normalizeError(new jwt.JsonWebTokenError("invalid signature private-token")).body.statusCode, 401);
});
test("unknown failures, misleading provider status and logs never disclose secrets", t => {
  const error = Object.assign(new Error("SELECT secret; jwt=password; postgresql://private"), { statusCode: 401 });
  assert.deepEqual(normalizeError(error).body, { success: false, statusCode: 500, name: "Internal Server Error", message: "Internal Server Error" });
  const log = t.mock.method(console, "error", () => {});
  logUnexpectedError(error, { source: "test" });
  const logged = JSON.stringify(log.mock.calls[0].arguments);
  assert.doesNotMatch(logged, /SELECT|jwt=|password|postgresql|private/);
  assert.match(logged, /incidentId/);
  const cyclic = new Error("unknown"); (cyclic as Error & { cause: unknown }).cause = cyclic;
  assert.equal(normalizeError(cyclic).body.statusCode, 500);
});

test("Prisma driver metadata and raw PostgreSQL constraints are normalized safely", () => {
  const wrapped = prismaError("P2039", { driverAdapterError: { cause: { kind: "sqlite", message: "Money precision exceeded", originalMessage: "Money precision exceeded" } } });
  assert.equal(normalizeError(wrapped).body.statusCode, 400);
  for (const [code, status] of [["23505", 409], ["23503", 400], ["23502", 400], ["23514", 400], ["22001", 400], ["22P02", 400], ["40001", 409], ["40P01", 409]] as const) {
    const body = normalizeError(Object.assign(new Error("SELECT password FROM private"), { code, constraint: "User_email_key", table: "User" })).body;
    assert.equal(body.statusCode, status); assert.doesNotMatch(JSON.stringify(body), /SELECT|password|private|User_email_key/);
  }
});
for (const failure of ["Promise.reject(new Error('private-password SQL jwt-token'))", "setImmediate(() => { throw new Error('private-password SQL jwt-token') })"]) {
  test(`Node fatal boundary: ${failure.startsWith("Promise") ? "unhandled rejection" : "uncaught exception"}`, () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
      `import { installFatalErrorHandlers } from './src/app/utils/process-errors.ts'; installFatalErrorHandlers(); ${failure}`], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Unexpected backend error/);
    assert.doesNotMatch(result.stderr, /private-password|SQL|jwt-token/);
  });
}

test("real Express boundary keeps operational, validation, parser, 404 and unexpected contracts", async t => {
  t.mock.method(console, "error", () => {});
  const app = express();
  app.use(express.json({ limit: "1kb" }));
  app.get("/operational", () => { throw new AppError("Wallet balance is insufficient", 422); });
  app.get("/unknown", () => { throw new Error("private SQL password provider secret"); });
  app.post("/validate", validateRequest(z.object({ body: z.object({ email: z.email("Invalid email address"), name: z.string() }) })), (_req, res) => res.json({ success: true }));
  app.use(notFound); app.use(globalErrorHandler);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  for (const [url, status, message] of [["/operational", 422, "Wallet balance is insufficient"], ["/unknown", 500, "Internal Server Error"], ["/missing?token=secret", 404, "Route not found"]] as const) {
    const response = await fetch(origin + url); const body = await response.json() as { message: string };
    assert.equal(response.status, status); assert.equal(body.message, message);
    assert.doesNotMatch(JSON.stringify(body), /password|provider|SQL|token=|stack/);
  }
  const invalid = await fetch(origin + "/validate", { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"bad"}' });
  const body = await invalid.json() as { details: unknown[]; message: string };
  assert.equal(invalid.status, 400); assert.equal(body.message, "Invalid email address"); assert.equal(body.details.length, 2);
  const malformed = await fetch(origin + "/validate", { method: "POST", headers: { "content-type": "application/json" }, body: '{"password":' });
  assert.equal(malformed.status, 400); assert.equal((await malformed.json() as { message: string }).message, "Invalid JSON request body");
  const large = await fetch(origin + "/validate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ secret: "x".repeat(2048) }) });
  assert.equal(large.status, 413);
});
