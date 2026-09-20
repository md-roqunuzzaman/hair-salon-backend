import assert from "node:assert/strict";
import test from "node:test";
import { authValidation } from "./auth.validation.js";

const validPassword = "ValidPassword1!";

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
