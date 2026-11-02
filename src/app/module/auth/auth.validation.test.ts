import assert from "node:assert/strict";
import test from "node:test";
import { authValidation } from "./auth.validation.js";

const validPassword = "ValidPassword1!";

// Satisfies existing complexity rules:
// uppercase, lowercase, number, special character.
const password72 = "Aa1!" + "A".repeat(68);
const password73 = "Aa1!" + "A".repeat(69);

// Aa1! = 4 bytes; emoji = 4 bytes each.
const unicode72 = "Aa1!" + "😀".repeat(17);
const unicode76 = "Aa1!" + "😀".repeat(18);

const registerPayload = (password: string) => ({
  body: {
    name: "Ada Lovelace",
    email: "ADA@example.com",
    password,
  },
});

const resetPasswordPayload = (newPassword: string) => ({
  body: {
    email: "ada@example.com",
    resetToken: "valid-test-reset-token",
    newPassword,
  },
});

const assertPasswordByteIssue = (
  result: {
    success: boolean;
    error?: {
      issues: Array<{
        path: PropertyKey[];
        message: string;
      }>;
    };
  },
  field: string,
) => {
  assert.equal(result.success, false);

  assert.ok(
    result.error?.issues.some(
      (issue) =>
        issue.path.join(".") === `body.${field}` &&
        issue.message.includes("72 UTF-8 bytes"),
    ),
    `Expected 72-byte validation error for ${field}`,
  );
};

// =====================================================
// EXISTING TESTS
// =====================================================

test("register validation accepts a valid payload and removes unknown fields", () => {
  const result = authValidation.registerValidationSchema.safeParse({
    body: {
      name: "Ada Lovelace",
      email: "ADA@example.com",
      password: validPassword,
      role: "BRAND_OWNER",
    },
  });

  assert.equal(result.success, true);

  if (result.success) {
    assert.deepEqual(Object.keys(result.data.body).sort(), [
      "email",
      "name",
      "password",
    ]);
  }
});

test("reset OTP must be exactly six digits", () => {
  const invalid = authValidation.verifyResetOtpValidationSchema.safeParse({
    body: { email: "ada@example.com", otp: "abcdef" },
  });

  const valid = authValidation.verifyResetOtpValidationSchema.safeParse({
    body: { email: "ada@example.com", otp: "123456" },
  });

  assert.equal(invalid.success, false);
  assert.equal(valid.success, true);
});

// =====================================================
// S5 — REGISTRATION
// =====================================================

test("S5: registration accepts exactly 72 ASCII bytes", () => {
  assert.equal(new TextEncoder().encode(password72).length, 72);

  const result = authValidation.registerValidationSchema.safeParse(
    registerPayload(password72),
  );

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("S5: registration rejects 73 ASCII bytes", () => {
  assert.equal(new TextEncoder().encode(password73).length, 73);

  const result = authValidation.registerValidationSchema.safeParse(
    registerPayload(password73),
  );

  assertPasswordByteIssue(result, "password");
});

test("S5: registration accepts exactly 72 Unicode UTF-8 bytes", () => {
  assert.equal(new TextEncoder().encode(unicode72).length, 72);

  const result = authValidation.registerValidationSchema.safeParse(
    registerPayload(unicode72),
  );

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("S5: registration rejects Unicode password exceeding 72 bytes", () => {
  assert.equal(new TextEncoder().encode(unicode76).length, 76);

  const result = authValidation.registerValidationSchema.safeParse(
    registerPayload(unicode76),
  );

  assertPasswordByteIssue(result, "password");
});

// =====================================================
// S5 — RESET PASSWORD
// =====================================================

test("S5: reset password accepts exactly 72 ASCII bytes", () => {
  const result = authValidation.resetPasswordValidationSchema.safeParse(
    resetPasswordPayload(password72),
  );

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});

test("S5: reset password rejects 73 ASCII bytes", () => {
  const result = authValidation.resetPasswordValidationSchema.safeParse(
    resetPasswordPayload(password73),
  );

  assertPasswordByteIssue(result, "newPassword");
});

test("S5: reset password rejects oversized Unicode password", () => {
  const result = authValidation.resetPasswordValidationSchema.safeParse(
    resetPasswordPayload(unicode76),
  );

  assertPasswordByteIssue(result, "newPassword");
});

// =====================================================
// S5 — LEGACY LOGIN COMPATIBILITY
// =====================================================

test("S5: login validation allows legacy oversized passwords", () => {
  const result = authValidation.LoginZodSchema.safeParse({
    body: {
      email: "ada@example.com",
      password: password73,
    },
  });

  assert.equal(result.success, true, JSON.stringify(result.error?.issues));
});
