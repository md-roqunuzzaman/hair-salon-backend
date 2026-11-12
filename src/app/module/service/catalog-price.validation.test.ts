import assert from "node:assert/strict";
import test from "node:test";
import { serviceValidation } from "./service.validation.js";
import { packageValidation } from "../package/package.validation.js";

const branchId = "11111111-1111-4111-8111-111111111111";
const serviceId = "22222222-2222-4222-8222-222222222222";
const service = { name: "Haircut", price: 4, durationMinutes: 30, branchIds: [branchId] };
const packageBody = {
  name: "Hair package", regularPrice: 10, packagePrice: 4, durationMinutes: 60,
  serviceIds: [serviceId], branchIds: [branchId], listingStatus: "LISTED",
  capacity: 10, purchaseLimitPerCustomer: 2,
  salesStartAt: "2026-11-01T00:00:00.000Z", salesEndAt: "2026-12-01T00:00:00.000Z",
};

for (const [name, schema, body, field] of [
  ["service create", serviceValidation.createServiceValidationSchema, service, "price"],
  ["service update", serviceValidation.updateServiceValidationSchema, {}, "price"],
  ["package create regular", packageValidation.createPackageValidationSchema, packageBody, "regularPrice"],
  ["package create discounted", packageValidation.createPackageValidationSchema, packageBody, "packagePrice"],
  ["package update regular", packageValidation.updatePackageValidationSchema, {}, "regularPrice"],
  ["package update discounted", packageValidation.updatePackageValidationSchema, {}, "packagePrice"],
] as const) {
  test(`${name}: reject sub-4 prices with a field-specific validation error`, () => {
    for (const price of [-1, 0, 1, 2, 3, 3.99]) {
      const result = schema.safeParse({ body: { ...body, [field]: price } });
      assert.equal(result.success, false, `${field}=${price}`);
      if (!result.success) {
        assert.ok(result.error.issues.some((issue) =>
          issue.path.join(".") === `body.${field}` && issue.message.includes("at least 4"),
        ));
      }
    }
    for (const price of [4, 4.01, 10]) {
      assert.equal(schema.safeParse({ body: { ...body, [field]: price } }).success, true);
    }
    for (const price of [null, "4", NaN, Infinity]) {
      assert.equal(schema.safeParse({ body: { ...body, [field]: price } }).success, false);
    }
  });
}

test("partial updates keep prices optional and preserve unrelated fields", () => {
  for (const schema of [serviceValidation.updateServiceValidationSchema, packageValidation.updatePackageValidationSchema]) {
    assert.deepEqual(schema.parse({ body: { description: "Updated description" } }).body, {
      description: "Updated description",
    });
  }
});

test("package create still prevents discounted price exceeding regular price", () => {
  const result = packageValidation.createPackageValidationSchema.safeParse({
    body: { ...packageBody, regularPrice: 4, packagePrice: 5 },
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.ok(result.error.issues.some((issue) => issue.message === "Package price cannot be greater than regular price"));
  }
});
